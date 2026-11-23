// Cores e textos da aba Frota. Cor carrega estado: verde/âmbar é a idade da
// posição (a mesma régua do painel de destino), azul é "parada em hospital",
// vermelho é só o alerta de 40 min. Violeta é "em ocorrência" (mapa de equipes).
import type { DetalheViaturaFrota, FaseRastroFrota, ViaturaFrota } from "../../lib/types";

export const COR = {
  recente: "#16a34a",
  atrasada: "#d97706",
  alerta: "#dc2626",
  hospital: "#1d4ed8",
  vazio: "#64748b",
  /** Parada na própria base, que fica no hospital: informação, não alerta. */
  base: "#94a3b8",
  /** Em ocorrência pelo mapa de equipes. */
  ocorrencia: "#7c3aed",
  /** Livre pelo mapa de equipes. */
  livre: "#0d9488",
} as const;

/** Rastro do detalhe da viatura: violeta a caminho, azul na cerca, vermelho fora com status de hospital. */
export const COR_RASTRO = {
  caminho: COR.ocorrencia,
  dentro: COR.hospital,
  foraAlerta: COR.alerta,
  fora: "#64748b",
} as const;

/**
 * Cor de cada fase da ocorrência no rastro (fases.ts da API): ida ao local,
 * o local, transporte, unidade, retorno. Vermelho fica só para o "saiu da
 * unidade e o status segue chegada ao hospital" (COR_RASTRO.foraAlerta).
 */
export const COR_FASE: Record<FaseRastroFrota, string> = {
  antes: "#cbd5e1",
  resposta: "#ea580c",
  local: "#92400e",
  transporte: COR.ocorrencia,
  unidade: COR.hospital,
  retorno: COR.livre,
  depois: "#94a3b8",
};
/** Verde neon da viatura ainda vinculada à ocorrência (mapa do rastro e a caixa dele). */
export const COR_VINCULADA = "#22c55e";

/**
 * Os marcos da ocorrência pelo GPS plotados no mapa, com a hora: saída da base,
 * chegada e saída da unidade, volta à base (o local tem a etiqueta própria).
 * Cada um no ponto do rastro daquela hora; fora da janela, não aparece.
 */
export function marcosNoMapa(d: DetalheViaturaFrota): { lat: number; lng: number; texto: string; cor: string }[] {
  const f = d.fases;
  if (!f || !d.rastro.length) return [];
  const no = (iso: string | null) => (iso && iso >= d.rastro[0].em ? d.rastro.find((p) => p.em >= iso) ?? null : null);
  const u = f.unidade;
  const marcos: [string | null, string, string][] = [
    [f.partida, f.naBase ? "Saiu da base" : "Partiu", COR_FASE.resposta],
    [u?.entrada ?? null, u?.naBase ? "Chegou à unidade (base)" : "Chegou à unidade", COR_FASE.unidade],
    [u?.saida ?? null, "Saiu da unidade", COR_FASE.retorno],
    [f.chegadaBase, "Chegou à base", COR_FASE.retorno],
  ];
  return marcos.flatMap(([em, nome, cor]) => {
    const p = no(em);
    return p ? [{ lat: p.lat, lng: p.lng, texto: `${nome} ${hora(em!)}`, cor }] : [];
  });
}

/** Altura de um degrau de etiqueta empilhada no mapa do rastro (px). */
export const DEGRAU_PX = 22;

/**
 * Etiquetas perto umas das outras se cobrem no zoom que enquadra o trajeto todo
 * (local, unidade e a viatura a 300 m, no fim de um trajeto de 8 km). Cada
 * etiqueta a menos de 1/12 da diagonal do trajeto de uma já posta sobe um
 * degrau. Devolve (lat, lng) => degrau (0, 1, 2…); a primeira chamada fica no 0.
 */
export function empilhador(pontos: readonly { lat: number; lng: number }[]): (lat: number, lng: number) => number {
  const metros = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
  const lats = pontos.map((p) => p.lat), lngs = pontos.map((p) => p.lng);
  const diagonal = pontos.length
    ? metros({ lat: Math.min(...lats), lng: Math.min(...lngs) }, { lat: Math.max(...lats), lng: Math.max(...lngs) })
    : 0;
  const raio = Math.max(60, diagonal / 12);
  const postos: { lat: number; lng: number }[] = [];
  return (lat, lng) => {
    const n = postos.filter((p) => metros(p, { lat, lng }) < raio).length;
    postos.push({ lat, lng });
    return n;
  };
}

/** Cor de um ponto do rastro (os dois mapas do detalhe: Google e a reserva Leaflet). */
export function corDoPonto(d: DetalheViaturaFrota, p: DetalheViaturaFrota["rastro"][number]): string {
  if (p.fase) return p.fase === "retorno" && d.localizacao.estado === "fora-da-cerca" ? COR_RASTRO.foraAlerta : COR_FASE[p.fase];
  if (d.destino && p.local === d.destino.id) return COR_RASTRO.dentro;
  const saiu = d.localizacao.saiuEm ?? d.permanencia?.saida ?? null;
  if (saiu && p.em > saiu) return d.localizacao.estado === "fora-da-cerca" ? COR_RASTRO.foraAlerta : COR_RASTRO.fora;
  return COR_RASTRO.caminho;
}

export const NOME_FASE: Record<FaseRastroFrota, string> = {
  antes: "antes da ocorrência",
  resposta: "até o local",
  local: "no local",
  transporte: "até a unidade",
  unidade: "na unidade",
  retorno: "retorno",
  depois: "de volta à base",
};

export type EstadoOcorrencia = "ocorrencia" | "retornando" | "livre";

/**
 * Pelo mapa de equipes da regulação. `null` = o coletor não tem dado dessa
 * viatura agora (ponte parada, ou fora do mapa): não se afirma nada.
 * "DISPONÍVEL / RETORNO À BASE" é o último passo antes de o mapa soltar a
 * equipe — já está liberando, não é mais "em ocorrência".
 */
export function estadoOcorrencia(v: ViaturaFrota): EstadoOcorrencia | null {
  if (!v.ocorrencia) return null;
  const o = v.ocorrencia.ocorrencia;
  if (!o) return "livre";
  if (/DISPON[IÍ]VEL|RETORNO/i.test(o.status ?? "")) return "retornando";
  return "ocorrencia";
}

/** Na própria base — fora ou dentro de hospital/UPA. */
export function estaNaBase(v: ViaturaFrota): boolean {
  return v.naBase || Boolean(v.noHospital?.naBase);
}

const RISCO: Record<string, string> = {
  vermelho: "#dc2626",
  laranja: "#ea580c",
  amarelo: "#ca8a04",
  verde: "#16a34a",
  azul: "#2563eb",
};

/** Cor da classificação de risco; sem classificação conhecida, o violeta da ocorrência. */
export function corRisco(risco: string | null | undefined): string {
  return RISCO[(risco ?? "").trim().toLowerCase()] ?? COR.ocorrencia;
}

/** "Dr(a). Fulano" / "Téc. Beltrana", com "(escalado)" quando a Mesa ainda não tem chegada. */
export function textoResponsavel(r: ViaturaFrota["responsavel"]): string | null {
  if (!r) return null;
  const quem = r.funcao === "médico" ? "Médico(a)" : "Técnico(a)";
  return `${quem} ${nomeProprio(r.nome)}${r.fonte === "escala" ? " (escala)" : ""}`;
}

/** "BRUNA MICHELI ALVES" → "Bruna Micheli Alves". */
export function nomeProprio(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** "CHEGADA AO LOCAL" → "Chegada ao local". */
export function frase(s: string): string {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "na UPA", "na UE"; o resto (hospital, PA, Centro) é masculino: "no HGE". */
export function artigo(nome: string): "a" | "o" {
  return /^(UPA|UE)\b/.test(nome) ? "a" : "o";
}

export function corDaIdade(idadeMin: number, recenteMin: number): string {
  return idadeMin <= recenteMin ? COR.recente : COR.atrasada;
}

/**
 * Barra da parada: azul até 30 min, âmbar chegando, vermelho só com alerta
 * (`noHospital.alerta`, regra da api). Passou do limite livre: verde, sem aviso.
 */
export function corDaParada(n: { minutos: number; alerta: boolean }, alertaMin: number): string {
  if (n.alerta) return COR.alerta;
  if (n.minutos >= alertaMin) return COR.livre;
  if (n.minutos >= alertaMin - 10) return COR.atrasada;
  return COR.hospital;
}

export function duracao(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m && h < 6 ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.floor(min / 1440)} dias`;
}

// Um formatador só: o rastro de dias chama isto milhares de vezes a cada 30 s.
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

export function hora(iso: string): string {
  return HORA.format(new Date(iso));
}

const HORA_SEG = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Bahia" });

/** "10:41:12": a hora exata de um ponto (cursor do rastro, linha do tempo). */
export function horaSeg(iso: string): string {
  return HORA_SEG.format(new Date(iso));
}

export function ha(iso: string | null, agora = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  return s < 90 ? `há ${s} s` : `há ${duracao(Math.round(s / 60))}`;
}
