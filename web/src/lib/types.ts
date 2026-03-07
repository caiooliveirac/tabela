// ═══════════════════════════════════════════════════════════════
// Shared Types
// ═══════════════════════════════════════════════════════════════

export interface CaseRow {
  id: number;
  hospitalId: string;
  timestamp: string; // ISO string from API
  situacao: "ACEITO" | "ZERO";
  caso: string | null;
  mr: string | null;
  medico: string | null;
  oc: string | null;
  ativo: boolean;
  removidoPor: string | null;
  removidoEm: string | null;
  criadoPor: string;
}

export interface IntelRow {
  id: number;
  hospitalId: string;
  tipo: IntelType;
  nota: string | null;
  autor: string;
  timestamp: string; // ISO string from API
  ativo: boolean;
  removidoPor: string | null;
  removidoEm: string | null;
}

export type IntelType =
  | "lotado"
  | "sem_especialista"
  | "sem_recurso"
  | "pretendo_enviar"
  | "aceitando_bem"
  | "normalizado";

export type Semaphore = "green" | "yellow" | "red";

export interface HospitalData {
  id: string;
  name: string;
  cat: "geral" | "psiq" | "infecto";
  score: number;
  sem: Semaphore;
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

export interface HospitalsResponse {
  hospitals: HospitalData[];
  timelineCases: CaseRow[];
  resetTimestamp: number;
}

export interface CreateCasePayload {
  hospitalId: string;
  situacao: "ACEITO" | "ZERO";
  caso?: string;
  mr?: string;
  medico?: string;
  oc?: string;
  criadoPor: string;
}

export interface UpdateCasePayload {
  hospitalId: string;
  situacao: "ACEITO" | "ZERO";
  caso?: string;
  mr?: string;
  medico?: string;
  oc?: string;
  atualizadoPor: string;
}

export interface CreateIntelPayload {
  hospitalId: string;
  tipo: IntelType;
  nota?: string;
  autor: string;
}

export interface ChefiaAlert {
  id: number;
  mensagem: string;
  autor: string;
  timestamp: string;
  ativo: boolean;
  removidoPor: string | null;
  removidoEm: string | null;
}

export interface CreateChefiaPayload {
  mensagem: string;
  autor: string;
}

export interface UpdateChefiaPayload {
  mensagem: string;
  autor: string;
}

export interface ReportRequestPayload {
  startAt: string;
  endAt: string;
  turno: "diurno" | "noturno";
  responsavel: string;
  observacoes?: string;
  incluirCasosDetalhados?: boolean;
  incluirAlertasQualitativos?: boolean;
  incluirAlertasChefia?: boolean;
  incluirLinhaDoTempo?: boolean;
}

export interface ReportHospitalSummary {
  hospitalId: string;
  hospitalNome: string;
  categoria: "geral" | "psiq" | "infecto";
  total: number;
  aceitos: number;
  zeros: number;
  taxaAceite: number | null;
  ultimoEvento: string | null;
  ultimoAceite: string | null;
  ultimoZero: string | null;
  intelCount: number;
  intelResumo: string[];
}

export interface ReportTimelineItem {
  kind: "case" | "intel" | "chefia";
  timestamp: string;
  title: string;
  subtitle: string;
  severity: "info" | "success" | "warning" | "danger";
}

export interface ReportFlowBucket {
  hour: number;
  label: string;
  total: number;
  aceitos: number;
  zeros: number;
}

export interface GeneratedReportData {
  meta: {
    startAt: string;
    endAt: string;
    turno: "diurno" | "noturno";
    responsavel: string;
    observacoes: string;
    generatedAt: string;
  };
  summary: {
    totalRegulacoes: number;
    totalAceitos: number;
    totalVagasZero: number;
    taxaAceite: number;
    hospitaisAcionados: number;
    hospitaisComZero: number;
    totalIntel: number;
    totalChefia: number;
    totalRemovidos: number;
    hospitalMaisAcionado: string | null;
    hospitalMaisZero: string | null;
    mediaRegulacoesPorHora: number;
    janelaPico: {
      faixa: string | null;
      total: number;
      aceitos: number;
      zeros: number;
    };
    primeiraRegulacao: string | null;
    ultimaRegulacao: string | null;
  };
  highlights: string[];
  flowByHour: ReportFlowBucket[];
  hospitals: ReportHospitalSummary[];
  timeline: ReportTimelineItem[];
  cases: CaseRow[];
  intel: IntelRow[];
  chefia: ChefiaAlert[];
}

export interface ReportPreviewResponse {
  fileBaseName: string;
  report: GeneratedReportData;
  html: string;
  markdown: string;
}

export type WsEvent =
  | { type: "connected"; clients: number }
  | { type: "case:created"; payload: CaseRow }
  | { type: "case:updated"; payload: CaseRow }
  | { type: "case:removed"; payload: CaseRow }
  | { type: "intel:created"; payload: IntelRow }
  | { type: "intel:removed"; payload: IntelRow }
  | { type: "chefia:created"; payload: ChefiaAlert }
  | { type: "chefia:updated"; payload: ChefiaAlert }
  | { type: "chefia:removed"; payload: ChefiaAlert }
  | { type: "refresh" };
