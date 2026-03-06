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
