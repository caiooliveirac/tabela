// ═══════════════════════════════════════════════════════════════
// Score Engine — portado do frontend React
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

function mAgo(ts: Date): number {
  return Math.floor((Date.now() - ts.getTime()) / 60000);
}

function hAgo(ts: Date): number {
  return (Date.now() - ts.getTime()) / 3600000;
}

/** Calcula timestamp do reset das 7h */
export function resetTs(): number {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  if (Date.now() < d.getTime()) d.setDate(d.getDate() - 1);
  return d.getTime();
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
  const timelineCases = activeCases.filter((c) => hAgo(c.timestamp) < 24);
  const activeIntel = allIntel.filter((i) => i.ativo);

  const groups: Record<string, HospitalGroup> = {};
  HOSPITALS.forEach((h) => {
    groups[h.id] = { cases: [], intel: [], lc: null, lz: null, la: null };
  });

  semaphoreCases.forEach((c) => {
    if (!groups[c.hospitalId]) return;
    const g = groups[c.hospitalId];
    g.cases.push(c);
    if (!g.lc || c.timestamp > g.lc.timestamp) g.lc = c;
    if (
      c.situacao === "ZERO" &&
      (!g.lz || c.timestamp > g.lz.timestamp)
    )
      g.lz = c;
    if (
      c.situacao === "ACEITO" &&
      (!g.la || c.timestamp > g.la.timestamp)
    )
      g.la = c;
  });

  activeIntel.forEach((i) => {
    if (groups[i.hospitalId]) groups[i.hospitalId].intel.push(i);
  });

  const hospitalData: HospitalData[] = HOSPITALS.map((h) => {
    const d = groups[h.id];
    const tot = d.cases.length;
    const z = d.cases.filter((c) => c.situacao === "ZERO").length;
    const a = tot - z;
    const tx = tot > 0 ? a / tot : null;

    let s = 50;

    // Último caso
    if (d.lc) s += d.lc.situacao === "ACEITO" ? 20 : -25;

    // Vaga zero recente
    if (d.lz) {
      const m = mAgo(d.lz.timestamp);
      if (m < 30) s -= 20;
      else if (m < 60) s -= 10;
      else if (m < 120) s -= 5;
    }

    // Aceite recente
    if (d.la) {
      const m = mAgo(d.la.timestamp);
      if (m < 30) s += 15;
      else if (m < 60) s += 8;
    }

    // Taxa de aceite
    if (tx !== null) {
      if (tx >= 0.8) s += 10;
      else if (tx < 0.4) s -= 10;
    }

    // Intel modifiers
    d.intel.forEach((i) => {
      if (i.tipo === "lotado") s -= 20;
      if (i.tipo === "sem_especialista") s -= 10;
      if (i.tipo === "sem_recurso") s -= 15;
      if (i.tipo === "aceitando_bem") s += 15;
      if (i.tipo === "normalizado") s += 10;
    });

    // Sem dados = neutro
    if (tot === 0 && d.intel.length === 0) s = 50;

    s = Math.max(0, Math.min(100, s));

    let sem: "green" | "yellow" | "red" = "green";
    if (s < 30) sem = "red";
    else if (s < 55) sem = "yellow";

    // Vaga zero expira em 6h
    const lzShow = d.lz && hAgo(d.lz.timestamp) < 6 ? d.lz : null;

    return {
      ...h,
      score: s,
      sem,
      total: tot,
      zeros: z,
      aceitos: a,
      taxa: tx,
      lc: d.lc,
      lz: lzShow,
      la: d.la,
      intel: d.intel,
      cases: d.cases,
    };
  });

  return { hospitalData, timelineCases };
}
