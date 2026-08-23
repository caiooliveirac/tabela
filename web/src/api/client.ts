// ═══════════════════════════════════════════════════════════════
// API Client + WebSocket
// ═══════════════════════════════════════════════════════════════

import type {
  CaseRow,
  IntelRow,
  ChefiaAlert,
  HospitalsResponse,
  CreateCasePayload,
  UpdateCasePayload,
  CreateIntelPayload,
  CreateChefiaPayload,
  UpdateChefiaPayload,
  ReportRequestPayload,
  ReportPreviewResponse,
  UpaRestriction,
  UpaRestrictionsResponse,
  CreateUpaRestrictionPayload,
  PerfilEncaminhamento,
  EncaminhamentoResponse,
  HospitalPonto,
  WsEvent,
} from "../lib/types";

const API_BASE =
  import.meta.env.VITE_API_URL || `${window.location.origin}/tabela/api`;

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Cases ──
export const api = {
  getCases: () => request<CaseRow[]>("/cases"),

  createCase: (data: CreateCasePayload) =>
    request<CaseRow>("/cases", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateCase: (id: number, data: UpdateCasePayload) =>
    request<CaseRow>(`/cases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeCase: (id: number, removidoPor: string) =>
    request<CaseRow>(`/cases/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ removidoPor }),
    }),

  // ── Intel ──
  getIntel: () => request<IntelRow[]>("/intel"),

  createIntel: (data: CreateIntelPayload) =>
    request<IntelRow>("/intel", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeIntel: (id: number, removidoPor: string) =>
    request<IntelRow>(`/intel/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ removidoPor }),
    }),

  // ── Chefia ──
  getChefia: () => request<ChefiaAlert[]>("/chefia"),

  createChefia: (data: CreateChefiaPayload) =>
    request<ChefiaAlert>("/chefia", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeChefia: (id: number, removidoPor: string, pin: string) =>
    request<ChefiaAlert>(`/chefia/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ removidoPor, pin }),
    }),

  updateChefia: (id: number, data: UpdateChefiaPayload, pin: string) =>
    request<ChefiaAlert>(`/chefia/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...data, pin }),
    }),

  previewReport: (data: ReportRequestPayload) =>
    request<ReportPreviewResponse>("/reports/preview", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Hospitals (scores) ──
  getHospitals: () => request<HospitalsResponse>("/hospitals"),

  // ── Restrições de UPA (escrita exige PIN da chefia) ──
  getUpaRestrictions: () =>
    request<UpaRestrictionsResponse>("/upas/restrictions").then((r) => r.restrictions),

  restrictUpa: (data: CreateUpaRestrictionPayload, pin: string) =>
    request<UpaRestriction>("/upas/restrictions", {
      method: "POST",
      body: JSON.stringify({ ...data, pin }),
    }),

  liberateUpa: (id: number, removidoPor: string, pin: string) =>
    request<UpaRestriction>(`/upas/restrictions/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ removidoPor, pin }),
    }),

  // ── Encaminhamento (só leitura) ──
  getPerfisEncaminhamento: () =>
    request<PerfilEncaminhamento[]>("/encaminhamento/perfis"),

  getEncaminhamento: (local: string, perfil: string) =>
    request<EncaminhamentoResponse>(
      `/encaminhamento?local=${encodeURIComponent(local)}&perfil=${encodeURIComponent(perfil)}`,
    ),

  getEncaminhamentoPorPonto: (lat: number, lng: number, perfil: string) =>
    request<EncaminhamentoResponse>(
      `/encaminhamento?lat=${lat}&lng=${lng}&perfil=${encodeURIComponent(perfil)}`,
    ),

  getHospitaisMapa: () => request<HospitalPonto[]>("/encaminhamento/hospitais"),
};

// ── WebSocket ──
type WsHandler = (event: WsEvent) => void;

let ws: WebSocket | null = null;
let handlers: WsHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/tabela/ws`;
}

export function connectWs(): void {
  if (ws && ws.readyState <= WebSocket.OPEN) return;

  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("🔌 WS connected");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (ev) => {
    try {
      const event: WsEvent = JSON.parse(ev.data);
      handlers.forEach((h) => h(event));
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    console.log("🔌 WS disconnected — reconnecting in 3s");
    ws = null;
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function onWsEvent(handler: WsHandler): () => void {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export function disconnectWs(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}
