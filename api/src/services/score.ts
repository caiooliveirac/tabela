// ═══════════════════════════════════════════════════════════════
// Score Engine v3.1 — Decay Exponencial + Intel Decay
//
// Lógica:
//   base = 80 (com dados) ou 50 (sem dados)
//   - ZERO penalty: -basePenalty × 0.5^(min/90) por cada ZERO
//     half-life 90min (demorar ~3h para um ZERO "esfriar")
//     bases decrescentes: [-60, -35, -20, -10]
//   - Accept cooldown: -20 × (1 - min/40) se último aceite < 40min
//   - Load bonus: 0 aceitos → +10, 1 → +5, 2 → +2, 3+ → 0
//   - Intel COM DECAY (half-life 120min):
//     lotado → -30 × decay, aceitando_bem → +15 × decay,
//     normalizado → +10 × decay
//   - Clamp [0, 100]
//   - Semáforo: ≥60 green, ≥35 yellow, <35 red
//   - Sort: sem dados primeiro (ordem fixa gerais) → score DESC → fewer aceitos → older last case
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

export interface CaseRow {
  id: number;
  hospitalId: string;
  timestamp: Date;
  situacao: string;
  caso: string | null;
  mr: string | null;
  medico: string | null;
  oc: string | null;
  ativo: boolean;
  removidoPor: string | null;
  removidoEm: Date | null;
  criadoPor: string;
}

export interface IntelRow {
  id: number;
  hospitalId: string;
  tipo: string;
  nota: string | null;
  autor: string;
  timestamp: Date;
  ativo: boolean;
  removidoPor: string | null;
  removidoEm: Date | null;
}

interface HospitalGroup {
  cases: CaseRow[];
  intel: IntelRow[];
  lc: CaseRow | null; // last case
  lz: CaseRow | null; // last vaga zero
  la: CaseRow | null; // last aceito
  zeros: CaseRow[];   // all zeros sorted desc
}

export interface HospitalData extends Hospital {
  score: number;
  sem: "green" | "yellow" | "red";
  total: number;
  zeros: number;
  aceitos: number;
  taxa: number | null;
  lc: CaseRow | null;
  lz: CaseRow | null;
  la: CaseRow | null;
  intel: IntelRow[];
  cases: CaseRow[];
}

// ── Constantes do motor ──────────────────────────────────────

const HALF_LIFE_ZERO = 90;                    // minutos — half-life do decay de vaga zero
const HALF_LIFE_INTEL = 120;                  // minutos — half-life do decay de intel
const ZERO_BASES = [-60, -35, -20, -10];      // penalidade base por ZERO (1º, 2º, 3º, 4º+)
const COOLDOWN_MAX = -20;                     // penalidade cooldown aceite
const COOLDOWN_WINDOW = 40;                   // minutos
const LOAD_BONUS = [10, 5, 2, 0];            // bonus por 0, 1, 2, 3+ aceitos
const INTEL_SCORE: Record<string, number> = {
  lotado: -30,
  aceitando_bem: 15,
  normalizado: 10,
};
const BASE_WITH_DATA = 80;
const BASE_NO_DATA = 50;

const NO_INFO_GERAL_ORDER = [
  "municipal",
  "hgrs",
  "suburbio",
  "hgesf",
  "hge",
  "eladio",
  "metropolitano",
  "menandro",
] as const;

const NO_INFO_GERAL_ORDER_INDEX: Record<string, number> = Object.fromEntries(
  NO_INFO_GERAL_ORDER.map((id, idx) => [id, idx])
);

// ── Helpers ──────────────────────────────────────────────────

function minutesAgo(ts: Date): number {
  return (Date.now() - ts.getTime()) / 60000;
}

function hoursAgo(ts: Date): number {
  return (Date.now() - ts.getTime()) / 3600000;
}

/** Decay exponencial: valor × 0.5^(min/halfLife) */
function decay(basePenalty: number, minutes: number, halfLife: number): number {
  return basePenalty * Math.pow(0.5, minutes / halfLife);
}

/** Calcula timestamp do reset das 7h */
export function resetTs(): number {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  if (Date.now() < d.getTime()) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// ── Score de um hospital ─────────────────────────────────────

function computeHospitalScore(g: HospitalGroup): number {
  const tot = g.cases.length;
  const aceitos = tot - g.zeros.length;

  // Sem dados → score neutro
  if (tot === 0 && g.intel.length === 0) return BASE_NO_DATA;

  let s = BASE_WITH_DATA;

  // 1) ZERO penalty com decay exponencial (half-life 90min)
  g.zeros.forEach((z, i) => {
    const base = ZERO_BASES[Math.min(i, ZERO_BASES.length - 1)];
    const min = minutesAgo(z.timestamp);
    s += decay(base, min, HALF_LIFE_ZERO);
  });

  // 2) Cooldown do último aceite (penaliza aceites muito recentes)
  if (g.la) {
    const min = minutesAgo(g.la.timestamp);
    if (min < COOLDOWN_WINDOW) {
      s += COOLDOWN_MAX * (1 - min / COOLDOWN_WINDOW);
    }
  }

  // 3) Load distribution bonus
  const bonusIdx = Math.min(aceitos, LOAD_BONUS.length - 1);
  s += LOAD_BONUS[bonusIdx];

  // 4) Intel COM DECAY (half-life 120min) — lotado, aceitando_bem, normalizado
  g.intel.forEach((i) => {
    const mod = INTEL_SCORE[i.tipo];
    if (mod !== undefined) {
      const min = minutesAgo(i.timestamp);
      s += decay(mod, min, HALF_LIFE_INTEL);
    }
  });

  // 5) Clamp [0, 100]
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Calcula scores e dados agregados para todos os hospitais */
export function compute(
  allCases: CaseRow[],
  allIntel: IntelRow[],
  rst: number
): { hospitalData: HospitalData[]; timelineCases: CaseRow[] } {
  const activeCases = allCases.filter((c) => c.ativo);
  const semaphoreCases = activeCases.filter(
    (c) => c.timestamp.getTime() >= rst
  );
  const timelineCases = activeCases.filter((c) => hoursAgo(c.timestamp) < 24);
  const activeIntel = allIntel.filter((i) => i.ativo);

  const groups: Record<string, HospitalGroup> = {};
  HOSPITALS.forEach((h) => {
    groups[h.id] = { cases: [], intel: [], lc: null, lz: null, la: null, zeros: [] };
  });

  semaphoreCases.forEach((c) => {
    if (!groups[c.hospitalId]) return;
    const g = groups[c.hospitalId];
    g.cases.push(c);
    if (!g.lc || c.timestamp > g.lc.timestamp) g.lc = c;
    if (c.situacao === "ZERO") {
      g.zeros.push(c);
      if (!g.lz || c.timestamp > g.lz.timestamp) g.lz = c;
    }
    if (c.situacao === "ACEITO" && (!g.la || c.timestamp > g.la.timestamp)) {
      g.la = c;
    }
  });

  // Ordenar zeros: mais recente primeiro (para indexar ZERO_BASES)
  Object.values(groups).forEach((g) => {
    g.zeros.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  });

  activeIntel.forEach((i) => {
    if (groups[i.hospitalId]) groups[i.hospitalId].intel.push(i);
  });

  const hospitalData: HospitalData[] = HOSPITALS.map((h) => {
    const g = groups[h.id];
    const tot = g.cases.length;
    const z = g.zeros.length;
    const a = tot - z;
    const tx = tot > 0 ? a / tot : null;
    const noInfo = tot === 0 && g.intel.length === 0;

    const s = computeHospitalScore(g);

    let sem: "green" | "yellow" | "red" = "green";
    if (!noInfo) {
      if (s < 35) sem = "red";
      else if (s < 60) sem = "yellow";
    }

    // Vaga zero expira visualmente em 6h
    const lzShow = g.lz && hoursAgo(g.lz.timestamp) < 6 ? g.lz : null;

    return {
      ...h,
      score: s,
      sem,
      total: tot,
      zeros: z,
      aceitos: a,
      taxa: tx,
      lc: g.lc,
      lz: lzShow,
      la: g.la,
      intel: g.intel,
      cases: g.cases,
    };
  });

  // Sort: score DESC → fewer aceitos → older last case
  hospitalData.sort((a, b) => {
    const aNoInfo = a.total === 0 && a.intel.length === 0;
    const bNoInfo = b.total === 0 && b.intel.length === 0;

    if (aNoInfo !== bNoInfo) return aNoInfo ? -1 : 1;

    if (aNoInfo && bNoInfo && a.cat === "geral" && b.cat === "geral") {
      const aIdx = NO_INFO_GERAL_ORDER_INDEX[a.id] ?? Number.MAX_SAFE_INTEGER;
      const bIdx = NO_INFO_GERAL_ORDER_INDEX[b.id] ?? Number.MAX_SAFE_INTEGER;
      if (aIdx !== bIdx) return aIdx - bIdx;
    }

    if (b.score !== a.score) return b.score - a.score;
    if (a.aceitos !== b.aceitos) return a.aceitos - b.aceitos;
    // older lc first (null = never interacted = lowest priority)
    const aT = a.lc ? new Date(a.lc.timestamp).getTime() : Infinity;
    const bT = b.lc ? new Date(b.lc.timestamp).getTime() : Infinity;
    return aT - bT;
  });

  return { hospitalData, timelineCases };
}
