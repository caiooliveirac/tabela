// Cores e textos da aba Frota. Cor carrega estado: verde/âmbar é a idade da
// posição (a mesma régua do painel de destino), azul é "parada em hospital",
// vermelho é só o alerta de 40 min. Violeta é "em ocorrência" (mapa de equipes).
import type { ViaturaFrota } from "../../lib/types";

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

/** Barra da parada: azul até 30 min, âmbar chegando, vermelho no limite. */
export function corDaParada(minutos: number, alertaMin: number): string {
  if (minutos >= alertaMin) return COR.alerta;
  if (minutos >= alertaMin - 10) return COR.atrasada;
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

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bahia",
  });
}

export function ha(iso: string | null, agora = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  return s < 90 ? `há ${s} s` : `há ${duracao(Math.round(s / 60))}`;
}
