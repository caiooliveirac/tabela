#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Gestão do PIN da chefia (rodar no servidor, dentro de ~/tabela).
#
#   ./scripts/chefia-pin.sh rotate           # gera novo PIN, mantém o anterior 1 semana, avisa admin no privado
#   ./scripts/chefia-pin.sh show             # mostra o PIN atual e o anterior
#   ./scripts/chefia-pin.sh list-blocks      # lista IPs bloqueados
#   ./scripts/chefia-pin.sh unblock <ip>     # desbloqueia um IP
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."   # raiz do repo (~/tabela)
ENV=.env
[ -f "$ENV" ] || { echo "ERRO: $ENV não encontrado em $(pwd)"; exit 1; }

# Carrega variáveis necessárias (token, admin, credenciais do banco)
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }
PGUSER="$(get POSTGRES_USER)"; PGUSER="${PGUSER:-tabela}"
PGDB="$(get POSTGRES_DB)"; PGDB="${PGDB:-tabela}"

psql_exec() { docker compose exec -T db psql -U "$PGUSER" -d "$PGDB" -P pager=off "$@"; }

cmd="${1:-}"
case "$cmd" in
  rotate)
    old="$(get CHEFIA_PIN)"
    new="$(shuf -i 100000-999999 -n 1)"
    sed -i '/^CHEFIA_PIN=/d; /^CHEFIA_PIN_PREV=/d' "$ENV"
    printf 'CHEFIA_PIN=%s\nCHEFIA_PIN_PREV=%s\n' "$new" "$old" >> "$ENV"
    echo "Recriando API para aplicar o novo PIN..."
    docker compose up -d api >/dev/null 2>&1
    TOKEN="$(get TELEGRAM_BOT_TOKEN)"; ADMIN="$(get TELEGRAM_ADMIN_CHAT_ID)"
    if [ -n "$TOKEN" ] && [ -n "$ADMIN" ]; then
      msg=$(printf '🔐 <b>Novo PIN da chefia</b>\n\nPIN desta semana: <b>%s</b>\nPIN anterior (%s) continua válido por ~7 dias.\n\nRepasse ao grupo da chefia.' "$new" "${old:-nenhum}")
      curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        --data-urlencode chat_id="$ADMIN" \
        --data-urlencode parse_mode=HTML \
        --data-urlencode text="$msg" >/dev/null && echo "PIN enviado ao seu privado no Telegram."
    else
      echo "AVISO: TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID ausentes — PIN não enviado por Telegram."
    fi
    echo "OK. Novo PIN: $new  |  anterior (ainda válido): ${old:-nenhum}"
    ;;
  show)
    grep -E '^CHEFIA_PIN' "$ENV"
    ;;
  list-blocks)
    psql_exec -c "SELECT ip, blocked_at, attempts FROM chefia_pin_blocks ORDER BY blocked_at DESC;"
    ;;
  unblock)
    ip="${2:?uso: ./scripts/chefia-pin.sh unblock <ip>}"
    psql_exec -c "DELETE FROM chefia_pin_blocks WHERE ip = '${ip}';"
    echo "Reiniciando API para recarregar a lista de bloqueios..."
    docker compose restart api >/dev/null 2>&1
    echo "IP $ip desbloqueado."
    ;;
  *)
    echo "uso: ./scripts/chefia-pin.sh {rotate|show|list-blocks|unblock <ip>}"; exit 1;;
esac
