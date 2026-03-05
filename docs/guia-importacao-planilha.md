# Guia: Importar Planilha de Regulações via Screenshot

## Contexto

Durante a fase de transição, os plantonistas do SAMU Salvador ainda usam uma planilha Google Sheets para registrar regulações. Este guia ensina um agente de IA (ou humano) a consumir uma captura de tela da planilha e alimentar o banco de dados do Painel de Vagas.

## Pré-requisitos

- API rodando (local: `http://localhost:3001`, produção: ajustar URL)
- Acesso à rota `POST /tabela/api/cases/bulk-import`

---

## Passo 1 — Ler o Screenshot

A planilha segue este layout fixo:

| Coluna A | Coluna B | Coluna C | Coluna D | Coluna E | Coluna F           | Coluna G |
| -------- | -------- | -------- | -------- | -------- | ------------------ | -------- |
| HOSPITAL | HORÁRIO  | SITUAÇÃO | CASO     | MR       | MÉDICO QUE RECEBEU | OC       |

- **Linha 1**: Data do plantão (ex: `05/03/2026`)
- **Linha 2**: Cabeçalho (ignorar)
- **Linhas 3+**: Dados das regulações

### Formato dos dados

| Campo    | Exemplo                    | Regra                                  |
| -------- | -------------------------- | -------------------------------------- |
| HOSPITAL | `HGE`, `HGESF`, `MENANDRO` | Nome maiúsculo do hospital             |
| HORÁRIO  | `10:34`, `13:25`           | Formato HH:MM                          |
| SITUAÇÃO | `ACEITO` ou `ZERO`         | Apenas estes dois valores              |
| CASO     | `TCE COM SINAIS DE HIC`    | Texto livre, pode estar vazio          |
| MR       | `Karen`, `Luiz Eduardo`    | Nome do médico regulador               |
| MÉDICO   | `Rubem`, `Flavia`          | Nome do médico que recebeu             |
| OC       | `0188`, `0476`             | Número da ocorrência, pode estar vazio |

### Lado direito (tabela resumo)

A planilha tem uma tabela automática no lado direito com ACEITOS / ZERO / TOTAL por hospital. Use-a para **validar** os dados parseados antes de importar.

---

## Passo 2 — Mapear nomes de hospital para IDs

O banco usa IDs snake_case. Mapeamento completo:

```
HOSPITAL (planilha)    → hospitalId (API)
─────────────────────────────────────────
HGE                    → hge
HGESF                  → hgesf
HGRS                   → hgrs
METROPOLITANO          → metropolitano
SUBÚRBIO               → suburbio
MENANDRO               → menandro
ELÁDIO                 → eladio
MUNICIPAL              → municipal
JULIANO MOREIRA        → juliano_moreira
MÁRIO LEAL             → mario_leal
COUTO MAIA             → couto_maia
```

> **Atenção**: `SUBÚRBIO` → `suburbio` (sem acento), `ELÁDIO` → `eladio` (sem acento).

---

## Passo 3 — Montar JSON de importação

Converter a data da linha 1 de `DD/MM/YYYY` para `YYYY-MM-DD`.

Formato do payload:

```json
{
  "date": "2026-03-05",
  "operador": "import-planilha",
  "cases": [
    {
      "hospitalId": "hgesf",
      "horario": "10:00",
      "situacao": "ACEITO",
      "caso": "POS PCR",
      "mr": "Luiz Eduardo",
      "medico": "Flavia",
      "oc": "0227"
    },
    {
      "hospitalId": "hge",
      "horario": "10:34",
      "situacao": "ACEITO",
      "caso": "TCE COM SINAIS DE HIC",
      "mr": "Mariana",
      "medico": "Rubem",
      "oc": "0188"
    }
  ]
}
```

### Regras de conversão

1. `SITUAÇÃO` → `situacao`: manter `"ACEITO"` ou `"ZERO"` (a planilha mostra `ZERO` para vaga zero)
2. `HORÁRIO` → `horario`: manter `HH:MM`
3. `CASO` → `caso`: texto livre. Se vazio, usar `null`
4. `OC` → `oc`: string. Se vazio, usar `null`
5. Remover acentos dos IDs de hospital (ver mapeamento acima)
6. `operador`: sempre `"import-planilha"` para rastreabilidade

---

## Passo 4 — Enviar para a API

### Via curl (salvar JSON em arquivo primeiro)

```bash
# Salvar o JSON em um arquivo temporário
cat > /tmp/import.json << 'EOF'
{
  "date": "2026-03-05",
  "operador": "import-planilha",
  "cases": [ ... ]
}
EOF

# Enviar
curl -s -X POST http://localhost:3001/tabela/api/cases/bulk-import \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/import.json

# Limpar
rm /tmp/import.json
```

> **Não enviar JSON inline no curl** — acentos e aspas causam parsing errors no zsh.

### Resposta esperada

```json
{
  "message": "Importados 18 casos para 2026-03-05",
  "count": 18
}
```

---

## Passo 5 — Validar

Comparar a tabela ACEITOS/ZERO/TOTAL do lado direito da planilha com o retorno da API:

```bash
curl -s http://localhost:3001/tabela/api/hospitals | python3 -c "
import json,sys
d = json.load(sys.stdin)
for h in d['hospitals']:
    if h['total']>0:
        print(f\"{h['name']:20s} A:{h['aceitos']} Z:{h['zeros']} T:{h['total']}\")
print(f\"Total: {sum(h['total'] for h in d['hospitals'])} casos\")
"
```

Os números devem bater exatamente com a tabela resumo da planilha.

---

## Comportamento da Rota

| Aspecto         | Detalhe                                                                |
| --------------- | ---------------------------------------------------------------------- |
| **Idempotente** | Sim — apaga todos os casos do dia antes de inserir                     |
| **Timezone**    | UTC-3 (Bahia). Os horários da planilha são tratados como horário local |
| **WebSocket**   | Emite evento `refresh` após importação — todos os clients atualizam    |
| **Soft delete** | A rota faz `DELETE` real dos registros do dia, não soft delete         |

---

## Exemplo Completo (screenshot → JSON)

### Screenshot recebido:

```
05/03/2026
HOSPITAL    HORÁRIO  SITUAÇÃO  CASO                  MR            MÉDICO   OC
HGESF       10:00    ACEITO    POS PCR               Luiz Eduardo  Flavia   0227
HGE         10:34    ACEITO    TCE COM SINAIS DE HIC Mariana       Rubem    0188
SUBÚRBIO    13:25    ZERO      HEMATEMESE             Luiz Eduardo  Rafael   0471
```

### JSON gerado:

```json
{
  "date": "2026-03-05",
  "operador": "import-planilha",
  "cases": [
    {
      "hospitalId": "hgesf",
      "horario": "10:00",
      "situacao": "ACEITO",
      "caso": "POS PCR",
      "mr": "Luiz Eduardo",
      "medico": "Flavia",
      "oc": "0227"
    },
    {
      "hospitalId": "hge",
      "horario": "10:34",
      "situacao": "ACEITO",
      "caso": "TCE COM SINAIS DE HIC",
      "mr": "Mariana",
      "medico": "Rubem",
      "oc": "0188"
    },
    {
      "hospitalId": "suburbio",
      "horario": "13:25",
      "situacao": "ZERO",
      "caso": "HEMATEMESE",
      "mr": "Luiz Eduardo",
      "medico": "Rafael",
      "oc": "0471"
    }
  ]
}
```

---

## Checklist para o Agente

- [ ] Extrair data da linha 1 → converter `DD/MM/YYYY` → `YYYY-MM-DD`
- [ ] Ler cada linha de dados (a partir da linha 3)
- [ ] Mapear nome do hospital para ID (ver tabela acima)
- [ ] Tratar `SITUAÇÃO`: `ACEITO` ou `ZERO` (exatamente)
- [ ] Campos vazios de CASO e OC → `null` no JSON
- [ ] Salvar JSON em arquivo temporário (evitar inline no shell)
- [ ] Enviar via `curl --data-binary @arquivo.json`
- [ ] Validar totais A/Z/T contra a tabela resumo da planilha
- [ ] Remover arquivo temporário
- [ ] Confirmar ao usuário com os totais importados
