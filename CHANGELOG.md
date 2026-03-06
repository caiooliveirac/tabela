# Changelog — Painel de Vagas SAMU Salvador

## Sessão 06/03/2026 — Refinamentos visuais e UX

### Summary Drawer (Tabela Resumo)
- **Criação** (`d72c218`): drawer lateral retrátil de 320px com tabela resumo por hospital (aceitos, zero, total), rodapé com totais gerais.
- **Cores por hospital** (`b92ba75`, `ed5dbfe`): background na célula do nome de cada hospital conforme planilha original:
  - Municipal → azul intermediária (#3b6fb5)
  - HGE → amarelo claro (#fef9c3)
  - HGRS → salmão claro (#fbc4b5)
  - Subúrbio → cinza (#d1d5db)
  - HGESF → laranja (#fdba74)
  - Metropolitano → rosa sério (#d4608a)
  - Menandro → verde azulado escuro (#2a7a6d)
  - Eládio → roxo legível (#8b6aae)
  - Juliano Moreira → verde clarinho (#d1fae5)
  - Couto Maia → amarelo amarronzado (#c9a84c)
  - Mário Leal → azul claro (#dbeafe)
- **Drawer inline** (`1f24069`): deixou de ser `position: fixed` (overlay) e passou a ser inline no layout flex. Nunca sobrepõe conteúdo.
- **Responsivo** (`1f24069`): em mobile (<768px) o drawer aparece abaixo do conteúdo (flex-col) com `maxHeight: 50vh`; em desktop fica ao lado (flex-row) com `width: 320px`.

### Score oculto
- **Score removido dos cards** (`ed5dbfe`): badge numérico removido do `HospitalCard`. O ranking continua funcionando internamente (ordenação + cores), mas o número não é exibido.
- **Score removido do detail panel** (`ed5dbfe`): removido "Score X/100" da linha de info no painel de detalhes.

### Layout e Grid
- **Container centralizado** (`e2c9cd7`): `max-w-[1400px] mx-auto` restaurado no container principal para manter conteúdo compacto em monitores largos.
- **Grid 4 colunas fixas** (`01cf51a`): `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — 8 hospitais gerais ficam em 2 linhas de 4. Cards esticam para ocupar a mesma largura dos demais componentes (legenda, detail panel, seções).
- **Root flex** (`1f24069`): container raiz usa `h-screen flex flex-col overflow-hidden` para layout de tela cheia.

### Detail Panel — reposicionamento e animação
- **Posição contextual** (`ee9cf79`): painel de detalhes aparece logo abaixo dos cards da categoria correspondente:
  - Hospitais gerais → abaixo do grid de 8 cards, antes de Psiq/Infecto
  - Psiquiatria → abaixo dos cards de psiq
  - Infectologia → abaixo dos cards de infecto
- **Animação IN** (`258b935`): `clip-path` reveal de cima para baixo (0.4s, cubic-bezier overshoot) com fade + scale.
- **Animação OUT** (`258b935`): collapse para cima com fade-out (0.3s) antes de desmontar o componente. `pointer-events: none` durante a saída.
- **Componente reutilizável** (`ee9cf79`): conteúdo do detail panel extraído para `DetailContent` interno, reusado em geral/psiq/infecto.

### Arquitetura de componentes
- `SummaryDrawer.tsx`: hook `useIsMobile()` com `matchMedia` para comportamento responsivo.
- `Dashboard.tsx`: estados `visibleH` + `detailPhase` para controlar animação de entrada/saída do detail panel.
- `globals.css`: keyframes `detailIn` e `detailOut` com `clip-path` para efeito de revelação.

---

### Commits desta sessão (do mais antigo ao mais recente)
```
d72c218 feat: tabela resumo colapsável (drawer lateral)
ed5dbfe feat: cores planilha no drawer + drawer não-bloqueante + ocultar score
b92ba75 fix: cores hospital no drawer — background na célula nome conforme planilha
1f24069 fix: drawer retrátil inline — sem sobreposição, responsivo mobile
4421bb7 fix: remover max-width e reduzir minmax grid — 4 colunas com drawer aberto
c294ae3 fix: grid máx 4 colunas — 8 hospitais em 2 linhas de 4
ee9cf79 feat: grid centralizado max 4 cols + detail panel abaixo dos cards com animação slideDown
e2c9cd7 fix: restaurar max-w-1400 centralizado no container principal
258b935 feat: animação detail panel — reveal com clip-path + exit com fade-collapse
bed3f46 fix: grid máx 4 colunas — maxWidth 1116px
01cf51a fix: grid 4 colunas mesma largura que demais componentes
```
