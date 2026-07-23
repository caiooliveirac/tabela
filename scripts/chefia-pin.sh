#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Gestão do PIN da chefia via banco (rodar no servidor, em ~/tabela).
# Os PINs válidos vivem na tabela chefia_pins; a API lê ao vivo (sem restart).
#
#   ./scripts/chefia-pin.sh rotate        # novo PIN, mantém o anterior ~1 semana, avisa admin
#   ./scripts/chefia-pin.sh reset         # novo PIN e APAGA os antigos, avisa admin
#   ./scripts/chefia-pin.sh show          # mostra os PINs válidos
#   ./scripts/chefia-pin.sh list-blocks   # lista IPs bloqueados
#   ./scripts/chefia-pin.sh unblock <ip>  # desbloqueia um IP
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."   # raiz do repo (~/tabela)
ENV=.env
[ -f "$ENV" ] || { echo "ERRO: $ENV não encontrado em $(pwd)"; exit 1; }

get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }
PGUSER="$(get POSTGRES_USER)"; PGUSER="${PGUSER:-tabela}"
PGDB="$(get POSTGRES_DB)"; PGDB="${PGDB:-tabela}"

# psql silencioso (-tA) para capturar valores; psql_show para exibir tabela
psql_val() { docker compose exec -T db psql -U "$PGUSER" -d "$PGDB" -tAc "$1"; }
psql_show() { docker compose exec -T db psql -U "$PGUSER" -d "$PGDB" -P pager=off -c "$1"; }

notify() { # $1 = texto (HTML)
  local TOKEN ADMIN; TOKEN="$(get TELEGRAM_BOT_TOKEN)"; ADMIN="$(get TELEGRAM_ADMIN_CHAT_ID)"
  [ -n "$TOKEN" ] && [ -n "$ADMIN" ] || { echo "AVISO: Telegram não configurado — não avisado."; return; }
  curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    --data-urlencode chat_id="$ADMIN" --data-urlencode parse_mode=HTML \
    --data-urlencode text="$1" >/dev/null && echo "Avisado no Telegram privado."
}

cmd="${1:-}"
case "$cmd" in
  rotate)
    new="$(shuf -i 100000-999999 -n 1)"
    psql_val "INSERT INTO chefia_pins (pin) VALUES ('${new}');" >/dev/null
    psql_val "DELETE FROM chefia_pins WHERE id NOT IN (SELECT id FROM chefia_pins ORDER BY created_at DESC, id DESC LIMIT 2);" >/dev/null
    notify "$(printf '🔐 <b>Novo PIN da chefia</b>\n\nPIN desta semana: <b>%s</b>\nO PIN anterior continua válido por ~7 dias.\n\nRepasse ao grupo da chefia.' "$new")"
    echo "Rotacionado. Novo PIN: $new (anterior ainda válido)"
    ;;
  reset)
    new="$(shuf -i 100000-999999 -n 1)"
    psql_val "DELETE FROM chefia_pins; INSERT INTO chefia_pins (pin) VALUES ('${new}');" >/dev/null
    notify "$(printf '🔐 <b>PIN resetado</b>\n\nNovo PIN (único válido): <b>%s</b>\nOs anteriores foram invalidados.\n\nRepasse ao grupo da chefia.' "$new")"
    echo "Resetado. Novo PIN: $new (antigos apagados)"
    ;;
  show)
    psql_show "SELECT pin, created_at FROM chefia_pins ORDER BY created_at DESC;"
    ;;
  list-blocks)
    psql_show "SELECT ip, blocked_at, attempts FROM chefia_pin_blocks ORDER BY blocked_at DESC;"
    ;;
  unblock)
    ip="${2:?uso: ./scripts/chefia-pin.sh unblock <ip>}"
    psql_val "DELETE FROM chefia_pin_blocks WHERE ip = '${ip}';" >/dev/null
    echo "IP $ip desbloqueado."
    ;;
  *)
    echo "uso: ./scripts/chefia-pin.sh {rotate|reset|show|list-blocks|unblock <ip>}"; exit 1;;
esac
