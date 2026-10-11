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
  merge/push na `main` sem perguntar — o servidor promove sozinho em ~1–3 min
  (ver "Deploy de qualquer aparelho"). Não deployar só quando o usuário disser
  ("não sobe", "só local", "testa no LAB"). `ssh magalu labctl promote tabela`
  (compose build + health em `/tabela/`, rollback automático) só se o
  auto-promote falhar.
- **ROLLBACK**: `ssh magalu labctl rollback tabela` (rebuild do commit anterior).
- **CANARY**: PIN da chefia / papéis internos no LIVE já promovido (cron semanal
  `scripts/chefia-pin.sh rotate` roda no LIVE, segunda 07:00).
- **Exigem aprovação explícita**: migration destrutiva, escrita manual no banco
  `tabela`, qualquer coisa que faça o `tabela-notifier` mandar mensagem real.

## Deploy de qualquer aparelho (desde 11/10/2026)

O Caio desenvolve ora do Windows, ora do Mac, ora do celular. O deploy não pode
depender de qual máquina está ligada: quem deploya é o **próprio servidor**.
Um timer do systemd no magalu (`auto-promote.timer` → `~/labctl/auto-promote.sh`,
lista em `~/labctl/auto-promote.apps`) confere a `main` a cada minuto e roda
`labctl promote tabela` (build + health, rollback automático). **Merge/push na
`main` = LIVE em ~1–3 min**, sem workflow, sem runner e sem SSH.
Um commit que falhou não é tentado de novo: corrigir com commit novo ou
`ssh magalu labctl promote tabela`. Log: `ssh magalu journalctl -u auto-promote -n 50`.
Não existe mais `.github/workflows/deploy.yml`: o job rodava num runner no Mac
e parava sempre que o Mac dormia. Depois do promote roda `migrate.js`
(`POST_PROMOTE_CMD` em `~/labctl/apps/tabela.conf`), como o workflow fazia.

Não pedir confirmação para merge/deploy: mandou, roda (as exceções de sempre
continuam — migration destrutiva, escrita manual no banco).

Se precisar agir à mão, `ssh magalu` funciona de qualquer aparelho no tailnet
(a porta 22 só aceita as redes de trabalho e o tailnet; a VM do GitHub não
entra). Conferir: `ssh magalu labctl status tabela` · histórico:
`ssh magalu labctl history tabela`.

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
`/frota/desativacoes` pela rede Docker. A mesma lista recebe o que a chefia
desativa no Relatório (repo `relatorio` posta) e na Mesa operacional (o
coletor lê do plantoes); de fora pode vir sem motivo, e o painel cobra. USA presa 40+ min sem registro no
Acolhimentos: `GET /frota/cobrancas` (médico do Plantões + texto); o Tom
(WhatsApp) entrega no grupo SAMU-Salvador.

Frota sozinha: `/tabela/frota` (`FrotaApp.tsx`; endereço público
`mnrs.com.br/frota`, card próprio no portal) é a mesma `FrotaView` sem o resto
do painel. É só o que rádio-operador, TARM e enfermeiro alcançam na Tabela: o porteiro (`mnrs-portal`,
`centralPermite`) libera para eles `/tabela/frota`, `/tabela/assets/`,
`/tabela/api/frota*` e `/tabela/api/encaminhamento/config` — chamada nova da
Frota a outra rota da API precisa entrar lá.

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
  portal (`auth_request` no nginx do HOST → porteiro, repo `mnrs-portal`; bloco em
  `nginx-host.conf`, estudo em `docs/login-unico.md`). Chamada de serviço usa
  `http://127.0.0.1:3001/tabela/api`, nunca a URL pública. O LAB não tem portão.
  Merge na `main` já faz deploy no LIVE (auto-promote no magalu).
- Aba Destino: mapa Google só com `GOOGLE_MAPS_BROWSER_KEY` no `.env` (chave
  de navegador, restrita por referrer — NÃO é a `GOOGLE_MAPS_API_KEY` do
  `gerar-locais.py`); sem ela cai no Leaflet. Ver `docs/encaminhamento-modulo.md`.
