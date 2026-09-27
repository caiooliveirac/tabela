# Login único no tabela — estudo (2026-09-27)

Objetivo: só quem passou pelo login do portal (`mnrs.com.br/`, porteiro do
kairos, ADR 0013) vê o painel e sabe qual paciente está em qual hospital.
Hoje tudo em `/tabela/` (tela, `/tabela/api/*`, `/tabela/ws`) é público.

**Estado: estudo. Nada aplicado.**

## Como o login único já funciona (kairos, ADR 0013)

- O portal na raiz confere a senha no plantoes e grava o cookie **`mnrs_sso`**
  em `.mnrs.com.br` (HMAC, HttpOnly, Secure, SameSite=Lax, 30 dias
  deslizantes). Vale para `mnrs.com.br/tabela` também, porque o domínio é o mesmo.
- O porteiro (`127.0.0.1:3091`, pm2 `porteiro`) expõe **`GET /portao`**:
  204 = sessão válida, 401 = sem sessão. Quando a sessão tem mais de um dia,
  a resposta traz o `Set-Cookie` renovado.
- O `triagem` já é protegido assim (`triagem/deploy/nginx/triagem.mnrs.com.br.conf`):
  `auth_request` no nginx a cada pedido; 401 → `302 https://mnrs.com.br/?proximo=triagem`.
- O portal já conhece `tabela`, `giro` (`?tab=upas`) e `destino`
  (`?tab=destino`) em `SISTEMAS` (`kairos/deploy/porteiro/lib.mjs`), então
  `?proximo=tabela` volta para o painel depois do login.

## Proposta: portão no nginx do HOST, zero mudança no login

O portão entra no bloco `location /tabela/` do `server mnrs.com.br` no magalu
(fonte: `nginx-host.conf` deste repo), não no Express nem no nginx do container:

- não espalha o `PORTEIRO_SECRET` para mais um serviço (o tabela não valida o
  HMAC; só o porteiro valida);
- quem chama pela porta interna `127.0.0.1:3001` continua passando sem
  cookie — é assim que os serviços do próprio servidor devem chamar;
- a porta 3001 só escuta em 127.0.0.1 (`docker-compose.yml`), então não há
  como contornar o portão de fora.

Esboço (mesmo padrão do triagem):

```nginx
location = /_porteiro_tabela {
    internal;
    proxy_pass http://127.0.0.1:3091/portao;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
}

location /tabela/ {
    auth_request /_porteiro_tabela;
    auth_request_set $tabela_cookie $upstream_http_set_cookie;
    add_header Set-Cookie $tabela_cookie;
    error_page 401 = @tabela_entrar;
    proxy_pass http://127.0.0.1:3001/tabela/;
    # ... headers de hoje
}
# /tabela/api/ e /tabela/ws: o mesmo auth_request, mas 401 fica 401
# (a tela recarrega e aí cai no login; um 302 num fetch viraria HTML no lugar de JSON).

location @tabela_entrar {
    add_header Cache-Control "no-store" always;
    return 302 https://mnrs.com.br/?proximo=tabela;
}
```

O `auth_request` também vale no upgrade do WebSocket: o navegador manda o
cookie no `wss://mnrs.com.br/tabela/ws`.

## O que continua aberto de propósito

| Caminho | Por quê |
|---|---|
| `/tabela/upas`, `/tabela/destino` | páginas de prévia de link (og:image) do portal; só redirecionam para o painel, que aí pede login |
| `/tabela/og-whatsapp-v2.png` (e o `og-whatsapp.png`) | sem ela a prévia no WhatsApp some (o robô não tem cookie) |
| `/tabela/api/health` | health de fora (opcional; o promote usa a porta interna?) |

O `index.html` com as meta tags fica **atrás** do portão: o robô do WhatsApp
passa a ver a prévia do portal. Se a prévia do tabela importar, dá para seguir
o esquema do `/tabela/upas` (página estática no portal com og:image própria).

## Quem chama o tabela sem navegador — conferir antes de ligar

| Consumidor | Chama por | Impacto |
|---|---|---|
| Bot Plantões SAMU (`plantoes`, `TABELA_API_URL`) | `http://127.0.0.1:3001/tabela/api` | nenhum (porta interna) |
| `chefiaBot` / avisos de UPA | dentro da própria API | nenhum |
| Kairós, adaptador `fontes/tabela.ts` (`/api/cases`, `/api/upas/restrictions`) | `LEGADO_TABELA_URL=https://mnrs.com.br/tabela` (ESTADO.md) | **quebra**: trocar para a porta interna (se o kairos roda em container, pelo IP do host na rede do docker) |
| `tabela-notifier` (fora do repo) | desconhecido | **conferir no magalu** (`grep -r mnrs.com.br ~/tabela-notifier`) — se usa a URL pública, quebra |
| `labctl promote` (health em `/tabela/`) | desconhecido | **conferir**: se bate na URL pública, vai ver 302 e fazer rollback |
| LAB (`localhost:4001` pelo túnel) | vite direto | nenhum; o LAB fica sem portão |

## Ajustes pequenos no repo que acompanham

1. **`web/src/api/client.ts`**: resposta 401 (ou `res.redirected`) de
   `/tabela/api` → `location.reload()`, que leva ao login; o WebSocket que
   fecha e não reconecta faz o mesmo. Na prática quase não dispara (sessão de
   30 dias deslizante), mas sem isso o painel aberto no plantão fica mudo sem
   aviso quando a sessão vence.
2. **`docker/nginx.conf`**: `Cache-Control "public"` dos `/tabela/assets/`
   vira `"private"`. Se o Cloudflare estiver na frente de `mnrs.com.br` (está
   para o `triagem`), um asset `public` pode ficar na borda e sair sem passar
   pelo portão. Os bundles não têm paciente, mas é a regra que o triagem adotou.
3. **`nginx-host.conf`**: passa a ser a fonte do bloco com o portão.

## Riscos de uso

- **Navegador embutido do Telegram/WhatsApp (iPhone)** tem cookies à parte: o
  regulador que abre o link do grupo pode ter que logar de novo lá dentro.
  No Android o Telegram usa o Chrome e compartilha a sessão.
- **Porteiro fora do ar = painel fora do ar** (falha fechada, 500 em até 5 s).
  É a escolha certa para dado de paciente, mas o painel passa a depender do
  pm2 `porteiro`.
- **Quem não tem conta no plantoes** (regulador novo, residente, chefia de
  outro serviço) perde acesso até se cadastrar pelo portal. Levantar antes.
- Sessão sem estado: conta desativada no plantoes segue vendo o painel até o
  cookie vencer (ADR 0013, "Consequências"). Para revogar na hora, o porteiro
  precisaria reler a conta — fora deste escopo.

## Bônus possível (fase 2): saber QUEM fez

O `/portao` só diz sim/não. Se o porteiro devolver `X-Mnrs-Email` /
`X-Mnrs-Nome` no 204, o nginx repassa à API (`auth_request_set` +
`proxy_set_header`), e o tabela pode preencher sozinho o "quem registrou" que
hoje é digitado (`realName` em `lib/chefiaGuard.ts`). Exige mudança no kairos.

## Ordem sugerida

1. Levantar no magalu: notifier, `labctl` health, `LEGADO_TABELA_URL`, se o
   Cloudflare faz proxy de `mnrs.com.br`.
2. PR neste repo: itens 1–3 acima (sem efeito até o nginx do host mudar).
3. Trocar `LEGADO_TABELA_URL` do kairos para a porta interna.
4. Aplicar o bloco no nginx do host (`nginx -t && reload`) — reversível
   em segundos restaurando o bloco antigo. **Exige aprovação**: muda o acesso
   de todos os reguladores de uma vez; avisar no grupo antes.
