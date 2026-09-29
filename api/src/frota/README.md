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
`frota_estado`. Pedido feito à IMTECH: incluir `id_unidade` na API.

## Regras (`regras.ts`, testadas em `regras.test.ts`)

- **Nome no SAMU+ → código do catálogo:** primeiro o código exato
  (`CB 02 (A)` → CB02); depois, para quem sobrou, o número (`PB 60 [A]` →
  BR60, viatura remanejada). Motos (`MT`) e unidades de evento (`FV 02`) ficam
  fora do catálogo.
- **No hospital:** a até 150 m do prédio. Só sai a mais de 200 m (o GPS
  oscila na borda). Parada a até 150 m da **própria base** não conta (a base do
  Pau Miúdo fica entre o HGESF e o Mário Leal; a de Cajazeiras, a 60 m do
  Municipal). Moto e desativada não entram na conta.
- **Alerta:** 40 min. Sem posição nova há 15 min o relógio congela; sem
  posição há 1 h a parada fecha como `sem-sinal`.
- **Situação de cada viatura:** `mapa` (posição da última hora) ·
  `sem-sinal` · `fora-do-turno` (SD e 10h entre 19h e 7h — o horário exato do
  10h é suposição) · `desativada` (lista `DESATIVADAS_ATE_SEGUNDA_ORDEM` ou
  cadastro oficial). Quem transmite aparece, mesmo que a planilha diga que
  está desativada.

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
