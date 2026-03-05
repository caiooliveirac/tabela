// ═══════════════════════════════════════════════════════════════
// Tutorial Data — dados 100% client-side, nunca tocam no banco
// Gerados com timestamps relativos para parecerem "ao vivo"
// ═══════════════════════════════════════════════════════════════

import type {
  HospitalData,
  CaseRow,
  IntelRow,
  HospitalsResponse,
  Semaphore,
} from "./types";

/* ── helpers ─────────────────────────────────────────────────── */

const ago = (min: number) =>
  new Date(Date.now() - min * 60000).toISOString();

function resetTs(): number {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function buildHospital(
  id: string,
  name: string,
  cat: "geral" | "psiq" | "infecto",
  score: number,
  cases: CaseRow[],
  intel: IntelRow[],
): HospitalData {
  const active = cases.filter((c) => c.ativo);
  const zeros = active.filter((c) => c.situacao === "ZERO").length;
  const aceitos = active.length - zeros;
  const sorted = [...active].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const sem: Semaphore =
    score < 30 ? "red" : score < 55 ? "yellow" : "green";

  return {
    id,
    name,
    cat,
    score,
    sem,
    total: active.length,
    zeros,
    aceitos,
    taxa: active.length > 0 ? aceitos / active.length : null,
    lc: sorted[0] || null,
    lz: sorted.find((c) => c.situacao === "ZERO") || null,
    la: sorted.find((c) => c.situacao === "ACEITO") || null,
    intel: intel.filter((i) => i.ativo),
    cases: active,
  };
}

/* ── generator (chamado a cada início de tutorial) ────────── */

export interface TutorialDataResult {
  hospitalsResponse: HospitalsResponse;
  allIntel: IntelRow[];
}

export function generateTutorialData(): TutorialDataResult {
  // ─── HGE ── lotado, maioria vaga zero ────────────────────
  const hgeCases: CaseRow[] = [
    {
      id: 90001,
      hospitalId: "hge",
      timestamp: ago(12),
      situacao: "ZERO",
      caso: "TCE grave, Glasgow 6",
      mr: "Karen",
      medico: "Dr. Silva",
      oc: "1234",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Karen",
    },
    {
      id: 90002,
      hospitalId: "hge",
      timestamp: ago(45),
      situacao: "ZERO",
      caso: "Politrauma motociclístico",
      mr: "Mariana",
      medico: "Dr. Santos",
      oc: "1201",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Mariana",
    },
    {
      id: 90003,
      hospitalId: "hge",
      timestamp: ago(105),
      situacao: "ACEITO",
      caso: "AVE isquêmico, janela 3h",
      mr: "Rafaela",
      medico: "Dra. Lima",
      oc: "1189",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Rafaela",
    },
  ];
  const hgeIntel: IntelRow[] = [
    {
      id: 90101,
      hospitalId: "hge",
      tipo: "lotado",
      nota: "Sala vermelha cheia, corredor com 4 macas",
      autor: "Karen",
      timestamp: ago(25),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── HGESF ── sem especialista ───────────────────────────
  const hgesfCases: CaseRow[] = [
    {
      id: 90004,
      hospitalId: "hgesf",
      timestamp: ago(22),
      situacao: "ZERO",
      caso: "Trombose arterial MID",
      mr: "Luiz Eduardo",
      medico: "Dr. Mendes",
      oc: "1215",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Luiz Eduardo",
    },
    {
      id: 90005,
      hospitalId: "hgesf",
      timestamp: ago(88),
      situacao: "ACEITO",
      caso: "Abdome agudo perfurativo",
      mr: "Kemylla",
      medico: "Dr. Rocha",
      oc: "1178",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Kemylla",
    },
  ];
  const hgesfIntel: IntelRow[] = [
    {
      id: 90102,
      hospitalId: "hgesf",
      tipo: "sem_especialista",
      nota: "Cirurgião vascular não disponível",
      autor: "Luiz Eduardo",
      timestamp: ago(35),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── HGRS ── limpo, aceitando tudo ──────────────────────
  const hgrsCases: CaseRow[] = [
    {
      id: 90006,
      hospitalId: "hgrs",
      timestamp: ago(18),
      situacao: "ACEITO",
      caso: "IAM com supra ST",
      mr: "Karen",
      medico: "Dr. Almeida",
      oc: "1222",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Karen",
    },
    {
      id: 90007,
      hospitalId: "hgrs",
      timestamp: ago(52),
      situacao: "ACEITO",
      caso: "Fratura exposta fêmur",
      mr: "Mariana",
      medico: "Dr. Costa",
      oc: "1198",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Mariana",
    },
  ];

  // ─── Metropolitano ── sem recurso (tomografia) ──────────
  const metroCases: CaseRow[] = [
    {
      id: 90008,
      hospitalId: "metropolitano",
      timestamp: ago(30),
      situacao: "ZERO",
      caso: "TCE moderado, necessita TC",
      mr: "Rafaela",
      medico: "Dr. Araújo",
      oc: "1210",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Rafaela",
    },
  ];
  const metroIntel: IntelRow[] = [
    {
      id: 90103,
      hospitalId: "metropolitano",
      tipo: "sem_recurso",
      nota: "Tomógrafo em manutenção desde 6h",
      autor: "Mariana",
      timestamp: ago(115),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── Subúrbio ── envio planejado ────────────────────────
  const suburbioCases: CaseRow[] = [
    {
      id: 90009,
      hospitalId: "suburbio",
      timestamp: ago(38),
      situacao: "ACEITO",
      caso: "Crise hipertensiva",
      mr: "Kemylla",
      medico: "Dra. Reis",
      oc: "1205",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Kemylla",
    },
    {
      id: 90010,
      hospitalId: "suburbio",
      timestamp: ago(78),
      situacao: "ZERO",
      caso: "Cetoacidose diabética",
      mr: "Karen",
      medico: "Dr. Nunes",
      oc: "1185",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Karen",
    },
  ];
  const suburbioIntel: IntelRow[] = [
    {
      id: 90104,
      hospitalId: "suburbio",
      tipo: "pretendo_enviar",
      nota: "USA 192 a caminho com politrauma",
      autor: "Luiz Eduardo",
      timestamp: ago(4),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── Menandro ── aceitando bem ──────────────────────────
  const menandroCases: CaseRow[] = [
    {
      id: 90011,
      hospitalId: "menandro",
      timestamp: ago(8),
      situacao: "ACEITO",
      caso: "Pneumotórax espontâneo",
      mr: "Mariana",
      medico: "Dr. Barros",
      oc: "1230",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Mariana",
    },
    {
      id: 90012,
      hospitalId: "menandro",
      timestamp: ago(48),
      situacao: "ACEITO",
      caso: "Apendicite aguda",
      mr: "Rafaela",
      medico: "Dra. Souza",
      oc: "1195",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Rafaela",
    },
    {
      id: 90013,
      hospitalId: "menandro",
      timestamp: ago(95),
      situacao: "ACEITO",
      caso: "Obstrução intestinal",
      mr: "Karen",
      medico: "Dr. Ferreira",
      oc: "1175",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Karen",
    },
  ];
  const menandroIntel: IntelRow[] = [
    {
      id: 90105,
      hospitalId: "menandro",
      tipo: "aceitando_bem",
      nota: null,
      autor: "Rafaela",
      timestamp: ago(12),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── Eládio ── sem intel, um zero ───────────────────────
  const eladioCases: CaseRow[] = [
    {
      id: 90014,
      hospitalId: "eladio",
      timestamp: ago(55),
      situacao: "ZERO",
      caso: "Queimadura 30% SCQ",
      mr: "Kemylla",
      medico: "Dr. Pinto",
      oc: "1192",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Kemylla",
    },
  ];

  // ─── Municipal ── normalizado ───────────────────────────
  const municipalCases: CaseRow[] = [
    {
      id: 90015,
      hospitalId: "municipal",
      timestamp: ago(28),
      situacao: "ACEITO",
      caso: "Hemorragia digestiva alta",
      mr: "Luiz Eduardo",
      medico: "Dra. Castro",
      oc: "1218",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Luiz Eduardo",
    },
    {
      id: 90016,
      hospitalId: "municipal",
      timestamp: ago(68),
      situacao: "ZERO",
      caso: "Luxação posterior quadril",
      mr: "Karen",
      medico: "Dr. Vieira",
      oc: "1188",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Karen",
    },
  ];
  const municipalIntel: IntelRow[] = [
    {
      id: 90106,
      hospitalId: "municipal",
      tipo: "normalizado",
      nota: "Ortopedista chegou",
      autor: "Karen",
      timestamp: ago(8),
      ativo: true,
      removidoPor: null,
      removidoEm: null,
    },
  ];

  // ─── Juliano Moreira (psiq) ─────────────────────────────
  const julianoCases: CaseRow[] = [
    {
      id: 90017,
      hospitalId: "juliano_moreira",
      timestamp: ago(40),
      situacao: "ACEITO",
      caso: "Surto psicótico, risco auto/hetero",
      mr: "Mariana",
      medico: "Dra. Melo",
      oc: "1208",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Mariana",
    },
  ];

  // ─── Mário Leal (psiq) ── sem dados ────────────────────

  // ─── Couto Maia (infecto) ── um zero ───────────────────
  const coutoMaiaCases: CaseRow[] = [
    {
      id: 90018,
      hospitalId: "couto_maia",
      timestamp: ago(50),
      situacao: "ZERO",
      caso: "Meningite bacteriana",
      mr: "Rafaela",
      medico: "Dr. Oliveira",
      oc: "1196",
      ativo: true,
      removidoPor: null,
      removidoEm: null,
      criadoPor: "Rafaela",
    },
  ];

  // ─── Removed items (para exibir histórico) ─────────────
  const hgeRemovedIntel: IntelRow = {
    id: 90150,
    hospitalId: "hge",
    tipo: "sem_recurso",
    nota: "Raio-X em manutenção",
    autor: "Mariana",
    timestamp: ago(180),
    ativo: false,
    removidoPor: "Karen",
    removidoEm: ago(60),
  };

  const hgeRemovedCase: CaseRow = {
    id: 90050,
    hospitalId: "hge",
    timestamp: ago(150),
    situacao: "ZERO",
    caso: "Paciente recusou transferência",
    mr: "Karen",
    medico: "Dr. Santos",
    oc: "1150",
    ativo: false,
    removidoPor: "Mariana",
    removidoEm: ago(140),
    criadoPor: "Karen",
  };

  // ─── Scores definidos manualmente para o ranking ───────
  // <30 red | 30-54 yellow | ≥55 green
  const hospitals: HospitalData[] = [
    buildHospital("menandro", "Menandro", "geral", 82, menandroCases, menandroIntel),
    buildHospital("hgrs", "HGRS", "geral", 72, hgrsCases, []),
    buildHospital("municipal", "Municipal", "geral", 62, municipalCases, municipalIntel),
    buildHospital("suburbio", "Subúrbio", "geral", 48, suburbioCases, suburbioIntel),
    buildHospital("hgesf", "HGESF", "geral", 42, hgesfCases, hgesfIntel),
    buildHospital("eladio", "Eládio", "geral", 38, eladioCases, []),
    buildHospital("hge", "HGE", "geral", 25, hgeCases, hgeIntel),
    buildHospital("metropolitano", "Metropolitano", "geral", 22, metroCases, metroIntel),
    buildHospital("juliano_moreira", "Juliano Moreira", "psiq", 65, julianoCases, []),
    buildHospital("mario_leal", "Mário Leal", "psiq", 50, [], []),
    buildHospital("couto_maia", "Couto Maia", "infecto", 28, coutoMaiaCases, []),
  ];

  // Todos os cases para a timeline
  const allCases: CaseRow[] = [
    ...hgeCases,
    hgeRemovedCase,
    ...hgesfCases,
    ...hgrsCases,
    ...metroCases,
    ...suburbioCases,
    ...menandroCases,
    ...eladioCases,
    ...municipalCases,
    ...julianoCases,
    ...coutoMaiaCases,
  ];

  // Todos os intel (ativo + removido)
  const allIntelRecords: IntelRow[] = [
    ...hgeIntel,
    hgeRemovedIntel,
    ...hgesfIntel,
    ...metroIntel,
    ...suburbioIntel,
    ...menandroIntel,
    ...municipalIntel,
  ];

  return {
    hospitalsResponse: {
      hospitals,
      timelineCases: allCases,
      resetTimestamp: resetTs(),
    },
    allIntel: allIntelRecords,
  };
}
