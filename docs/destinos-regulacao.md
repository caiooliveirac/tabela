# `/destinos` — para onde os pacientes foram regulados

Comando do bot da chefia (`ReguladorSAMU_bot`). Mostra, por hospital de
destino e por turno, quantos pacientes foram regulados, quais eram os casos e
quem regulou cada um — mais um bloco de alertas de lotação.

O bot **compila**; ele não interpreta. Não existe tipagem de perfil de
hospital nem julgamento de adequação clínica no código: o comando lista
quantos e quais, sempre com o nome de quem regulou, e a leitura é humana.

## Uso

```
/destinos            → hoje (padrão)
/destinos ontem
/destinos 7d
```

Também pelos botões de `/menu`. Argumento desconhecido devolve a ajuda.

## Quem pode ver

**Só o privado do admin** (`TELEGRAM_ADMIN_CHAT_ID`), pelo mesmo teste
`from.id !== admin()` que já protege `/resetpin` e `/bloqueados`
(`api/src/bot/chefiaBot.ts`). Qualquer outro chat é **ignorado em silêncio** —
responder "sem permissão" já denunciaria a existência do relatório e
convidaria insistência.

Isso é obrigatório, não preferência: a mensagem contém quadro clínico de
paciente e nome de profissional identificado.

### O que nunca entra na mensagem

Garantido na **seleção de colunas** de `api/src/services/metrics.ts`, não na
formatação — o que não entra no processo não vaza:

| Campo | Por que fica de fora |
|---|---|
| `oc` | nº da ocorrência + data + hospital reidentifica o paciente |
| `medico` | é o médico que **recebeu** no hospital de destino: terceiro, de outra instituição |

Há um teste que lê o fonte de `metrics.ts` e falha se `cases.oc` ou
`cases.medico` reaparecerem (`src/lib/destinosBot.test.ts`).

## Definições

**Dia operacional: 07:00 → 07:00.** `hoje` é o plantão corrente, não o dia do
calendário — às 03:00 da manhã, `hoje` ainda é o plantão que começou às 07:00
de ontem. É a mesma virada do `resetTs()` do motor de score.

**Turnos:** `SD` = 07:00–18:59 · `SN` = 19:00–06:59.

**Fuso:** `America/Sao_Paulo` em todos os cortes e rótulos. O container roda em
UTC, então a conversão é sempre explícita (`api/src/lib/periodo.ts`).

**"Regulado"** = todo envio ao destino, `ACEITO` **e** `ZERO`. Nas duas
leituras possíveis de `ZERO` o paciente foi encaminhado para aquele hospital;
as vagas zero aparecem marcadas com 🚫 e contadas à parte.

**Autor da regulação** = `mr` (Médico Regulador), com fallback para
`criado_por` quando `mr` está vazio. **Nunca `medico`** — usar `medico`
imputaria a regulação ao médico do hospital que recebeu, ou seja, acusaria a
pessoa errada. Há teste travando essa semântica.

## Filtros de linha

| Tabela | Regra | Motivo |
|---|---|---|
| `cases` | `ativo = true` | `ativo = false` é correção/exclusão feita por uma pessoa; contar as duas linhas duplicaria o caso |
| `intel` | `ativo = true` **ou** `removido_por = 'sistema'` | `'sistema'` é a expiração automática por TTL (`intel-policy.ts`): a intel era válida quando foi lançada e conta num relatório histórico. Só a remoção feita por uma **pessoa** é retratação |

⚠️ Sem a segunda regra o bloco de alertas viria **sempre vazio** para qualquer
período passado: `lotado` expira em 12h, então nenhum registro de ontem
continua com `ativo = true`.

## Alertas de lotação — e a lacuna

O sistema **não tem** número de leitos, capacidade nem motivo da vaga zero.
Não existe coluna para isso em `cases`. O bloco de alertas usa os únicos
indicadores que existem:

1. **Vaga zero por hospital** — alerta quando metade ou mais dos envios foram
   vaga zero, com piso de 2 envios **e** 2 vagas zero (o piso duplo evita o
   falso alarme do "1 de 1" e do "1 de 2"), ou quando há 3+ vagas zero em
   números absolutos;
2. **Intel de lotação** — `lotado`, `sem_recurso`, `sem_especialista`, com a
   nota, o autor e o horário.

A própria mensagem declara a lacuna em vez de fingir que o dado existe. Fechar
isso de verdade exige uma coluna `motivo_zero` em `cases` — migration, campo
no `NewCaseModal` e nada de retroativo para o histórico já registrado.

## Perfil do paciente

Os campos pedidos (idade, sexo, queixa, gravidade) **não existem no banco**. O
único campo de perfil é `cases.caso`, texto livre digitado no painel
("Caso", ex.: *TCE com sinais de HIC*), preenchido em ~99,6% das linhas. O
comando mostra esse texto como está, truncado em 120 caracteres, sem
categorizar nem inferir gravidade.

## Limites de mensagem

Telegram corta em 4096 caracteres; o comando fatia em **≤3500**, numerando as
partes. O corte respeita blocos — um hospital com seus envios, ou um hospital
com seus alertas, não é partido ao meio entre duas mensagens. Itálico e
negrito via `parse_mode: HTML`, com **todo** valor vindo do banco passando por
`escapeHtml` (nome de regulador e quadro clínico são entrada livre: um `<`
solto quebraria a mensagem inteira).

Teto de listagem: 40 envios por hospital/turno. O excedente vira uma linha
explícita `+N envios não listados` — nunca silenciosamente cortado.

## Arquivos

| Arquivo | Papel |
|---|---|
| `api/src/lib/periodo.ts` | período, dia operacional 07→07, turno SD/SN, fuso |
| `api/src/services/metrics.ts` | leitura do banco (só I/O) e a regra de privacidade na seleção de colunas |
| `api/src/lib/destinosBot.ts` | agregação, alertas, texto e fatiamento — **puro**, testável sem banco |
| `api/src/bot/chefiaBot.ts` | roteamento do comando e a checagem de autorização |

Testes: `cd api && npm test` (runner nativo do Node via `tsx`, sem banco e sem
rede).

## Ressalva conhecida

O `timestamp` é **declarado**, não medido: vem de um `datetime-local` que o
operador pode ajustar, e não existe `created_at` imutável. Para contagem por
turno o efeito é pequeno, mas um caso lançado com atraso pode cair no turno
errado.
