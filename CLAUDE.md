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
- **Toda tarefa termina no LIVE** (desde 29/09/2026): terminou uma mudança,
  merge/push na `main` sem perguntar — já deploya no LIVE (`deploy.yml`). Não
  deployar só quando o usuário disser ("não sobe", "só local", "testa no LAB"). `ssh magalu labctl promote tabela`
  (compose build + health em `/tabela/`, rollback automático) só se o CI falhar.
- **ROLLBACK**: `ssh magalu labctl rollback tabela` (rebuild do commit anterior).
- **CANARY**: PIN da chefia / papéis internos no LIVE já promovido (cron semanal
  `scripts/chefia-pin.sh rotate` roda no LIVE, segunda 07:00).
- **Exigem aprovação explícita**: migration destrutiva, escrita manual no banco
  `tabela`, qualquer coisa que faça o `tabela-notifier` mandar mensagem real.

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

## Aba Frota (SAMU+)

Posições das viaturas e retenção de maca (40 min em hospital):
[api/src/frota/README.md](api/src/frota/README.md). Token `SAMUMAIS_TOKEN` no
`.env` do servidor. Avisos (parada, sinal, bateria, resumo, `/frota`) vão ao
grupo `TELEGRAM_FROTA_CHAT_ID`, não ao dos reguladores. Numeral acima de 74
(RMS) é dado lixo e não aparece (`catalogo.ts`). Viatura fora de operação
informada no painel sai dos avisos; o Huddle do SAMU lê
`/frota/desativacoes` pela rede Docker.

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
- **Login único**: `mnrs.com.br/tabela/` (tela, `/api/*`, `/ws`) exige o login do
  portal (`auth_request` no nginx do HOST → porteiro do kairos; bloco em
  `nginx-host.conf`, estudo em `docs/login-unico.md`). Chamada de serviço usa
  `http://127.0.0.1:3001/tabela/api`, nunca a URL pública. O LAB não tem portão.
  Merge na `main` já faz deploy no LIVE (`deploy.yml` → magalu).
- Aba Destino: mapa Google só com `GOOGLE_MAPS_BROWSER_KEY` no `.env` (chave
  de navegador, restrita por referrer — NÃO é a `GOOGLE_MAPS_API_KEY` do
  `gerar-locais.py`); sem ela cai no Leaflet. Ver `docs/encaminhamento-modulo.md`.
