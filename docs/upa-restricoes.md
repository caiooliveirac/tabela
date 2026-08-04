# Restrição de UPA — da chefia ao médico regulador

Documento de referência: explica **quem decide**, **onde fica guardado** e **por
quais canais a decisão chega em quem regula**. Também é o mapa dos dois bots de
Telegram do ecossistema — a confusão entre eles é a pegadinha número 1 para
qualquer pessoa (ou agente) mexendo nisso pela primeira vez.

## O problema

A chefia decide que uma UPA não deve receber pacientes por um período (sem
médico na vermelha, sem energia, obra na porta, superlotação). Antes, isso virava
um **alerta de chefia** — texto livre, dentro de uma view do painel. Quem não
estava com o `/tabela` aberto naquele momento não ficava sabendo, e o alerta
ficava lá depois de resolvido, porque ninguém lembrava de apagar.

Agora a restrição é **dado estruturado**: unidade + prazo. Isso permite pintar a
célula, expirar sozinha e ser repetida pelos bots.

## Os dois bots — NÃO são o mesmo

| | **Bot regulador** | **Bot Plantões SAMU** |
|---|---|---|
| Repositório | `tabela` (este) + `tabela-notifier` | `plantoes` |
| Processo | dentro da API (`api/src/bot/chefiaBot.ts`) + systemd `tabela-notifier` | PM2 `plantoes` (web) e `plantoes-telegram-worker` |
| Transporte | long-polling (`getUpdates`) | webhook (`/api/telegram/webhook`) |
| Grupo | grupo dos **reguladores** (`TELEGRAM_REGULADORES_CHAT_ID`) | grupo da **escala** (`TELEGRAM_GROUP_CHAT_ID`) |
| Para que serve | casos aceitos / vaga zero, alertas periódicos da regulação | chegada, saída, refeição, pagamento dos plantonistas |
| Token | `TELEGRAM_BOT_TOKEN` deste repo | outro token, no `.env.production` do `plantoes` |

Regras que caem dessa separação:

- **`chefiaBot.ts` é o único consumidor de `getUpdates` do token regulador.** O
  `tabela-notifier` só envia, por isso convivem. Qualquer poller novo no mesmo
  token roubaria updates do bot — comando novo do lado regulador entra
  **naquele arquivo**, não num processo novo.
- O `tabela-notifier` fica **fora deste repo** e mexer nele exige autorização
  explícita (ver `CLAUDE.md`). Por isso o aviso periódico de UPA restrita foi
  implementado **dentro da API**, não no notifier.
- O bot Plantões SAMU **não escreve** em nada disto: ele só **lê**
  `GET /tabela/api/upas/restrictions`, fail-soft.
- O mesmo vale para o **`giro-de-leitos`**, que desde 2026-08 repete a restrição
  no grupo do WhatsApp das UPAs (ver "Quem mais consome" abaixo). Nenhum
  consumidor recebe webhook deste repo: todos leem o `GET` público. Manter
  assim é o que permite mexer neles sem tocar no painel de regulação.

## Fluxo ponta a ponta

```
chefia no /tabela (aba UPAs)
   └─ clica 🚫 na célula da UPA → escolhe o prazo → digita o PIN
        │
        ├─ POST /tabela/api/upas/restrictions  (PIN validado no servidor)
        │     ├─ grava em upa_restrictions (unidade + prazo + autor)
        │     ├─ broadcast WS → todo painel aberto pinta a célula de vermelho
        │     └─ aviso IMEDIATO no grupo dos reguladores (bot regulador)
        │
        ├─ a cada 2h (ancorado em 07:00 e 19:00): lembrete no grupo dos
        │  reguladores, só enquanto houver restrição vigente
        │
        ├─ /upas no grupo: lista sob demanda (bot regulador)
        │
        ├─ bot Plantões SAMU, na chegada de quem assume ramal de regulação:
        │     lê a lista e anexa "UPAs restritas" à confirmação de chegada
        │
        └─ giro-de-leitos (repo `giro-de-leitos`), no grupo do WhatsApp onde as
              UPAs postam o giro: comunicado imediato + lembrete a cada 4h,
              no tom "a pedido da Coordenação de Unidades Fixas"
```

Quando o prazo vence, a API fecha a restrição sozinha e avisa o grupo que a
unidade **voltou a receber**. A chefia também pode liberar antes da hora (com
PIN) ou esticar o prazo.

## Modelo de dados

Tabela `upa_restrictions` (criada de forma idempotente no boot da API —
`initUpaRestrictions()` — porque o deploy do `tabela` não roda migrations):

| coluna | papel |
|---|---|
| `unit_key` | chave da unidade no giro de leitos (a mesma de `/tabela/upas/api`) |
| `unit_name` | nome no momento da restrição, congelado para o histórico e as mensagens |
| `restricted_until` | o prazo. **Vigente = `ativo` E `restricted_until > agora`** |
| `autor` | quem restringiu (nome do operador no cabeçalho do painel) |
| `ativo` / `removido_por` / `removido_em` | liberação manual (`nome`) ou automática (`prazo vencido`) |

Uma restrição por UPA: restringir de novo uma unidade já restrita **atualiza o
prazo** em vez de empilhar uma segunda linha.

`upa_restriction_notices` guarda uma linha por slot de lembrete já enviado —
sem isso, cada restart da API repetiria o aviso do slot corrente no grupo.

## API

| rota | auth | uso |
|---|---|---|
| `GET /tabela/api/upas/restrictions` | pública | painel, bot Plantões SAMU, `giro-de-leitos` |
| `POST /tabela/api/upas/restrictions` | PIN da chefia | restringir / mudar prazo |
| `DELETE /tabela/api/upas/restrictions/:id` | PIN da chefia | liberar antes do prazo |

O `GET` devolve `until` (ISO, para quem calcula) **e** `untilLabel` já pronto no
fuso de Salvador (`"hoje 19:00"`), para que painel e bots falem exatamente a
mesma frase.

O PIN é o mesmo dos alertas de chefia, com o mesmo rate limit e bloqueio de IP
(`api/src/lib/chefiaGuard.ts`).

## Variáveis de ambiente

| variável | onde | efeito se vazia |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | API do `tabela` | bot regulador não sobe |
| `TELEGRAM_ADMIN_CHAT_ID` | API do `tabela` | comandos de PIN no privado desligados |
| `TELEGRAM_REGULADORES_CHAT_ID` | API do `tabela` | **avisos de UPA restrita no grupo desligados** (painel continua funcionando) |
| `TABELA_API_URL` | app `plantoes` | chegada do regulador sai sem o bloco de UPAs restritas |

Tudo é fail-soft: nenhuma dessas ausências derruba o painel nem o registro de
chegada.

## Quem mais consome (fora deste repo)

| consumidor | canal | cadência | tom |
|---|---|---|---|
| bot regulador (aqui) | grupo dos **reguladores**, Telegram | imediato + 2h | "não encaminhe para esta unidade" |
| bot Plantões SAMU | confirmação de chegada, Telegram | na chegada de quem assume o ramal | anexo informativo |
| `giro-de-leitos` | grupo das **UPAs**, WhatsApp | imediato + **4h** | "a pedido da Coordenação de Unidades Fixas, as demandas serão redirecionadas" |

As duas cadências e os dois tons são deliberados. O regulador **decide o
destino** e aguenta a repetição de 2 em 2 horas no canal de trabalho dele; a UPA
**recebe a consequência** e precisa saber de quem partiu a decisão — 2h no grupo
onde o giro é postado viraria ruído, e grupo silenciado é falha irreversível.

Lado do WhatsApp: `services/upa_restrictions_wa.py` no repo `giro-de-leitos`
(doc: `docs/restricao-upa-whatsapp.md` de lá). Ele compara snapshots do `GET`
a cada 2min em vez de receber webhook — este repo não conhece nem deve conhecer
os consumidores.

## Limite conhecido

A chefia só restringe UPAs que aparecem no grid — ou seja, unidades que já
mandaram giro alguma vez. Uma unidade que nunca postou não tem célula para
clicar. Restrições já criadas continuam editáveis pela faixa vermelha no topo da
aba, mesmo que a UPA pare de mandar giro e o card suma.
