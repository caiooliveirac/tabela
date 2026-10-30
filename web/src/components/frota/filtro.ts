// Filtros da aba Frota: o que cada viatura no mapa está fazendo agora e onde
// está, mais os recortes que o JSON do SAMU+ e do mapa de equipes permitem
// (tipo, base, risco, fase da ocorrência, bateria, sinal, posição velha).
// Só filtra quem está no mapa; quem está fora do mapa tem a sua lista.
import type { ViaturaFrota } from "../../lib/types";
import { estaNaBase, estadoOcorrencia } from "./formato.ts";

/**
 * Acima disto (km/h, velocidade do SAMU+, lida a cada 10 min) a viatura sem
 * ocorrência conta como "em movimento", não como disponível parada.
 */
export const MOVIMENTO_KMH = 5;
/** Bateria do celular abaixo disto, e sinal até isto: aparecem em "atenção". */
export const BATERIA_BAIXA = 20;
export const SINAL_FRACO = 25;

export type Atividade = "disponivel" | "ocorrencia" | "retornando" | "movimento" | "sem-info";
export type Onde = "base" | "hospital" | "rua";

export const ATIVIDADES: { id: Atividade; rotulo: string; nota: string }[] = [
  { id: "disponivel", rotulo: "Disponíveis", nota: "livre no mapa de equipes e parada" },
  { id: "ocorrencia", rotulo: "Em ocorrência", nota: "ocorrência aberta no mapa de equipes" },
  { id: "retornando", rotulo: "Encerrando", nota: "disponível / retorno à base" },
  { id: "movimento", rotulo: "Só em movimento", nota: `sem ocorrência, andando (acima de ${MOVIMENTO_KMH} km/h)` },
  { id: "sem-info", rotulo: "Sem informação", nota: "parada e fora do mapa de equipes" },
];

export const ONDES: { id: Onde; rotulo: string }[] = [
  { id: "base", rotulo: "Na base" },
  { id: "hospital", rotulo: "Em hospital/UPA" },
  { id: "rua", rotulo: "Na rua" },
];

export function atividade(v: ViaturaFrota): Atividade {
  const e = estadoOcorrencia(v);
  if (e === "ocorrencia" || e === "retornando") return e;
  if ((v.velocidade ?? 0) > MOVIMENTO_KMH) return "movimento";
  return e === "livre" ? "disponivel" : "sem-info";
}

export function onde(v: ViaturaFrota): Onde {
  if (estaNaBase(v)) return "base";
  if (v.noHospital) return "hospital";
  return "rua";
}

export interface Filtro {
  atividade: Atividade | null;
  /** Vazio = todos os tipos. */
  tipos: string[];
  onde: Onde | null;
  base: string | null;
  risco: string | null;
  fase: string | null;
  bateriaBaixa: boolean;
  sinalFraco: boolean;
  posicaoVelha: boolean;
  busca: string;
}

export const FILTRO_VAZIO: Filtro = {
  atividade: null,
  tipos: [],
  onde: null,
  base: null,
  risco: null,
  fase: null,
  bateriaBaixa: false,
  sinalFraco: false,
  posicaoVelha: false,
  busca: "",
};

export function filtroAtivo(f: Filtro): boolean {
  return JSON.stringify(f) !== JSON.stringify(FILTRO_VAZIO);
}

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** `recenteMin`: posição mais velha que isto conta como "posição atrasada". */
export function passa(v: ViaturaFrota, f: Filtro, recenteMin: number): boolean {
  const oc = v.ocorrencia?.ocorrencia ?? null;
  if (f.atividade && atividade(v) !== f.atividade) return false;
  if (f.tipos.length && !f.tipos.includes(v.tipo ?? "")) return false;
  if (f.onde && onde(v) !== f.onde) return false;
  if (f.base && v.base !== f.base) return false;
  if (f.risco && (oc?.risco ?? "").toLowerCase() !== f.risco.toLowerCase()) return false;
  if (f.fase && oc?.status !== f.fase) return false;
  if (f.bateriaBaixa && !(v.bateria != null && v.bateria < BATERIA_BAIXA)) return false;
  if (f.sinalFraco && !(v.sinal != null && v.sinal <= SINAL_FRACO)) return false;
  if (f.posicaoVelha && !((v.posicao?.idadeMin ?? 0) > recenteMin)) return false;
  const q = semAcento(f.busca.trim());
  if (q) {
    const onde = [v.nome, v.nomeSamu, v.base, v.noHospital?.hospitalNome, oc?.protocolo, oc?.bairro, oc?.queixa]
      .filter(Boolean)
      .join(" ");
    if (!semAcento(onde).includes(q)) return false;
  }
  return true;
}

/** Valores presentes nos dados, com contagem, mais frequentes primeiro. */
export function opcoes(vs: ViaturaFrota[], de: (v: ViaturaFrota) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const v of vs) {
    const k = de(v);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
}
