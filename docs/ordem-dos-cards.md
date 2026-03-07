# Ordem dos Cards no Painel (`/tabela`)

Este documento descreve **onde** a ordem dos cards é definida hoje e **como** ela é calculada, para orientar futuras refatorações do motor de ranqueamento.

## Visão geral

A ordem final dos cards depende de **duas camadas**:

1. **Backend (score engine)**: calcula `score`, `sem`, métricas e payload por hospital.
2. **Frontend (Dashboard)**: separa por categoria e aplica a ordenação de exibição.

---

## 1) Backend: cálculo de score e dados do card

### Arquivo

- `api/src/services/score.ts`

### Função principal

- `compute(allCases, allIntel, rst)`

### O que essa função faz

- Filtra casos ativos para:
  - **semáforo**: casos a partir de `rst` (reset das 07:00)
  - **timeline**: últimas 24h
- Agrupa por hospital (`groups[hospitalId]`)
- Calcula, por hospital:
  - `total`, `zeros`, `aceitos`, `taxa`
  - `lc` (último caso), `lz` (último vaga zero), `la` (último aceito)
  - `score` (0..100)
  - `sem` (`green` | `yellow` | `red`)
- Regra especial: `lz` só aparece no card por até 6h (`lzShow`).

### Fórmula atual de score (resumo)

Base:

- inicia em `50`

Ajustes:

- Último caso:
  - `ACEITO`: `+20`
  - `ZERO`: `-25`
- Vaga zero recente:
  - `< 30min`: `-20`
  - `< 60min`: `-10`
  - `< 120min`: `-5`
- Aceite recente:
  - `< 30min`: `+15`
  - `< 60min`: `+8`
- Taxa de aceite:
  - `>= 0.8`: `+10`
  - `< 0.4`: `-10`
- Intel ativa:
  - `lotado`: `-20`
  - `sem_especialista`: `-10`
  - `sem_recurso`: `-15`
  - `aceitando_bem`: `+15`
  - `normalizado`: `+10`

Pós-processamento:

- clamp para `[0, 100]`
- semáforo por score:
  - `< 30` => `red`
  - `< 55` => `yellow`
  - senão => `green`

---

## 2) Backend: endpoint que entrega os cards

### Arquivo

- `api/src/routes/hospitals.ts`

### Função/rota

- `GET /tabela/api/hospitals`

### Fluxo

- Calcula `rst` via `resetTs()`
- Busca casos (24h) e intel
- Chama `compute(...)`
- Retorna:
  - `hospitals` (array com `HospitalData`)
  - `timelineCases`
  - `resetTimestamp`

---

## 3) Frontend: ordem visual dos cards

### Arquivo

- `web/src/components/Dashboard.tsx`

### Pontos-chave

A ordenação por categoria é feita em três `useMemo`:

- `geral`: `filter(cat === "geral").sort((a, b) => b.score - a.score)`
- `psiq`: `filter(cat === "psiq").sort((a, b) => b.score - a.score)`
- `infecto`: `filter(cat === "infecto")` (**sem sort explícito**)

Renderização:

- seção **Geral** usa `Grid(geral)`
- seção **Psiquiatria** usa `Grid(psiq)`
- seção **Infectologia** renderiza `infecto` diretamente (ordem original do array)

---

## 4) Fonte da ordem base dos hospitais

A lista de hospitais vem de:

- `api/src/services/score.ts` (`HOSPITALS`)

Essa ordem é a ordem-base para categorias sem `sort` explícito (ex.: infecto hoje).

---

## 5) Para refatorar com segurança

Checklist mínimo:

1. Centralizar pesos/regras do score em configuração testável.
2. Manter contrato de saída (`HospitalData`) para não quebrar o Dashboard.
3. Definir explicitamente a ordenação de **todas** as categorias no frontend.
4. Cobrir com testes de:
   - transição de semáforo (`green/yellow/red`)
   - peso por tipo de intel
   - efeito de recência (`mAgo`) e janela de 6h do `lz`
   - empate de score (critério secundário, se for introduzido)

---

## Referências rápidas (arquivos)

- `api/src/services/score.ts`
- `api/src/routes/hospitals.ts`
- `web/src/components/Dashboard.tsx`

---

## 6) Reset diário dos cards às 07:00

### Onde está hoje

- `api/src/services/score.ts`
- função: `resetTs()`

Trecho atual:

- cria `new Date()`
- faz `setHours(7, 0, 0, 0)`
- se o horário atual ainda não passou de 07:00, volta um dia
- retorna esse timestamp como início da janela dos cards

### Como isso é usado

- `api/src/routes/hospitals.ts`
  - chama `const rst = resetTs()`
  - passa `rst` para `compute(allCases, allIntel, rst)`
  - devolve `resetTimestamp` para o frontend

- `api/src/services/score.ts`
  - `semaphoreCases = activeCases.filter((c) => c.timestamp.getTime() >= rst)`
  - ou seja: **os cards do semáforo só consideram casos a partir do reset diário**

- `web/src/components/Dashboard.tsx`
  - filtra de novo com `resetTimestamp`
  - `c.ativo && new Date(c.timestamp).getTime() >= rst`

### Problema importante de fuso

Hoje `resetTs()` usa `Date` no **fuso local do servidor**.

Se o servidor estiver em UTC, então o reset efetivo ocorre às **07:00 UTC**, e não às **07:00 GMT-3 / São Paulo-Salvador**.

Isso explica o comportamento observado de os casos sumirem dos cards às 07:00 UTC.

### Conclusão prática

Se a regra correta é:

- **reiniciar os cards às 07:00 do Brasil (GMT-3)**

então o ponto certo para corrigir é:

- `resetTs()` em `api/src/services/score.ts`

e, idealmente, toda regra dependente de hora operacional deve usar um fuso explícito, não o relógio local implícito do servidor.

---

## 7) Janela da lista de casos

### Onde está hoje

- `api/src/routes/cases.ts`
- `api/src/routes/hospitals.ts`
- `api/src/services/score.ts`

### Regra atual

- endpoint [api/src/routes/cases.ts](api/src/routes/cases.ts) retorna **últimas 24h**
- endpoint [api/src/routes/hospitals.ts](api/src/routes/hospitals.ts) também busca casos das **últimas 24h**
- dentro do motor:
  - `timelineCases = activeCases.filter((c) => hoursAgo(c.timestamp) < 24)`

Então hoje existem duas janelas paralelas:

1. **Cards / semáforo** → desde o reset das 07:00
2. **Timeline / lista de casos** → últimas 24h

Isso bate com a sensação atual:

- o card “zera” no reset diário
- a lista continua mostrando histórico mais longo, até ~24h

---

## 8) Duração dos alertas (`intel`)

### Onde está hoje

- `api/src/routes/intel.ts`
- `api/src/services/score.ts`
- `web/src/components/IntelModal.tsx`

### Estado atual

- alertas `intel` **não expiram automaticamente no banco**
- eles ficam ativos até remoção manual (`DELETE /api/intel/:id` → soft delete)
- o score usa **decay** para alguns tipos, mas isso só afeta o peso do semáforo, não a existência do alerta

Exemplo em `score.ts`:

- `lotado`, `aceitando_bem`, `normalizado` entram no score com decay
- porém continuam ativos visualmente até remoção manual

### O que isso significa hoje

- operacionalmente, o sistema já está mais próximo de **“alerta persiste até conferência humana”**
- isso faz bastante sentido para eventos estruturais como:
  - `sem_recurso`
  - equipamento quebrado
  - tomografia indisponível
  - ausência prolongada de especialista

---

## 9) Sugestão de política para duração dos alertas

Uma política coerente seria separar alertas em dois grupos:

### A. Alertas que devem sumir só manualmente

Recomendado para:

- `sem_recurso`
- `sem_especialista`
- qualquer indisponibilidade estrutural

Motivo:

- esses eventos precisam de reconfirmação humana
- expirar sozinho pode esconder um problema ainda vigente

### B. Alertas que podem ter validade curta ou semiautomática

Possível para:

- `lotado`
- `aceitando_bem`
- `normalizado`
- `pretendo_enviar`

Motivo:

- são estados mais operacionais e fluidos
- podem envelhecer rápido

### Modelo híbrido recomendado

Se quiser manter segurança operacional:

- **persistência manual no banco para todos**
- mas com **sinal visual de envelhecimento** no frontend
- e talvez uma classificação tipo:
  - `alerta recente`
  - `alerta antigo — confirmar`

Isso evita apagar automaticamente algo crítico, mas também evita que o painel pareça “congelado”.

---

## 10) Próximo ponto natural de decisão

Se a ideia for evoluir isso com segurança, as decisões de produto mais importantes são:

1. O reset das 07:00 deve ser em qual fuso oficial? **GMT-3 explícito**.
2. A timeline continua em 24h ou passa a ser “turno atual + anterior”? 
3. Quais tipos de `intel`:
   - expiram só no score,
   - expiram visualmente,
   - ou só somem com remoção manual.

Hoje, pelo contexto operacional, a decisão mais segura parece ser:

- **casos**: reset diário às 07:00 GMT-3 nos cards
- **timeline/lista**: manter 24h
- **sem_recurso**: remover só manualmente
- **sem_especialista**: limpar automaticamente no reset de 07:00 GMT-3
- **lotado**: limpar automaticamente 12h após o lançamento
- **aceitando_bem / normalizado**: podem receber aviso de “confirmar” após envelhecer
