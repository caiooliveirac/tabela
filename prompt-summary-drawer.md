# Prompt: Tabela Resumo Colapsável (Painel Lateral)

Cole no Claude Code (VS Code) com o projeto `tabela` aberto.

---

```
## Contexto

O painel de regulação SAMU tem cards de hospitais com semáforo e ranking. A equipe sente falta de uma **tabela resumo** que existia na planilha antiga — uma visão consolidada mostrando, para cada hospital, quantos pacientes foram aceitos, quantos foram vaga zero, e o total. Mais um totalizador geral de ocorrências reguladas.

Essa tabela NÃO deve ocupar espaço permanente na tela nem empurrar o layout dos cards. Deve ser **facultativa** — quem quer ver, abre; quem não quer, nem nota que existe.

## O que construir

### 1. Botão no header

Adicione um botão discreto no header (na mesma fileira dos botões existentes como "⚠ Intel" e "+ Caso"), com ícone de tabela ou gráfico:

```
📊 Resumo
```

Estilo: mesmo padrão dos outros botões do header (ghost/outline, não chamativo). Quando o painel está aberto, o botão fica com visual "ativo" (fundo levemente diferente).

### 2. Drawer lateral direito

Ao clicar em "📊 Resumo", abre um **drawer (painel lateral)** que desliza da direita. Características:

- Largura fixa: ~320px
- Overlay sutil no conteúdo principal (escurecimento leve, clicável para fechar)
- Animação suave de slide-in (CSS transition, ~200ms)
- Botão de fechar (✕) no topo do drawer
- NÃO empurra o conteúdo — fica sobreposto
- Fecha ao clicar fora, ao clicar ✕, ou ao clicar no botão "📊 Resumo" novamente
- Posição: fixed, top abaixo do header, right: 0, height até o fim da tela

### 3. Conteúdo do drawer — Tabela Resumo

A tabela replica o formato da planilha antiga:

```
┌─────────────────────────────────────┐
│  📊 Resumo do Plantão               │
│  Desde 07:00                    ✕   │
├─────────────────────────────────────┤
│                                     │
│  HOSPITAL    ACEITOS  ZERO   TOTAL  │
│  ─────────────────────────────────  │
│  HGE            7       0      7   │
│  HGESF          2       1      3   │
│  HGRS           2       0      2   │
│  Menandro       1       1      2   │
│  Municipal      1       0      1   │
│  Subúrbio       0       1      1   │
│  Metropolitano  0       1      1   │
│  Eládio         0       1      1   │
│  ─────────────────────────────────  │
│  Psiquiatria                        │
│  Jul. Moreira   0       0      0   │
│  Mário Leal     0       0      0   │
│  ─────────────────────────────────  │
│  Infectologia                       │
│  Couto Maia     0       0      0   │
│  ─────────────────────────────────  │
│                                     │
│  TOTAL REGULAÇÕES          18       │
│                                     │
└─────────────────────────────────────┘
```

### Regras da tabela

1. **Dados:** Usar os mesmos dados filtrados pelo reset das 7h (`resetTs`), apenas casos ativos (`ativo === true`). A mesma fonte de dados que alimenta os cards.

2. **Ordenação dentro de cada categoria:** Por TOTAL descendente (quem mais recebeu primeiro), depois por nome alfabético como desempate. Isso é a ordenação da tabela resumo, não do ranking dos cards — são independentes.

3. **Categorias separadas:** Emergência Geral primeiro, depois Psiquiatria, depois Infectologia. Cada seção com um mini-header discreto (não precisa de ícone, só o nome em cinza pequeno).

4. **Hospitais com 0 total:** Ainda aparecem na tabela (com 0, 0, 0). A tabela mostra todos, sempre.

5. **Cores nas células:**
   - Coluna ACEITOS: número em verde (#16a34a) quando > 0
   - Coluna ZERO: número em vermelho (#dc2626) e **bold** quando > 0
   - Coluna TOTAL: background com intensidade proporcional ao total (mais regulações = fundo mais escuro, tipo heatmap sutil). Usar opacidade do azul: `rgba(26, 86, 219, totalNormalizado * 0.15)`
   - Linhas com ZERO > 0: leve fundo rosado na linha toda (`#fef2f2`)

6. **Rodapé totalizador:**
   ```
   TOTAL REGULAÇÕES: 18
   Aceitos: 13 (72%)  |  Vagas Zero: 5 (28%)
   ```
   A porcentagem de aceite pode ter cor condicional: verde se >= 60%, amarelo se >= 40%, vermelho se < 40%.

7. **Responsividade:** Em telas menores que 768px, o drawer ocupa a tela toda (width: 100%) ao invés de 320px. Mesma mecânica de abrir/fechar.

### 4. Atualização em tempo real

A tabela deve usar os mesmos dados reativos que os cards. Quando um caso é adicionado ou removido, a tabela atualiza imediatamente (sem precisar fechar e abrir).

## Implementação

1. Crie um componente `SummaryDrawer.tsx` (ou equivalente no padrão do projeto).
2. Adicione o state `showSummary` no componente pai (mesmo nível dos outros modais).
3. Adicione o botão no header.
4. O drawer NÃO é um modal com overlay opaco — é um painel lateral com overlay sutil. O usuário deve conseguir ver os cards "por baixo" (desfocados/escurecidos) enquanto olha a tabela.
5. Use `position: fixed` para o drawer, com `z-index` acima do conteúdo mas abaixo dos modais (z-index entre 50 e 100, modais são 200+).
6. Animação: `transform: translateX(100%)` quando fechado, `translateX(0)` quando aberto, com `transition: transform 0.2s ease`.

## O que NÃO fazer

- NÃO coloque a tabela dentro do layout principal (não é uma section permanente)
- NÃO crie uma nova aba/tab para isso (já tem "Semáforo" e "Casos", não precisa de terceira)
- NÃO duplique lógica de agregação — reutilize os dados que já estão computados (hospitalData do score engine)
- NÃO altere nenhum componente existente além de: adicionar o botão no header e o state no componente pai

Commite com: "feat: tabela resumo colapsável (drawer lateral)"
```
