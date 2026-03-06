// ═══════════════════════════════════════════════════════════════
// Constants — hospitais, categorias, intel types, MRs
// ═══════════════════════════════════════════════════════════════

export interface Hospital {
  id: string;
  name: string;
  cat: "geral" | "psiq" | "infecto";
}

export const HOSPITALS: Hospital[] = [
  { id: "hge", name: "HGE", cat: "geral" },
  { id: "hgesf", name: "HGESF", cat: "geral" },
  { id: "hgrs", name: "HGRS", cat: "geral" },
  { id: "metropolitano", name: "Metropolitano", cat: "geral" },
  { id: "suburbio", name: "Subúrbio", cat: "geral" },
  { id: "menandro", name: "Menandro", cat: "geral" },
  { id: "eladio", name: "Eládio", cat: "geral" },
  { id: "municipal", name: "Municipal", cat: "geral" },
  { id: "juliano_moreira", name: "Juliano Moreira", cat: "psiq" },
  { id: "mario_leal", name: "Mário Leal", cat: "psiq" },
  { id: "couto_maia", name: "Couto Maia", cat: "infecto" },
];

export const CAT_META: Record<
  string,
  { label: string; icon: string }
> = {
  geral: { label: "Emergência Geral", icon: "🏥" },
  psiq: { label: "Psiquiatria", icon: "🧠" },
  infecto: { label: "Infectologia (HIV/TB)", icon: "🦠" },
};

export const MRS = ["Karen", "Mariana", "Rafaela", "Luiz Eduardo", "Kemylla"];

export interface IntelTypeMeta {
  id: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  bd: string;
}

export const INTEL_TYPES: IntelTypeMeta[] = [
  { id: "lotado", label: "Lotado", icon: "🔴", color: "#dc2626", bg: "#fef2f2", bd: "#fecaca" },
  { id: "sem_especialista", label: "Sem especialista", icon: "🟡", color: "#ca8a04", bg: "#fffbeb", bd: "#fde68a" },
  { id: "sem_recurso", label: "Sem recurso", icon: "🟠", color: "#ea580c", bg: "#fff7ed", bd: "#fed7aa" },
  { id: "pretendo_enviar", label: "Envio planejado", icon: "🚑", color: "#7c3aed", bg: "#f5f3ff", bd: "#ddd6fe" },
  { id: "aceitando_bem", label: "Aceitando bem", icon: "🟢", color: "#16a34a", bg: "#f0fdf4", bd: "#bbf7d0" },
  { id: "normalizado", label: "Normalizou", icon: "🔵", color: "#1a56db", bg: "#eff6ff", bd: "#bfdbfe" },
];

export const getIntelType = (id: string): IntelTypeMeta =>
  INTEL_TYPES.find((t) => t.id === id) || INTEL_TYPES[0];

// Semaphore style map
export const SM = {
  green: { bg: "#f0fdf4", bd: "#16a34a", tx: "#15803d", lb: "Aceitando" },
  yellow: { bg: "#fffbeb", bd: "#d97706", tx: "#b45309", lb: "Atenção" },
  red: { bg: "#fef2f2", bd: "#dc2626", tx: "#b91c1c", lb: "Negando" },
  neutral: { bg: "#f8fafc", bd: "#cbd5e1", tx: "#64748b", lb: "Sem dados" },
} as const;

// ═══════════════════════════════════════════════════════════════
// Tutorial
// ═══════════════════════════════════════════════════════════════

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  target?: string;           // data-tutorial-id do elemento a destacar
  selectHospital?: string;   // hospital a selecionar automaticamente
  tab?: "semaphore" | "timeline";
  pos: "center" | "top" | "bottom" | "right";
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: "welcome", title: "Bem-vindo ao Painel de Vagas!", body: "Este tutorial vai mostrar como usar o painel para tomar decisões rápidas de regulação. Os dados que você vê agora são de demonstração — seus dados reais estão seguros e voltam quando sair do tutorial.", pos: "center" },
  { id: "cards", title: "Cards de Hospital", body: "Cada card mostra o status atual de um hospital. A barra lateral colorida indica: verde = aceitando, amarelo = atenção, vermelho = negando. A barra horizontal mostra a proporção de aceitos vs vagas zero. Observe como o ranking já ordena do melhor ao pior.", target: "section-geral", pos: "top" },
  { id: "card_menandro", title: "Aceitando Bem: Menandro", body: "O Menandro tem alerta positivo (🟢) de que está aceitando bem — veja o chip verde no card. Com 3 aceitos consecutivos, ele subiu para o topo do ranking automaticamente. Score 82/100.", target: "hospital-menandro", pos: "right" },
  { id: "card_hge", title: "Exemplo: HGE (Lotado)", body: "O HGE está com alerta de lotação (🔴). Veja o chip vermelho 'Lotado: Sala vermelha cheia…' com quem informou e quando. Isso impactou o ranking — ele caiu para a penúltima posição. Score 25/100.", target: "hospital-hge", pos: "right" },
  { id: "card_metro", title: "Sem Recurso: Metropolitano", body: "O Metropolitano está sem tomografia (🟠). Veja o chip laranja com a nota. Esse alerta fica visível para toda a equipe até alguém removê-lo quando o recurso normalizar.", target: "hospital-metropolitano", pos: "right" },
  { id: "card_hgesf", title: "Sem Especialista: HGESF", body: "A HGESF está sem cirurgião vascular (🟡). Diferente de 'sem recurso', esse tipo sinaliza falta de profissional específico. Veja como o chip amarelo diferencia visualmente.", target: "hospital-hgesf", pos: "right" },
  { id: "card_suburbio", title: "Envio Planejado: Subúrbio", body: "O Subúrbio tem um envio planejado (🚑) — 'USA 192 a caminho com politrauma'. Veja o banner roxo 'ENVIO PLANEJADO' no canto do card. Quando o paciente chegar, basta remover o alerta.", target: "hospital-suburbio", pos: "right" },
  { id: "new_case", title: "Registrar Caso", body: "Clique em '+ Caso' para registrar uma regulação. Só hospital e resultado (Aceito / Vaga Zero) são obrigatórios. O caso aparece imediatamente no card e na aba Casos.", target: "btn-new-case", pos: "bottom" },
  { id: "intel_btn", title: "Alertas", body: "Clique em '⚠ Alertas' para registrar informações como lotação, falta de recurso, recurso normalizado ou envio planejado. Cada registro mostra quem informou e quando.", target: "btn-intel", pos: "bottom" },
  { id: "remove_intel", title: "Remover Alerta", body: "Abaixo você vê o painel de detalhes do HGE. O alerta 'Lotado' aparece com o botão '✕ Remover'. Ao clicar, fica registrado quem removeu e quando — ex: quando a sala vermelha liberar leitos.", target: "detail-intel", selectHospital: "hge", pos: "right" },
  { id: "remove_case", title: "Remover Caso", body: "Na tabela de casos do HGE, cada linha tem um botão '✕'. Ao clicar, o sistema pede confirmação mostrando os detalhes do caso. Útil quando a decisão muda depois de lançada.", target: "detail-cases", selectHospital: "hge", pos: "top" },
  { id: "tab_casos", title: "Aba Casos", body: "Esta é a aba 'Casos' — a timeline completa das últimas 24h com todas as regulações. Os cards do semáforo zeram às 7h da manhã, mas os casos ficam visíveis aqui por 24h.", target: "tab-switcher", tab: "timeline", pos: "bottom" },
  { id: "specialty", title: "Categorias Especiais", body: "Psiquiatria (Juliano Moreira, Mário Leal) e Infectologia (Couto Maia) ficam separados para não poluir o ranking principal. Veja como mantêm semáforo e intel independentes.", target: "section-specialty", pos: "top" },
  { id: "done", title: "Pronto!", body: "Você já sabe usar o painel. Lembre-se: preencha seu nome no cabeçalho antes de registrar qualquer coisa. Ao sair, os dados reais voltam automaticamente. Bom plantão! 🚑", pos: "center" },
];
