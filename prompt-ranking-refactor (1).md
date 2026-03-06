# Prompt: Score Engine v3 — Decay Temporal + Gradiente Visual

Cole no Claude Code (VS Code) com o projeto `tabela` aberto.

---

```
## Contexto

O arquivo `api/src/services/score.ts` contém a engine de scoring que ordena cards de hospitais no painel de regulação SAMU. A lógica atual está errada e precisa ser completamente reescrita.

Leia o `score.ts` atual para entender a interface (tipos `CaseRow`, `IntelRow`, `HospitalData`, função `compute()`). A interface de entrada/saída NÃO muda. Só a lógica interna de cálculo do score.

## Filosofia do Novo Score

O score representa **"probabilidade percebida de que este hospital aceite o próximo paciente agora"**. Vai de 0 (certeza de recusa) a 100 (alta chance de aceitar).

O princípio central é: **tudo decai com o tempo**. Uma vaga zero de 5 minutos atrás é quase certeza de recusa. A mesma vaga zero 2 horas depois é apenas uma memória. O score deve refletir isso como uma curva contínua, não como degraus.

## Modelo de Cálculo

### 1. Score Base

Todo hospital começa em **80 pontos** (otimismo cauteloso — sem informação, assumimos que provavelmente aceita).

Hospital sem nenhum dado no turno (0 casos, 0 intel): score = **50** (desconhecido, meio da escala).

### 2. Penalidade por VAGA ZERO — Decay Exponencial

Cada ZERO no turno aplica uma penalidade que **decai exponencialmente com o tempo**. ZEROs recentes são devastadores; ZEROs antigos são apenas memória.

```
Para CADA caso com situacao === "ZERO" no turno:
  minutosPassados = (agora - timestamp) / 60000
  
  // Decay exponencial: meia-vida de 45 minutos
  // Após 45min, a penalidade caiu pela metade
  // Após 90min, caiu pra 25%
  // Após 2h+, praticamente zero
  decayFactor = Math.pow(0.5, minutosPassados / 45)
  
  // Penalidade base de um ZERO = -60 pontos (no instante que acontece)
  penalidade = -60 * decayFactor
  
  score += penalidade
```

**Efeito cumulativo com diminishing returns:** Quando há múltiplos ZEROs, cada ZERO subsequente tem penalidade base reduzida:
- 1º ZERO (mais recente): base = -60
- 2º ZERO: base = -35
- 3º ZERO: base = -20
- 4º+ ZERO: base = -10

Ordenar os ZEROs do mais recente ao mais antigo antes de aplicar.

**Exemplo concreto:**
- Hospital com 1 ZERO há 5min: `score = 80 + (-60 * 0.926) = 80 - 55.5 ≈ 24` (vermelho)
- Hospital com 1 ZERO há 45min: `score = 80 + (-60 * 0.5) = 80 - 30 = 50` (amarelado)
- Hospital com 1 ZERO há 90min: `score = 80 + (-60 * 0.25) = 80 - 15 = 65` (verde pálido)
- Hospital com 1 ZERO há 2h: `score = 80 + (-60 * 0.16) = 80 - 9.6 ≈ 70` (verde)
- Hospital com 3 ZEROs (5min, 30min, 1h): `80 + (-60*0.926) + (-35*0.63) + (-20*0.4) = 80 - 55.5 - 22 - 8 ≈ -5 → clamped 0`

### 3. Penalidade por ACEITE RECENTE — Cooldown

Aceite recente é penalidade (não bônus!). O plantonista que acabou de receber paciente precisa de respiro.

```
if (últimoAceite existe) {
  minutosPassados = minutosDesde(últimoAceite)
  
  // Decay linear simples, janela de 40 minutos
  // Penalidade máxima = -20 no instante do aceite, chega a 0 em 40min
  if (minutosPassados < 40) {
    penalidade = -20 * (1 - minutosPassados / 40)
    score += penalidade
  }
}
```

### 4. Bônus por Distribuição de Carga

Entre hospitais disponíveis, quem menos recebeu no turno sobe no ranking.

```
totalAceitos = contagem de casos ACEITO ativos no turno

if (totalAceitos === 0) score += 10  // virgem, prioridade
else if (totalAceitos === 1) score += 5
else if (totalAceitos === 2) score += 2
// 3+: sem bônus (já recebeu sua cota justa)
```

### 5. Intel — Somente `lotado`, `aceitando_bem`, `normalizado` Afetam Score

**REGRA IMPORTANTE:** `sem_recurso`, `sem_especialista` e `pretendo_enviar` NÃO afetam score. São informações contextuais — o regulador analisa caso a caso olhando o card.

```
Para cada intel ATIVA:
  if (tipo === "lotado") {
    // Lotado é estado contínuo — penalidade fixa enquanto ativo
    // Pesa -30: menos que ZERO fresco (-60) mas mais que ZERO de 1h (-30)
    // Isso significa que após ~45min, intel "lotado" passa a pesar
    // mais que um ZERO, o que é correto (ZERO é pontual, lotado é estado)
    score -= 30
  }
  if (tipo === "aceitando_bem") {
    score += 15  // plantonista avisou que está receptivo
  }
  if (tipo === "normalizado") {
    score += 10  // situação que era ruim melhorou
  }
```

### 6. Clamp Final

```
score = Math.max(0, Math.min(100, score))
```

### 7. Semáforo (para compatibilidade — mas o frontend vai usar gradiente)

Manter o campo `sem` no `HospitalData` para compatibilidade:
```
if (score >= 55) sem = "green"
else if (score >= 30) sem = "yellow"
else sem = "red"
```

### 8. Ordenação

Ordenar `hospitalData` por:
1. `score` DESC
2. Desempate: menor `aceitos` no turno
3. Desempate: maior tempo desde última interação (`lc`)

## Atualização Temporal

O score muda com o tempo mesmo sem novos eventos (porque os decays mudam). O frontend deve recalcular a cada 60 segundos (já faz isso com `setInterval`). Se o backend serve via API, o cálculo deve ser feito no momento da request, não cacheado.

## PARTE 2 — Gradiente Visual no Frontend

Localize o componente de HospitalCard no frontend (provavelmente em `web/src/components/HospitalCard.tsx` ou similar).

Atualmente o card usa 3 cores fixas (verde/amarelo/vermelho) baseadas no campo `sem`. Substitua por um **gradiente HSL contínuo** baseado no score numérico.

### Função de cor

```typescript
function scoreToColor(score: number): { 
  border: string; 
  bg: string; 
  text: string; 
  label: string;
  glow: string;
} {
  // score 0-100 mapeia para hue 0 (vermelho) a 130 (verde)
  const hue = Math.round((score / 100) * 130);
  
  // Saturação: mais saturado nos extremos, menos no meio
  // Extremos (perto de 0 ou 100) = cor vívida
  // Meio (perto de 50) = cor mais lavada/incerta
  const distFromCenter = Math.abs(score - 50) / 50; // 0 a 1
  const saturation = 40 + distFromCenter * 45; // 40% a 85%
  
  // Luminosidade da borda: mais escura = mais confiança na info
  const borderL = 35 + (1 - distFromCenter) * 15; // 35% a 50%
  
  // Background: sempre claro, com leve tint da cor
  const bgL = 95 - distFromCenter * 5; // 90% a 95%
  const bgS = 30 + distFromCenter * 40; // 30% a 70%
  
  // Texto do status
  const textL = 25 + (1 - distFromCenter) * 15; // 25% a 40%
  
  // Glow: intensidade proporcional à distância do centro
  // Score muito alto = glow verde suave
  // Score muito baixo = glow vermelho suave
  // Score no meio = sem glow
  const glowAlpha = Math.round(distFromCenter * 25); // 0 a 25 (hex)
  const glowHex = glowAlpha.toString(16).padStart(2, '0');
  
  // Label textual (ainda útil como acessibilidade)
  let label: string;
  if (score >= 70) label = "Provável aceitar";
  else if (score >= 55) label = "Tendência a aceitar";
  else if (score >= 40) label = "Incerto";
  else if (score >= 25) label = "Improvável";
  else label = "Muito improvável";
  
  return {
    border: `hsl(${hue}, ${saturation}%, ${borderL}%)`,
    bg: `hsl(${hue}, ${bgS}%, ${bgL}%)`,
    text: `hsl(${hue}, ${saturation}%, ${textL}%)`,
    label,
    glow: `0 0 12px hsl(${hue}, ${saturation}%, ${borderL}%, 0.${glowHex})`,
  };
}
```

### Aplicação no card

- **Barra lateral esquerda** do card: cor `border` (5px solid)
- **Borda do card**: `border` com alpha reduzida
- **Background quando selecionado**: `bg`
- **Badge de status**: usa `text` como cor do texto e `bg` como fundo
- **Label do badge**: usa o `label` retornado (ex: "Provável aceitar")
- **Box shadow**: usa `glow` para dar halo sutil da cor do score
- **Barra de aceitos/zeros**: mantém verde/vermelho fixo (essa é factual, não probabilística)

### Efeito desejado

Com essa abordagem:
- Hospital com score 95 → verde vívido, glow verde suave
- Hospital com score 70 → verde mais pálido, menos glow  
- Hospital com score 50 → amarelo lavado, sem glow (incerteza)
- Hospital com score 30 → laranja, leve glow quente
- Hospital com score 10 → vermelho vívido, glow vermelho
- Hospital com score que está MUDANDO (ZERO envelhecendo) → a cor vai gradualmente migrando do vermelho pro amarelo pro verde ao longo dos minutos, dando sensação de "respiro" visual

### Legenda atualizada

Substitua a legenda de 3 cores por uma barra de gradiente com os labels:
```
[Muito improvável] ← gradiente vermelho→amarelo→verde → [Provável aceitar]
"Baseado em vagas zero, aceites recentes e alertas. Atualiza a cada minuto."
```

## Implementação

1. Refatore a lógica de score em `score.ts` (backend)
2. Implemente `scoreToColor()` no frontend (pode ser em `lib/colors.ts` ou similar)
3. Atualize o HospitalCard para usar gradiente ao invés de 3 cores fixas
4. Atualize a legenda
5. Se houver lógica de score duplicada no frontend, remova — o score vem do backend
6. Crie testes unitários para o score engine com os cenários da tabela abaixo

### Tabela de validação

| Cenário | Score esperado |
|---------|---------------|
| Sem dados (0 casos, 0 intel) | 50 |
| 0 aceitos, sem interação, sem intel | 90 (80 base + 10 virgem) |
| 1 ZERO há 5min | ≈24 |
| 1 ZERO há 30min | ≈42 |
| 1 ZERO há 45min (meia-vida) | 50 |
| 1 ZERO há 90min | ≈65 |
| 1 ZERO há 2h | ≈70 |
| 3 ZEROs (5min, 30min, 1h) | ≈0 (clamped) |
| 1 aceito há 5min, 0 ZEROs | ≈67 (80 - 17.5 cooldown + 5 carga) |
| 1 aceito há 1h, sem mais nada | ≈85 (80 + 5 carga, cooldown expirou) |
| 5 aceitos, último há 3h | ≈80 (80, sem cooldown, sem bônus carga) |
| Intel "lotado" ativa, 0 ZEROs | ≈50 (80 - 30) |
| Intel "lotado" + ZERO há 1h | ≈35 (80 - 30 lotado - 15 zero) |
| Intel "aceitando_bem", 0 aceitos | ≈100 (clamped: 80 + 15 + 10) |
| ZERO há 40min + intel "lotado" | ≈23 (80 - 27 zero - 30 lotado) |

Commite com: "refactor: score engine v3 — decay exponencial + gradiente visual contínuo"
```
