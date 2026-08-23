# Módulo de encaminhamento — para onde levar ESTE paciente

Status: **desenho**. Nada implementado ainda.

Não confundir com [`destinos-regulacao.md`](destinos-regulacao.md): aquele é
retrospectivo ("para onde os pacientes foram"), compilado pelo bot. Este é
prospectivo — dado um endereço e um perfil clínico, ranqueia destinos.

## O que o app já tem e o que falta

| Camada | Existe hoje? |
|---|---|
| Capacidade instalada (quem atende o quê) | **Não.** Os 11 hospitais só têm `cat` (`geral`/`psiq`/`infecto`) |
| Geografia (endereço → distância) | **Não.** Nenhum lat/lng, bairro ou endereço no banco |
| Comportamento em tempo real (aceita/nega) | **Sim** — score v3.1, `api/src/services/score.ts` |

## Decisões travadas

1. **Distância**: tempo de carro **pré-materializado por bairro** numa tabela
   do nosso Postgres. Em plantão a API do Google **não é chamada**: chave
   vencida, cota estourada ou link caído não derrubam o ranking.
2. **Capacidade**: config versionada no repo. Muda por commit + `labctl
   promote`, com histórico no git. Chefia não edita pela tela.
3. **Ordenação**: filtro duro de capacidade **primeiro**, distância depois.
   O semáforo de aceitação aparece no card como aviso e **não** altera a
   ordem — o regulador vê que o primeiro está negando e decide.
4. **UI**: aba nova, somente consulta. Não grava caso, não conversa com o
   resto do painel. O médico abre quando quer hospital — UPA não entra no
   ranking, e por isso gravidade não vira eixo do módulo.
5. **Cobertura**: Salvador. Destinos = os 11 hospitais que o painel já tem.
6. **Recurso indisponível hoje**: intel `sem_recurso` / `sem_especialista`
   que derruba um recurso exigido pelo perfil **tira o hospital do ranking**,
   com uma linha explícita dizendo o motivo e desde quando — nunca some calado.

### Por que o filtro vem antes da distância

Hospital sem hemodinâmica não entra no ranking de IAM com suspeita de oclusão
coronariana nem se a ocorrência for na porta dele. O veto é categórico, não é
penalidade de pontuação.

## As duas matrizes

Ditado pela regulação em 2026-08-23, em quatro rodadas. Implementado em
[`api/src/services/encaminhamento.ts`](../api/src/services/encaminhamento.ts),
com teste travando cada veto — mexer na config e quebrar um veto falha o build.

### Quem participa

**7 dos 11 hospitais do painel.** Ficam de fora **por decisão**, não por falta
de dado: Menandro não participa da feature, e Juliano Moreira, Mário Leal e
Couto Maia saem junto com os perfis psiquiátrico e infeccioso, que não entram
neste fluxo. Continuam normais no resto do painel; aqui não aparecem nem como
elegíveis nem como excluídos.

### Matriz A — perfil de cada hospital

| Hospital | Atende | Não recebe | Ressalva |
|---|---|---|---|
| HGE | trauma (inclui vascular, pediátrico e fratura exposta), queimados | todo o resto — é hospital **só** de trauma | não faz fratura cirúrgica pediátrica |
| HGRS (Roberto Santos) | cardiologia (referência, com hemodinâmica), hemorragia digestiva, AVC, clínica pediátrica, intoxicação, vascular | **trauma**, em qualquer forma | o vascular dele não cobre trauma |
| Subúrbio | trauma (inclui vascular e fratura exposta), clínico complexo, cirúrgico não-trauma, AVC, hemorragia digestiva, IAM sem supra, intoxicação, vascular, **pediatria completa** com UTI pediátrica | — | "basicamente tudo". Único destino de fratura cirúrgica pediátrica |
| Municipal | trauma, fratura exposta, clínico complexo, cirúrgico não-trauma, AVC, hemorragia digestiva, intoxicação, trauma e clínica pediátricos, UTI pediátrica | **cardiológico** (bloqueado), cirurgia vascular | material ortopédico incompleto: confirmar a lesão. Não faz fratura cirúrgica pediátrica |
| Metropolitano | trauma, clínico complexo, cirúrgico não-trauma, AVC, hemorragia digestiva, IAM sem supra, crônico/sepse/paliação, intoxicação | hemodinâmica (**IAM com supra**), vascular, fratura exposta, pediatria | fica longe; a distância já o joga pro fim sozinha |
| Eládio Lassèrre | crônico, sepse, IAM sem supra, paliação, intoxicação | teto: só o que resolve com clínico + UTI | — |
| HGESF (Ernesto) | cirurgia não-trauma, clínico de média complexidade, IAM sem supra, intoxicação, vascular fora de trauma | neurocirurgia, hemodinâmica, **trauma** | — |

### Matriz B — 18 perfis clínicos

Ordem dentro de cada linha é por distância. A lista é o conjunto elegível.

| Perfil | Elegíveis |
|---|---|
| Trauma | HGE, Subúrbio, Municipal, Metropolitano |
| Trauma com suspeita vascular | Subúrbio, HGE |
| Fratura exposta | HGE, Subúrbio, Municipal |
| Trauma pediátrico | HGE, Subúrbio, Municipal |
| Fratura cirúrgica pediátrica | **Subúrbio** |
| Queimado | **HGE, sempre** |
| IAM com supra / suspeita de oclusão | **Roberto Santos** |
| IAM sem supra | Roberto, Ernesto, Eládio, Metropolitano, Subúrbio |
| Cardiológico (demais) | Roberto, Ernesto, Eládio, Metropolitano, Subúrbio |
| AVC | Roberto, Subúrbio, Municipal, Metropolitano |
| Hemorragia digestiva | Roberto, Subúrbio, Municipal, Metropolitano |
| Cirúrgico não-trauma | Subúrbio, Municipal, Ernesto, Metropolitano, Eládio |
| Cirúrgico vascular (não-trauma) | Subúrbio, Roberto, Ernesto |
| Clínico de alta complexidade | Subúrbio, Municipal, Ernesto, Metropolitano, Roberto |
| Crônico, sepse ou paliação | Eládio, Metropolitano, Ernesto |
| Urgência dialítica | Metropolitano, Ernesto, Subúrbio, Roberto |
| Clínica pediátrica | Roberto, Subúrbio, Municipal |
| Intoxicação | Eládio, Ernesto, Municipal, Subúrbio, Roberto, Metropolitano |

Obstétrico **não** entra: vai para o repo `maternidades`, separado, a reativar.

### Por que vascular e fratura exposta viraram perfil próprio

Metropolitano recebe trauma, mas não tem vascular e não opera fratura exposta.
Se isso ficasse como nota de rodapé dentro do perfil "trauma", viraria texto
que ninguém lê às 3 da manhã. Como perfil próprio, o veto é o próprio filtro.

### Ressalvas que o sistema não sabe julgar

- **Municipal + lesão ortopédica**: *"tem que ver bem que lesão é, porque não
  tem material para operar de tudo"*. O sistema não conhece a lesão. O máximo
  honesto é ranquear o Municipal e pendurar o aviso — decidir por baixo disso
  seria fingir que sabe.
- **Metropolitano em trauma**: mesma coisa, avisando que não cobre fratura
  exposta nem lesão vascular, para o regulador trocar de perfil se for o caso.

## Camada geográfica — materializada, sem dependência de API

Decisão de 2026-08-23: o tempo de carro de **cada bairro de Salvador até cada
um dos 7 hospitais** é calculado uma vez, fora do ar, e vive numa tabela do
nosso Postgres. Nenhuma chamada ao Google acontece durante o plantão.

| | |
|---|---|
| Bairros | **183**, do OpenStreetMap (nome + centroide, grátis, sem chave) |
| Rotas | 180 × 7 = **1.260 linhas**, da Routes API do Google |
| Sem rota | **3 ilhas** — Maré, Frades, Bom Jesus dos Passos |
| Seed | [`api/src/data/bairros-salvador.json`](../api/src/data/bairros-salvador.json), 54 KB, committado |
| Tabela | `bairro_rotas`, criada e semeada no boot (mesmo padrão de `initUpaRestrictions`) |
| Regerar | `python3 scripts/gerar-bairros.py` — única coisa que gasta cota |

A chave do Google passa a ser ferramenta de manutenção, não dependência de
produção. O servidor nunca precisa dela.

### As três ilhas não são bug

Ilha de Maré, Ilha dos Frades e Ilha de Bom Jesus dos Passos ficam na Baía de
Todos os Santos e **não têm estrada** para hospital nenhum — a Routes API
devolve as 21 rotas como inexistentes, corretamente. Ficam no índice de nomes
marcadas com `semRotaRodoviaria`, para o módulo dizer que ali não é caso de
ranking por tempo de carro em vez de devolver lista vazia (que o regulador
leria como falha) ou inventar uma ordem.

### Por que a busca por nome mora em código e a distância no banco

`bairros.ts` é puro: seed, normalização e busca, sem tocar em banco — dá para
testar sem subir servidor, como `destinosBot.ts`. `bairros-store.ts` é quem
fala com o Postgres. A separação não é estética: importar `db` puxa
`index.ts`, que sobe o Express inteiro e trava a suíte de teste.

A normalização tira acento, caixa e pontuação, então "São Caetano", "sao
caetano" e "SAO CAETANO." caem na mesma chave. A busca tenta, nesta ordem:
nome exato, bairro contido no texto (para "Rua X, 200, Pituba" achar a
Pituba), e prefixo (para quem ainda está digitando). Ambiguidade devolve todos
os candidatos — quem escolhe é quem regula.

## A aba Destino

Quarta aba do painel, logo **depois do Semáforo** — é a mesma pergunta por
outro ângulo: o semáforo diz quem está aceitando agora, o destino diz quem
*pode* receber este paciente e a que distância.

Duas entradas num card branco (bairro ou endereço · perfil do paciente) e um
ranking abaixo. Cada linha reusa o vocabulário visual do card de hospital:
barra de cor à esquerda, `glow` do score, chips de alerta iguais aos do
semáforo.

| Elemento | O que carrega |
|---|---|
| Número na bolinha escura | a **ordem** — que é a informação principal |
| Nome do hospital | identidade |
| Tempo grande à direita | minutos de carro, e km embaixo |
| Tag colorida | o **fato** que produziu a cor — nunca um rótulo |
| Linha âmbar | ressalva que o sistema não sabe julgar |
| Chips de alerta | a intel que já existe no painel |

A cor e a ordem carregam coisas diferentes de propósito: a posição vem da
distância, a cor vem do comportamento. Misturar as duas produziria um ranking
que ninguém consegue defender no telefone.

### A tag diz o fato, não o rótulo

"Aceitando" e "negando" eram interpretação — cada plantonista lia de um jeito e
ninguém sabia de quando era o dado. A tag agora carrega a contagem e a janela:

| Cor | Quando | Tag |
|---|---|---|
| 🔴 vermelho | recusou paciente nas últimas 3h | `2 vagas zero · 3h` |
| 🟡 amarelo | avisaram lotação há menos de 3h | `lotação avisada há 50min` |
| 🟢 verde | nada disso, mas aceitou na última hora | `aceitou há 25min` |
| 🟢 verde | nada disso | *sem tag* |

Vaga zero ganha da lotação porque uma é recusa registrada e a outra é
informação de corredor. Além de 3h, nada aparece: no plantão, dado de quatro
horas atrás não descreve mais a porta do hospital.

A janela é contada sobre os casos das últimas 24h, **não** sobre os do plantão
corrente — logo depois da virada das 07:00 a janela de 3h ficaria cega para a
madrugada.

### Quatro estados, nenhum deles tela vazia

| Situação | O que aparece |
|---|---|
| Bairro reconhecido | ranking por tempo |
| Texto casa com vários bairros | botões para escolher qual |
| Bairro desconhecido | lista por afinidade clínica, avisando que não há ordem de distância |
| Ilha sem estrada | lista clínica + aviso de que o transporte é aquaviário ou aéreo |

Embaixo, um bloco recolhido **"Fora desta lista (N)"** com cada hospital
excluído e o motivo. Some calado seria indistinguível de bug.

### Endpoints

`GET /tabela/api/encaminhamento/perfis` — preenche o seletor.
`GET /tabela/api/encaminhamento?local=…&perfil=…` — o ranking.

Só leitura, aberta como o resto do painel. Devolve apenas o que o servidor
sabe melhor que o navegador: quais hospitais o perfil permite e a que
distância. Score e alertas o painel já tem por `/hospitals` — recalcular aqui
seria manter duas verdades sobre a mesma coisa.

## Pendências além das matrizes

- **Mapa intel → recurso**: a intel é texto livre ("sem tomógrafo"). Para ela
  derrubar um recurso é preciso saber qual recurso ela derruba. Campo novo no
  modal de alerta, ou casamento por palavra-chave?
- **Maternidades**: fica em repo próprio, fora deste módulo. O usuário quer
  reativá-lo — tarefa separada, não escopo daqui.
- **Endereço fora de bairro conhecido**: hoje o casamento é por nome de
  bairro. Aceitar endereço livre ("Rua X, 200") exigiria geocodificar em
  tempo real — e aí a chave voltaria a ser dependência de plantão. Decidir se
  vale.
