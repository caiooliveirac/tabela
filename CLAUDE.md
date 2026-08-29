# CLAUDE.md — tabela (painel de regulação de leitos SAMU)

App em produção em https://mnrs.com.br/tabela (usuários reais: reguladores).
Stack: `api/` Express + drizzle (porta interna 3000, path `/tabela/api`);
`web/` React + Vite (base `/tabela/`); docker compose; banco em container próprio.
O notificador Telegram (`~/tabela-notifier` no servidor, systemd `tabela-notifier`)
fica FORA deste repo e só observa o LIVE.

## Ambientes LIVE / LAB (labctl, desde 2026-07-28)

Procedimentos completos: `~/labctl/README.md` no servidor magalu.

| | LIVE | LAB |
|---|---|---|
| Dir no magalu | `~/tabela` | `~/lab/tabela` |
| Processos | compose: `tabela-{db,api,web}-1` | compose `docker-compose.lab.yml` (projeto `tabela-lab`) |
| Portas | web 3001 (nginx → /tabela) | api **4000**, web vite **4001** (só 127.0.0.1) |
| Banco | postgres em `tabela-db-1` | postgres próprio `tabela-lab-db-1` (volume separado, credencial dummy) |

- **LAB**: editar no Mac e `lab push tabela` (hot reload: vite HMR no web, dev
  server no api). Usuário abre `http://localhost:4001/tabela/` (túnel
  `ssh -fN magalu-lab`). Logs: `ssh magalu labctl lab tabela logs`.
- **Banco LAB**: `ssh magalu labctl db-refresh tabela` copia o banco LIVE
  (somente leitura) para o container LAB.
- **STATUS**: `ssh magalu labctl status tabela`.
- **PROMOTE**: commit+push na main → `ssh magalu labctl promote tabela`
  (compose build web/api + up + health em `/tabela/`; rollback automático se falhar).
- **ROLLBACK**: `ssh magalu labctl rollback tabela` (rebuild do commit anterior).
- **CANARY**: PIN da chefia / papéis internos no LIVE já promovido (cron semanal
  `scripts/chefia-pin.sh rotate` roda no LIVE, segunda 07:00).
- **Exigem aprovação explícita**: migrations no banco de produção, mexer no
  `tabela-notifier`, qualquer escrita manual no banco `tabela`.

## Dois bots de Telegram — não confundir

- **Bot regulador** (este repo): token `TELEGRAM_BOT_TOKEN`. Dois processos com o
  MESMO token — `api/src/bot/chefiaBot.ts` (long-polling, único consumidor de
  `getUpdates`) e o `tabela-notifier` (só envia). Comando novo do lado regulador
  entra no `chefiaBot.ts`; um poller novo roubaria os updates dele.
- **Bot Plantões SAMU** (repo `plantoes`): outro token, outro grupo, webhook.
  Registra chegada/saída de plantonista. Só **lê** deste repo, via
  `GET /tabela/api/upas/restrictions`.
- Restrição de UPA (célula vermelha + PIN + avisos no grupo):
  [docs/upa-restricoes.md](docs/upa-restricoes.md).

## Pegadinhas conhecidas

- A API devolve **camelCase** (`hospitalId`, `criadoPor`) — o bug histórico do
  notifier foi ler snake_case.
- Tabelas de PIN e de restrição de UPA são criadas no **boot** da API
  (`initChefiaSecurity` / `initUpaRestrictions`), não pelo `db:migrate` — o
  deploy não roda migrations. A migration em `drizzle/migrations` é
  `IF NOT EXISTS` justamente para ser um no-op depois.
- Dev local no Mac: o db do compose dev colide com a porta 5433 (túnel ssh) —
  usar override de porta. No LAB do servidor o 5433 é do próprio LAB.
- `docker-compose.yml.bak-*` no LIVE são backups intencionais (untracked).
- Aba Destino: mapa Google só com `GOOGLE_MAPS_BROWSER_KEY` no `.env` (chave
  de navegador, restrita por referrer — NÃO é a `GOOGLE_MAPS_API_KEY` do
  `gerar-locais.py`); sem ela cai no Leaflet. Ver `docs/encaminhamento-modulo.md`.
