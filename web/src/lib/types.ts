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

export interface CreateIntelPayload {
  hospitalId: string;
  tipo: IntelType;
  nota?: string;
  autor: string;
}

export type WsEvent =
  | { type: "connected"; clients: number }
  | { type: "case:created"; payload: CaseRow }
  | { type: "case:removed"; payload: CaseRow }
  | { type: "intel:created"; payload: IntelRow }
  | { type: "intel:removed"; payload: IntelRow }
  | { type: "refresh" };
