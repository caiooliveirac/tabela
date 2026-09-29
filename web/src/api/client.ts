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
  EncaminhamentoConfig,
  PainelFrota,
  WsEvent,
} from "../lib/types";

const API_BASE =
  import.meta.env.VITE_API_URL || `${window.location.origin}/tabela/api`;

// ── Sessão do portal (login único, ADR 0013 do kairos) ──
// O nginx do host confere o cookie mnrs_sso antes de /tabela/. Sem sessão, a
// API responde 401 (e a página, 302 para o portal). Recarregar leva ao login;
// se já recarregou há menos de 30 s, é laço: para e mostra o aviso.
const LOGIN_URL = "https://mnrs.com.br/?proximo=tabela";
const RELOAD_KEY = "tabela:sessao-reload";
const RELOAD_JANELA_MS = 30_000;

export function semSessao(res: Response): boolean {
  if (res.status === 401 || res.redirected) return true;
  return (res.headers.get("content-type") ?? "").includes("text/html");
}

function avisoSessao(): void {
  if (document.getElementById("tabela-sessao-aviso")) return;
  const el = document.createElement("div");
  el.id = "tabela-sessao-aviso";
  el.setAttribute("role", "alert");
  el.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;" +
    "background:#b91c1c;color:#fff;font:600 15px system-ui,sans-serif;text-align:center";
  el.textContent = "Sua sessão expirou. ";
  const link = document.createElement("a");
  link.href = LOGIN_URL;
  link.textContent = "Entre de novo.";
  link.style.cssText = "color:#fff;text-decoration:underline";
  el.appendChild(link);
  document.body.appendChild(el);
}

export function sessaoExpirada(): void {
  let ultimo: number;
  try {
    ultimo = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - ultimo >= RELOAD_JANELA_MS) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }
  } catch {
    // sem sessionStorage não há trava contra laço: só avisa
  }
  avisoSessao();
}

// ── Fora do plantão (portão de turno do plantoes, via porteiro) ──
// Sessão válida, mas a conta não está de plantão agora: o nginx responde 403
// (API e WebSocket em JSON; a tela, com a página "Tabela fechada fora do
// plantão"). Nada da Tabela pode ficar aberto: fecha o WebSocket e troca a
// tela inteira por essa página — ela se reconfere sozinha a cada 2 min.
let fechandoFora = false;
export function foraDoPlantao(): void {
  if (fechandoFora) return;
  fechandoFora = true;
  disconnectWs();
  document.body.replaceChildren();
  window.location.replace(window.location.href);
}

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

  if (res.status === 403) {
    foraDoPlantao();
    throw new Error("Fora do plantão");
  }

  if (semSessao(res)) {
    sessaoExpirada();
    throw new Error("Sessão expirada");
  }

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

  getEncaminhamentoConfig: () => request<EncaminhamentoConfig>("/encaminhamento/config"),

  getFrota: () => request<PainelFrota>("/frota"),
};

// ── WebSocket ──
type WsHandler = (event: WsEvent) => void;

let ws: WebSocket | null = null;
let handlers: WsHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsFalhas = 0;

// O handshake do WebSocket não expõe o status HTTP: depois de algumas
// reconexões falhas, um GET leve numa rota protegida diz se é sessão vencida.
// (/health fica aberta no portão e não serve para isto.)
async function sondarSessao(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/hospitals/list`, { cache: "no-store" });
    if (res.status === 403) foraDoPlantao();
    else if (semSessao(res)) sessaoExpirada();
  } catch {
    // rede fora: segue tentando reconectar
  }
}

// Aba esquecida aberta (inclusive escondida, quando o React Query para de
// consultar) continua recebendo o WebSocket: confere a sessão a cada minuto e
// ao voltar para a aba. O servidor também fecha cada WebSocket a cada 5 min
// (api/src/ws/handler.ts) para o portão reconferir na reconexão.
const SONDAR_A_CADA_MS = 60_000;
let vigiando = false;
function vigiarSessao(): void {
  if (vigiando) return;
  vigiando = true;
  setInterval(() => void sondarSessao(), SONDAR_A_CADA_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sondarSessao();
  });
}

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/tabela/ws`;
}

/** Fechamento do servidor para reconferir o portão: reconecta na hora. */
const WS_RECONFERIR = 4000;

export function connectWs(): void {
  if (fechandoFora) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  vigiarSessao();

  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("🔌 WS connected");
    wsFalhas = 0;
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

  ws.onclose = (ev) => {
    ws = null;
    if (ev.code === WS_RECONFERIR) {
      connectWs();
      return;
    }
    console.log("🔌 WS disconnected — reconnecting in 3s");
    wsFalhas += 1;
    // Handshake recusado (403 fora do plantão, 401 sem sessão) não expõe o
    // status: já na primeira falha pergunta à API.
    if (wsFalhas === 1 || wsFalhas % 3 === 0) void sondarSessao();
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
