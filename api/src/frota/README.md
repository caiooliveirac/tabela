# Frota do SAMU+ e retenção de maca

Aba **Frota** do painel (`?tab=frota`) e o aviso "viatura há 40 min ou mais
em hospital", que aparece em qualquer aba.

## De onde vem

| Fonte | O quê | Frequência |
|---|---|---|
| `GET {SAMUMAIS_API_URL}/localizacoes/ultimas-posicoes` (Bearer `SAMUMAIS_TOKEN`) | última posição de cada **equipe** | 2 min |
| `status-unidades.php` (pública, sem token) | vínculo unidade↔equipe, bateria, sinal, velocidade | 10 min, ou antes se aparecer equipe nova |

A API não diz qual viatura é cada equipe (`id_equipe` ≠ id da unidade). O
vínculo sai da página de status; se ela sair do ar, vale o último salvo em
`frota_estado`. A pedir à IMTECH: incluir `id_unidade` na API.

## Regras (`regras.ts`, testadas em `regras.test.ts`)

- **Numeral acima de 74 = dado lixo** (RMS, nunca teve conexão com o SAMU+):
  fora do catálogo, do painel, da linha do tempo e dos avisos; vale também
  para o nome no SAMU+ ("MT 76 (SF)"). LFEX fica — sem ele, "LFEX 01" tomaria
  a SM01 pelo número (`catalogo.ts`, `NUMERO_MAX`).
- **Nome no SAMU+ → código do catálogo:** primeiro o código exato
  (`CB 02 (A)` → CB02); depois, para quem sobrou, o número (`PB 60 [A]` →
  BR60, viatura remanejada). Motos (`MT`) e unidades de evento (`FV 02`) ficam
  fora do catálogo.
- **Chegada:** a até 150 m de um ponto do local — o pino do prédio ou um
  estacionamento aprendido. Pontos que se cruzam: vence o mais perto. Moto e
  desativada não entram na conta.
- **Trava:** a parada fica presa ao local onde chegou; nunca passa para o
  vizinho (HGESF, 16º Centro e Mário Leal estão a 90–180 m um do outro). Segue
  enquanto a viatura estiver a até 200 m de um ponto do local, ou a até 150 m
  de onde parou na chegada (2+ posições a até 50 m) — o GPS oscila.
  **Chegada** (20 min): também segue a viatura até 300 m do local, a até
  150 m da última posição; pulo para longe espera a próxima posição (parou
  ali, segue; continuou, fecha na hora do pulo). Depois da chegada, sair para
  longe fecha na hora: lanchonete ou ocorrência perto, depois de liberar, não
  vira retenção (`seguir`).
- **Estacionamento aprendido** (`aprenderPontos`, a cada 30 min, paradas de
  10+ min dos últimos 30 dias fora da base): cada parada grava onde o GPS
  ficou parado mais tempo entre as paradas que começaram na chegada
  (`estavel_lat/lng/n`). 3 viaturas diferentes em 2
  dias no mesmo lugar (40 m), a 60–300 m do pino, viram ponto do local. O
  mesmo lugar aprendido por dois locais fica com quem tem mais viaturas;
  em cima do pino de outro local, nunca. Aparece como círculo no mapa.
- **Na UPA:** mesma regra e mesmo alerta (painel e Telegram aos 40 min), nas
  20 UPAs de `upas.ts`. No mapa o nome da UPA só aparece com viatura dentro;
  na linha do tempo, só a UPA que teve parada. UPA não cruza com o
  Acolhimentos (nunca "sem notificação").
- **Base no hospital ou na UPA:** a base do Pau Miúdo fica entre o HGESF e o
  Mário Leal; a de Cajazeiras, a 60 m do Municipal; San Martin, Periperi,
  Santo Antônio, São Cristóvão e Rodrigo Argolo dentro da UPA. Valéria e
  12º Centro: ponto da UPA de mesmo nome, por suposição (ver `catalogo.ts`).
  Parada a até 150 m da **própria base**
  é registrada com `na_base = true`: aparece em cinza na tabela e na linha do
  tempo, com hora de entrada, mas sem alerta nem Telegram. Base ↔ hospital
  troca de parada com a mesma histerese (150 m entra, 200 m sai).
- **Alerta:** 40 min. Sem posição nova há 15 min o relógio congela; sem
  posição há 1 h a parada fecha como `sem-sinal`.
- **Situação de cada viatura:** `mapa` (posição da última hora) ·
  `sem-sinal` · `fora-do-turno` (SD e 10h entre 19h e 7h — o horário exato do
  10h é suposição) · `desativada` (lista `DESATIVADAS_ATE_SEGUNDA_ORDEM` ou
  cadastro oficial). Quem transmite aparece, mesmo que a planilha diga que
  está desativada.

## Diagnóstico e vigia

`GET /tabela/api/frota/diagnostico` (serviço: `http://127.0.0.1:3001/...`):
idade da última coleta, erros recentes (coleta, vínculos, aviso Telegram,
aprendizado — repetidos viram uma linha com contagem), paradas abertas e à
espera de pulo, e o aprendizado (pontos ativos e histórico de
aprendeu/esqueceu). Fica em `frota_estado` (`erros`, `aprendizado`): o log
do container some a cada deploy, isto não.

## Linha do tempo e avisos no grupo da frota

- `GET /tabela/api/frota/linha-do-tempo?horas=N` (1–72): paradas que tocam a
  janela; as abertas sempre entram.
- Todos os avisos vão ao **grupo da frota** (`TELEGRAM_FROTA_CHAT_ID`; vazio
  = nada sai, só o registro). Desde 29/09/2026 as paradas saíram do
  REGULADORES - RECADOS; aviso aberto de antes fecha lá (`aviso_chat` nulo).
  `FROTA_AVISOS_TELEGRAM=0` desliga tudo. chat_id de grupo novo: o admin
  manda `/id@ReguladorSAMU_bot` lá.
- **Parada de 40 min:** uma mensagem por parada, editada a cada coleta
  (`aviso.ts`; `aviso_msg_id`/`aviso_chat`). Na saída, a mensagem é editada e
  **respondida** ("saiu às…") — edição não notifica ninguém, resposta sim.
  A edição termina com "aviso das 14:18, atualizado às 14:34": o Telegram
  mostra no balão a hora do envio e não marca edição de bot.

## Sinal, bateria e resumo (`sinal.ts`, testado em `sinal.test.ts`)

Só entra viatura do catálogo, escalada agora e não desativada. Só caso
**agudo** vai ao grupo na hora; muda há 3 h+ é crônica e fica só numa linha
do resumo e do `/frota` (com 12 h, as mudas desde a troca das 07h ocupavam o
topo do ranking).

- **Queda de sinal:** 10 min sem posição (chegam a cada 2 min). Só abre se
  vista antes de 30 min de silêncio — deploy ou viatura muda desde cedo não
  dispara. Uma mensagem, editada a cada coleta com o que o SAMU+ registrou
  do app (**sem internet** = caiu com conexão `none`; bateria abaixo de 20%);
  na volta, editada e respondida ("voltou às…"). Fecha sem resposta ao sair
  do turno ou aos 3 h.
- **Reincidência:** queda até 60 min depois da volta da anterior não avisa,
  a não ser que dure 30 min.
- **Sinal instável:** 3 quedas em 3 h (a atual conta) — uma mensagem, no
  máximo a cada 6 h por viatura.
- **Surto:** 8 quedas no mesmo ciclo = o SAMU+ parou, não as viaturas. Uma
  mensagem só; as quedas ficam silenciadas.
- **Bateria:** abaixo de 20%, lida há até 30 min, transmitindo e sem subir
  (leitura anterior maior ou igual) — "colocar o tablet para carregar", uma
  vez por viatura por plantão. O SAMU+ só lê a bateria quando o app cai ou
  volta: leitura pode ter horas (`bateriaEm` no painel).
- **Resumo da troca de plantão:** 07:30 e 19:30 (manda até 1 h depois, uma
  vez): sem sinal, paradas de 40+ min, bateria baixa, instáveis e, numa
  linha, as crônicas.
- **`/frota`** (no grupo da frota ou no privado do admin): problemas agudos
  por gravidade. Pesa o tempo fora de ação, seja qual for o motivo — sem
  sinal (+10) ou parada 40+ min, vale o maior; somam bateria (2 por % abaixo
  de 20) e instabilidade (metade dos minutos caídos em 3 h); USA 1,5×.
  Crônicas fora do ranking, só contadas.
- **Registro:** todo aviso — enviado ou silenciado (reincidente, surto) —
  fica em `frota_alertas` e em `[frota-alerta]` no log.
  `GET /tabela/api/frota/alertas?horas=24` devolve a contagem e as linhas,
  para calibrar os limites.

## Viatura fora de operação informada no painel (`desativacoes.ts`)

O rádio-operador, a chefia ou a enfermagem informa em "Fora de operação
agora" (aba Frota) que a viatura parou: motivo (os MESMOS códigos do
`motivo_baixa` do Huddle — falta de condutor, técnico, enfermeiro, médico;
mecânica, oxigênio, maca, monitor, rádio; outro com observação), o nome do
cabeçalho do painel e o posto. O portão do login único só diz "logado", não
quem (docs/login-unico.md, fase 2) — por isso nome + posto.

- Vale **até a virada do plantão** (07h/19h) de quem informou: o coletor
  encerra sozinho (`reativada_por = "virada do plantão"`) e manda um aviso só
  ao grupo; o que continuar fora, o plantão seguinte informa de novo.
- Até alguém **reativar** (ou a virada), conta como desativada: some de todos os avisos
  (parada de 40 min fecha na hora, queda de sinal fecha, bateria e ranking
  ignoram), mesmo transmitindo. Uma ativa por viatura (índice único).
- O grupo da frota recebe "⛔ desativada por…" e "✅ reativada por…"; o
  resumo do plantão lista as desativadas no painel, para ninguém esquecer.
- `GET /tabela/api/frota/desativacoes?horas=24`: ativas e as que começaram ou
  terminaram na janela. É o que o **Huddle do SAMU** (repo hge-huddle) lê pela
  rede Docker (`http://tabela-api-1:3000/...`, sem o portão) para chegar com
  "fora de operação" preenchido. `POST /desativacoes` e
  `POST /desativacoes/:id/reativar` (atrás do login único).
- O **Quadro Informativo** (quadro.mnrs.com.br) também lê e posta nas mesmas
  rotas. `origem` (`frota` | `huddle` | `quadro`, opcional no POST, padrão
  `frota`; linha antiga sem a coluna sai como `frota`) diz onde foi informada:
  o painel mostra "informado no Quadro Informativo por Fulano" e o grupo
  "desativada no Quadro Informativo por…". O GET devolve também `origens`
  (rótulos). As telas avisam que informar num lugar vale nos outros.
- Tabela `frota_desativacoes`, criada no boot (coluna `origem` nula
  acrescentada no boot com `ADD COLUMN IF NOT EXISTS`).

## Ocorrência e MR no aviso (`ocorrencias.ts`)

A parada de 40 min diz se a viatura está **em ocorrência** (protocolo, médico
regulador, status e hora — "chegada ao hospital às 15:59") ou **sem
ocorrência** no mapa de equipes da regulação. O painel mostra o mesmo na
tabela de hospitais (coluna Ocorrência).

- Fonte: `GET http://172.23.130.87/dashmapa/mapa/refresh_maps_equipes` (sem
  login, só na rede da SMS/VPN; o magalu não alcança). `dados: null` = livre.
  O campo `medico` é o regulador (vem preenchido também em USB).
- Ponte: `scripts/mapa-equipes-coletor.mjs`, numa máquina de dentro da rede,
  lê a cada 30 s e manda a `POST /tabela/api/frota/ocorrencias` (header
  `x-mapa-token` = `MAPA_EQUIPES_TOKEN`; fora do portão no nginx). **Corta na
  origem** nome, idade, sexo e telefone do paciente e o solicitante. Endereço,
  bairro, queixa e HMA vêm, mas só para o painel (atrás do login): no
  Telegram, nunca.
- Sem envio há 5 min (coletor parado, VPN caída) ou viatura fora do mapa: o
  aviso sai sem a linha — nunca "sem ocorrência" por falta de dado — e todo o
  resto (parada, Acolhimentos, cobrança, balanço) segue igual.
  `GET /frota/diagnostico` → `mapaEquipes`.
- Ponte muda há 10 min: o admin recebe no privado ("sem dados desde…"), e
  de novo na volta (`vigiarMapa`). No Mac, com `MAPA_EQUIPES_VPN` = nome do
  serviço de VPN do macOS, o coletor derruba e sobe a VPN depois de 3 min
  sem alcançar o mapa (no máximo a cada 5 min).
- **Histórico para relatórios** (`registrarOcorrencias`, tabelas criadas no
  boot): `frota_ocorrencias` (uma linha por viatura × protocolo: MR, risco,
  abertura, endereço, bairro, queixa, HMA, primeira e última vez no mapa) e
  `frota_ocorrencia_status` (cada status com a hora e o MR da hora). Em
  `frota_permanencias`, por parada: `oc_coletas` / `livre_coletas` (coletas
  de 2 min em ocorrência / livre; sem dado do mapa não conta), `oc_protocolo`
  e `oc_mr` (os últimos vistos na parada).
- Nome da equipe ("CZ 53 (8h)") → código pela mesma `vincular` do SAMU+.

## Cruzamento com o Acolhimentos

`acolhimentos.ts` lê `GET https://acolhimentos.mnrs.com.br/api/servico/acolhimentos`
(repo `caio-olive/help-mnrs`, token `ACOLHIMENTOS_TOKEN`) e casa cada parada
do GPS com a notificação da mesma viatura no mesmo hospital cujo intervalo
(chegada → liberação) se sobrepõe, com 15 min de folga. Na linha do tempo:
faixa cinza = notificado (tique na passagem), faixa roxa = maca retida,
barra vazada = notificação sem parada no GPS, "sem notificação" = USA 40+ min
sem registro. O Acolhimentos só cobre USA.

## Cobrança da denúncia no grupo SAMU-Salvador (`cobrancasPendentes`)

USA parada 40+ min em hospital (não UPA, não a própria base) **sem
notificação casada no Acolhimentos** — o mesmo `semNotificacao` da linha do
tempo. `GET /tabela/api/frota/cobrancas` devolve cada uma com o médico e o
texto pronto ("Dr(a). *Fulano*, por favor abra o aplicativo e registre a
retenção", link do app), em formatação do WhatsApp.

- **Quem entrega é o Tom** (repo TomSecretario, pm2 `tom`): busca pela porta
  local (`http://127.0.0.1:3001/tabela/api/frota/cobrancas`, sem o portão) e
  manda cada `id` (a parada) uma vez ao grupo SAMU-Salvador do WhatsApp. A
  regra e o texto moram aqui; o Tom só entrega.
- Nome: `plantoes.ts` lê `GET https://plantoes.mnrs.com.br/api/servicos/quadro/plantao`
  (header `x-escala-token` = `ESCALA_SSO_TOKEN` do plantoes, aqui
  `PLANTOES_TOKEN`; a mesma rota do Quadro). Dupla: os dois nomes. Plantões
  fora do ar: "Médico(a) da SM01".
- Acolhimentos fora do ar (ou sem `ACOLHIMENTOS_TOKEN`): 503 — ninguém é
  cobrado sem a prova de que não registrou.
- Colunas `cobranca_*` em `frota_permanencias`: sobra da primeira versão
  (Telegram, 01/10/2026), sem uso.

## Balanço da virada (`balancoPlantao`, `GET /frota/balanco`)

Às 07h e às 19h o Tom busca e manda ao grupo SAMU-Salvador: viaturas (USA e
USB) 40+ min paradas em hospital (não UPA, não a própria base) nas últimas
12 h, por hospital — mais viaturas primeiro, maior espera primeiro; a que
ainda está presa na virada conta até agora (⏳). USA sem notificação no
Acolhimentos entra num convite gentil a registrar tempos e motivos, com o
nome do médico **da hora da retenção**: `gravarMedicos` grava em
`frota_permanencias.medico` o médico do Plantões quando a USA passa de 40 min
(às 07h o Plantões já mostra quem assumiu). Acolhimentos fora do ar: sai sem
o convite.

## Dados copiados (atualizar na fonte e trazer para cá)

- `catalogo.ts` — viaturas e bases: ChecagemdeBases `bot/src/data/bases.ts` e
  `src/data/coordenadas.ts`.
- `hospitais.ts` — os 11 hospitais do painel; 6 pontos do Destino, 5
  geocodificados em 29/09/2026.
- `upas.ts` — as 20 UPAs: pinos da lista "UPAs" do Google Maps
  (https://maps.app.goo.gl/ZQ2c7ZsepaxfryaE9), lida em 29/09/2026.

## Banco

`frota_permanencias` (uma linha por parada em hospital ou UPA: entrada,
última confirmação e posição, saída, motivo, quando alertou, onde o GPS parou),
`frota_alertas` (quedas de sinal, instabilidade, surto, bateria e resumos),
`frota_desativacoes` (fora de operação informada no painel) e `frota_estado`
(último vínculo).
Criadas no boot com `IF NOT EXISTS`.

## Ligar e desligar

`SAMUMAIS_TOKEN` no `.env` do compose. Vazio = coletor desligado e a aba
avisa. Ver `GET /tabela/api/frota` (atrás do login único).
