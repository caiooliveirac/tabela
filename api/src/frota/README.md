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

- **Nome no SAMU+ → código do catálogo:** primeiro o código exato
  (`CB 02 (A)` → CB02); depois, para quem sobrou, o número (`PB 60 [A]` →
  BR60, viatura remanejada). Motos (`MT`) e unidades de evento (`FV 02`) ficam
  fora do catálogo.
- **No hospital:** a até 150 m do prédio. Só sai a mais de 200 m (o GPS
  oscila na borda). Moto e desativada não entram na conta.
- **Base no hospital:** a base do Pau Miúdo fica entre o HGESF e o Mário Leal;
  a de Cajazeiras, a 60 m do Municipal. Parada a até 150 m da **própria base**
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

## Linha do tempo e aviso aos reguladores

- `GET /tabela/api/frota/linha-do-tempo?horas=N` (1–72): paradas que tocam a
  janela; as abertas sempre entram.
- Aos 40 min, mensagem no grupo **REGULADORES - RECADOS** (Telegram,
  `TELEGRAM_REGULADORES_CHAT_ID`). Uma por parada: editada a cada coleta,
  fechada com a saída ou "sem sinal" (`aviso.ts`; `aviso_msg_id` na tabela).
  `FROTA_AVISOS_TELEGRAM=0` desliga.

## Cruzamento com o Acolhimentos

`acolhimentos.ts` lê `GET https://acolhimentos.mnrs.com.br/api/servico/acolhimentos`
(repo `caio-olive/help-mnrs`, token `ACOLHIMENTOS_TOKEN`) e casa cada parada
do GPS com a notificação da mesma viatura no mesmo hospital cujo intervalo
(chegada → liberação) se sobrepõe, com 15 min de folga. Na linha do tempo:
faixa cinza = notificado (tique na passagem), faixa roxa = maca retida,
barra vazada = notificação sem parada no GPS, "sem notificação" = USA 40+ min
sem registro. O Acolhimentos só cobre USA.

## Dados copiados (atualizar na fonte e trazer para cá)

- `catalogo.ts` — viaturas e bases: ChecagemdeBases `bot/src/data/bases.ts` e
  `src/data/coordenadas.ts`.
- `hospitais.ts` — os 11 hospitais do painel; 6 pontos do Destino, 5
  geocodificados em 29/09/2026.

## Banco

`frota_permanencias` (uma linha por parada em hospital: entrada, última
confirmação, saída, motivo, quando alertou) e `frota_estado` (último vínculo).
Criadas no boot com `IF NOT EXISTS`.

## Ligar e desligar

`SAMUMAIS_TOKEN` no `.env` do compose. Vazio = coletor desligado e a aba
avisa. Ver `GET /tabela/api/frota` (atrás do login único).
