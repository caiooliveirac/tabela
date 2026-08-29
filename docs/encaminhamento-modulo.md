# Módulo de encaminhamento — para onde levar ESTE paciente

Status: **em produção** (aba Destino). Este arquivo guarda as decisões de
desenho; o mapa do Google e a busca por endereço estão na seção
[Mapa Google e busca por endereço](#mapa-google-e-busca-por-endereço).

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
| Lugares | **291** — bairro, largo, estação, terminal, ilha e referência |
| Rotas | 268 × 7 = **1.876 linhas**, da Routes API do Google |
| Sem rota | **23 povoados de ilha** na Baía de Todos os Santos |
| Seed | [`api/src/data/locais-salvador.json`](../api/src/data/locais-salvador.json), committado |
| Tabela | `bairro_rotas`, criada e semeada no boot (mesmo padrão de `initUpaRestrictions`) |
| Regerar | `python3 scripts/gerar-locais.py` — única coisa que gasta cota |

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

## Lugares, não só bairros

A regulação não fala a divisão oficial: fala largo, estação, terminal, rótula
e apelido. O índice tem **291 lugares** e **10 apelidos**.

| Tipo | Quantos | Fonte |
|---|---|---|
| bairro | 182 | OpenStreetMap |
| terminal | 26 | OpenStreetMap |
| localidade | 22 | OpenStreetMap |
| largo | 19 | OpenStreetMap |
| referência | 19 | Google, curadas à mão |
| estação | 17 | OpenStreetMap |
| ilha | 6 | OpenStreetMap |

### O que o OSM não serve

Só as categorias geográficas entram. As comerciais foram testadas e
descartadas: `shop=mall` traz estação de rádio, `amenity=marketplace` traz
mercadinho, `landuse=residential` traz 505 prédios e condomínios. Volume sem
curadoria não é cobertura — é ambiguidade de busca.

O que falta dessas categorias entra por `REFERENCIAS` em
`scripts/gerar-locais.py`: geocodificado no Google um a um e conferido pelo
endereço devolvido.

### Duas guardas contra coordenada inventada

Aprendidas errando, na primeira rodada:

- **Endereço devolvido que começa com "Salvador"** é o "não achei" do
  geocoder. Foi assim que *Rótula do Shopping* virou o centroide da cidade e
  quase virou apelido da Arena Fonte Nova, a 309 m dali.
- **Referência imprecisa a menos de 400 m de um lugar que já existe** vira
  apelido dele, não ponto novo. *Farol da Barra* é a Barra; *Vale do Canela* é
  o Canela.

### Dois nomes que não podem ser buscáveis

`salvador` e `largo` existem no OSM e foram barrados. A busca por conteúdo
prefere o termo mais longo — e como quase todo endereço digitado termina em
"Salvador", ele venceria a Pituba em "Rua X, 200, Pituba, Salvador". Há teste
travando os dois.

### Apelidos

`APELIDOS` no gerador mapeia como se fala para a chave do lugar real:
`iguatemi` → Shopping da Bahia, `cab` → Centro Administrativo, `fonte nova` →
Arena Fonte Nova. Custa zero: nenhuma chamada de API, nenhuma linha de rota.
Acrescentar é uma linha.

Nome de patrocinador é normalizado por `RENOMEAR` — o OSM diz "Casa de Apostas
Arena Fonte Nova", o painel diz "Arena Fonte Nova".

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

## O mapa

Segunda forma de dizer onde é a ocorrência: clicar. Tiles do **OpenStreetMap
via Leaflet** — sem chave no navegador, sem SKU novo, sem superfície de
cobrança. É a mesma base de onde vieram os 291 lugares do índice.

O Leaflet são ~150 KB e carrega **sob demanda** (`React.lazy`), não no bundle
principal: quem nunca abre a aba Destino não paga por ele.

### O clique não vira rota nova

Calcular a rota do ponto exato traria a API do Google de volta para o caminho
crítico do plantão — exatamente o que a materialização evitou. Em vez disso o
servidor **encaixa** o clique no lugar conhecido mais próximo e reusa a rota já
pronta.

Isso é uma aproximação, e o módulo não a esconde:

| Distância do encaixe | O que acontece |
|---|---|
| até 800 m | linha cinza: *"Tempo calculado a partir de Saramandaia, 186 m do ponto que você clicou"* |
| 800 m a 3 km | mesma linha, em âmbar |
| acima de 3 km | **não ranqueia** — lista clínica sem tempo, pedindo um clique mais perto |

O mapa desenha os dois pontos e a linha tracejada entre eles, para o tamanho da
aproximação ser visível e não uma nota de rodapé.

### De onde vieram os números

Medindo o índice: a distância de cada lugar ao vizinho mais próximo tem
mediana de **406 m** e p90 de **1.017 m** — mas a periferia é pior, com
**Valéria a 2,3 km** e **Cassange a 2,2 km**. Por isso o teto é 3 km: acima
disso o clique caiu na baía ou fora da malha urbana, onde o pior caso medido
chega a 10,5 km. Aproximar 300 m é útil; aproximar 5 km é inventar.

Os limites do mapa e a validação no servidor recusam ponto fora da região de
Salvador antes mesmo do encaixe.

## O índice aprende com quem usa

Nenhuma lista de lugares fica pronta. Quando a busca não acha nada, o módulo
faz duas coisas:

1. **Diz o que fazer agora.** *"Não conhecemos «X». Pergunte a quem está na
   cena qual é o bairro mais próximo."* A lista clínica aparece mesmo assim,
   sem ordem de distância — saber QUAIS hospitais podem receber já é metade da
   decisão, e é melhor que uma tela vazia.
2. **Registra o termo** em `locais_nao_encontrados`, com contagem. O que
   aparece ali com contagem alta é bairro, conjunto ou apelido que falta.

### Curadoria

```bash
ssh magalu 'docker exec tabela-db-1 psql -U tabela -d tabela -c "select termo, vezes, ultima_em from locais_nao_encontrados order by vezes desc limit 30"'
```

Termo que se repete vira entrada em `APELIDOS` ou `REFERENCIAS` no
`scripts/gerar-locais.py`. Apelido é de graça — nenhuma chamada de API,
nenhuma linha de rota. Referência nova exige regerar o seed.

### Duas ressalvas

**Fragmentos de digitação entram junto.** A busca dispara a cada 300 ms, então
quem digita devagar registra "cajaz" e "cajazei" além do nome inteiro. A
curadoria ordena por `vezes` e o nome completo sobe acima dos pedaços. Termo
com menos de 4 caracteres não é registrado.

**O conteúdo é sensível.** A tabela guarda só o termo normalizado e a
contagem — sem autor, sem IP, sem ligação com caso, nada em que dar join. Mas
é texto digitado livre e pode conter o endereço de uma ocorrência: mesmo
cuidado de `cases.caso`, e nunca em rota pública.

## Pendências além das matrizes

- **Mapa intel → recurso**: a intel é texto livre ("sem tomógrafo"). Para ela
  derrubar um recurso é preciso saber qual recurso ela derruba. Campo novo no
  modal de alerta, ou casamento por palavra-chave?
- **Maternidades**: fica em repo próprio, fora deste módulo. O usuário quer
  reativá-lo — tarefa separada, não escopo daqui.
- **Endereço livre fora de lugar conhecido**: ~~hoje o casamento é por nome~~
  resolvido pelo autocomplete do Google (seção abaixo): o endereço vira
  coordenada no navegador e entra no fluxo do clique — encaixe no lugar
  conhecido, rota materializada. O registro em `locais_nao_encontrados`
  continua valendo como trilha de curadoria do índice.

## Mapa Google e busca por endereço

Desde 2026-08 a aba Destino usa o mapa do Google quando o servidor tem
`GOOGLE_MAPS_BROWSER_KEY`; sem a variável (LAB sem chave, script fora do ar) o
painel cai no Leaflet/OSM de antes, que continua no repo como fallback. A
decisão nº 1 não mudou: **o ranking segue saindo das rotas materializadas no
Postgres**. O Google entrou como camada de visual e de busca — se ele cair no
meio do plantão, o que se perde é desenho de rota e sugestão de endereço,
nunca a lista de destinos.

O que a camada Google acrescenta:

- **Rotas plotadas**: os três primeiros destinos com tempo ganham a rota
  desenhada no mapa, na cor da posição do ranking (azul, roxo, verde-azulado);
  o pino do hospital ganha o mesmo número do card. A linha é geometria
  (Directions, uma chamada por destino, com cache por sessão); o tempo exibido
  continua o materializado.
- **Busca por rua e ponto de referência**: o campo "Onde é a ocorrência"
  sugere endereços do Google (Places Autocomplete, restrito à caixa da RMS,
  com session token). Escolher uma sugestão vira coordenada e reusa o fluxo do
  clique no mapa: encaixe no lugar conhecido mais próximo + aviso do tamanho
  da aproximação. Bairro, largo e apelido continuam resolvendo primeiro no
  índice local, de graça.

### Chaves — nunca reusar a de servidor

| Variável | Onde vive | Para quê |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | `.env` (server-side) | só o `gerar-locais.py`, fora do ar |
| `GOOGLE_MAPS_BROWSER_KEY` | `.env` → compose → `/tabela/api/encaminhamento/config` | Maps JS no navegador |
| `GOOGLE_MAPS_MAP_ID` | idem (opcional) | estilo do mapa; sem ela usa `DEMO_MAP_ID` |

A chave de navegador aparece no bundle por definição — a proteção é a
restrição no console do Google, não o esconderijo:

1. Criar chave nova em APIs & Services → Credentials.
2. Application restriction: **HTTP referrers** → `https://mnrs.com.br/*`
   (e `http://localhost:4001/*` se quiser Google no LAB).
3. API restriction: **Maps JavaScript API**, **Places API (New)** e
   **Directions API** — nada além.
4. `GOOGLE_MAPS_BROWSER_KEY=...` no `.env` do LIVE (e do LAB, se for o caso).

Custo por consulta na aba: 1 map load por abertura da aba, ~1 sessão de
Autocomplete por endereço escolhido, até 3 Directions por origem nova (com
cache na sessão). No volume da regulação (dezenas de consultas/dia) isso fica
dentro da cota gratuita mensal por SKU do Google Maps Platform; conferir os
preços vigentes no console antes de mudar a escala.

### Estudo — como crescer o índice de lugares

O índice tem 291 lugares e a mediana do encaixe é 406 m; o problema é a cauda
(Valéria e Cassange, vizinho a mais de 2 km). As alavancas, da mais barata
para a mais cara:

1. **Apelidos** (`APELIDOS` no `gerar-locais.py`): custo zero — nenhuma
   chamada de API, nenhuma linha de rota nova. Primeiro lugar para gastar
   curadoria.
2. **Colheita de `locais_nao_encontrados`**: o que a regulação procurou e não
   achou já está anotado. Curadoria mensal:
   `SELECT termo, vezes FROM locais_nao_encontrados ORDER BY vezes DESC LIMIT 50;`
   — nome completo vira `REFERENCIAS` (vira ponto novo, geocodificado com as
   duas guardas do script) ou `APELIDOS` (vira sinônimo, de graça).
3. **Categorias novas do OSM**: candidatas com bom sinal são
   `amenity=university`/`amenity=college` (a "frente da faculdade" é endereço
   de ocorrência) e `leisure=park`. Escola municipal são centenas com nomes
   parecidos — volume sem curadoria vira ambiguidade de busca, que foi o
   motivo de barrar `shop=mall` e `landuse=residential` na primeira rodada.
4. **Regerar o seed**: cada rodada do `gerar-locais.py` custa a matriz
   (lugares × 7 hospitais, Routes API) — na casa de centenas de lugares é
   dezena de dólares, e o diff do JSON mostra o que mudou antes do commit.

**Rua não entra no banco, e agora não precisa.** Salvador tem >10 mil vias:
materializar rota por rua custaria ~US$ 350 por rodada, o centroide de uma via
longa mente mais que o encaixe de 400 m, e a busca por rua já é exatamente o
que o Autocomplete resolve com precisão de número de porta — pagando por uso,
só quando alguém procura.
