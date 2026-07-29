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

## Pegadinhas conhecidas

- A API devolve **camelCase** (`hospitalId`, `criadoPor`) — o bug histórico do
  notifier foi ler snake_case.
- Dev local no Mac: o db do compose dev colide com a porta 5433 (túnel ssh) —
  usar override de porta. No LAB do servidor o 5433 é do próprio LAB.
- `docker-compose.yml.bak-*` no LIVE são backups intencionais (untracked).
