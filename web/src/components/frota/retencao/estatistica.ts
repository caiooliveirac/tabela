// ═══════════════════════════════════════════════════════════════
// Estatística da retenção — puro, sem React (testado em web/test/retencao.test.ts).
//
// A API (GET /frota/retencao, api/src/frota/retencao.ts) manda cada parada de
// 10+ min fora da base; aqui se filtra e agrega. Boas práticas seguidas:
// mediana e P90 em vez de média (distribuição torta à direita), N sempre ao
// lado, percentil escondido com amostra pequena, dia e hora de Salvador.
// ═══════════════════════════════════════════════════════════════

export type PerfilLocal = "geral" | "psiq" | "infecto" | "privado" | "upa";

export interface RetencaoApi {
  ativo: boolean;
  de: string;
  ate: string;
  geradoEm: string;
  alertaMin: number;
  visitaMin: number;
  locais: { id: string; nome: string; tipo: "hospital" | "upa"; perfil: PerfilLocal }[];
  viaturas: { nome: string; tipo: string | null; base: string | null }[];
  /** [entrada em min desde a época, minutos, local, viatura, situação 0 oc|1 livre|2 sem dado, fim 0 saiu|1 aberta|2 sem sinal] */
  paradas: [number, number, number, number, 0 | 1 | 2, 0 | 1 | 2][];
}

export const PERFIS: { id: PerfilLocal; rotulo: string }[] = [
  { id: "geral", rotulo: "Hospital geral" },
  { id: "psiq", rotulo: "Psiquiátrico" },
  { id: "infecto", rotulo: "Infectologia" },
  { id: "privado", rotulo: "Privado / filantrópico" },
  { id: "upa", rotulo: "UPA / pronto-atendimento" },
];

export interface Parada {
  /** ms */
  inicio: number;
  min: number;
  localId: string;
  local: string;
  perfil: PerfilLocal;
  viatura: string;
  tipo: string;
  base: string;
  situacao: "ocorrencia" | "livre" | "sem-dado";
  fim: "saiu" | "aberta" | "sem-sinal";
}

const SITUACOES = ["ocorrencia", "livre", "sem-dado"] as const;
const FINS = ["saiu", "aberta", "sem-sinal"] as const;

export function expandir(r: RetencaoApi): Parada[] {
  return r.paradas.map(([ini, min, l, v, s, f]) => {
    const local = r.locais[l];
    const vt = r.viaturas[v];
    return {
      inicio: ini * 60_000,
      min,
      localId: local.id,
      local: local.nome,
      perfil: local.perfil,
      viatura: vt.nome,
      tipo: vt.tipo ?? "—",
      base: vt.base ?? "—",
      situacao: SITUACOES[s],
      fim: FINS[f],
    };
  });
}

// ── Tempo de Salvador (UTC−3 o ano todo) ──
const FUSO = 3 * 3_600_000;
export const DIA_MS = 86_400_000;
const bahia = (ms: number) => new Date(ms - FUSO);
export const diaBahia = (ms: number) => bahia(ms).toISOString().slice(0, 10);
/** 0 = segunda … 6 = domingo. */
export const diaSemana = (ms: number) => (bahia(ms).getUTCDay() + 6) % 7;
export const horaBahia = (ms: number) => bahia(ms).getUTCHours();
/** Meia-noite de Salvador do dia AAAA-MM-DD, em ms UTC. */
export const inicioDoDia = (dia: string) => Date.parse(`${dia}T00:00:00Z`) + FUSO;
export const somarDias = (dia: string, n: number) => diaBahia(inicioDoDia(dia) + n * DIA_MS + 3_600_000);

// ── Filtro ──
export interface FiltroRetencao {
  tipo: "" | "USA" | "USB";
  perfis: PerfilLocal[];
  locais: string[];
  viatura: string;
  incluirLivres: boolean;
}
export const FILTRO_INICIAL: FiltroRetencao = { tipo: "", perfis: [], locais: [], viatura: "", incluirLivres: false };

export function filtrar(ps: readonly Parada[], f: FiltroRetencao, de: number, ate: number): Parada[] {
  return ps.filter(
    (p) =>
      p.inicio >= de &&
      p.inicio < ate &&
      (f.incluirLivres || p.situacao !== "livre") &&
      (!f.tipo || p.tipo === f.tipo) &&
      (!f.perfis.length || f.perfis.includes(p.perfil)) &&
      (!f.locais.length || f.locais.includes(p.localId)) &&
      (!f.viatura || p.viatura === f.viatura),
  );
}

// ── Resumo ──
/** Percentil com interpolação linear (o mesmo do histórico da API). */
export function quantil(ordenado: readonly number[], q: number): number {
  if (!ordenado.length) return NaN;
  const i = (ordenado.length - 1) * q;
  const a = Math.floor(i);
  const b = Math.ceil(i);
  return ordenado[a] + (ordenado[b] - ordenado[a]) * (i - a);
}

/** Abaixo disto o percentil não se mostra (um caso longo vira "P90"). */
export const AMOSTRA_MIN = 5;

export interface Resumo {
  n: number;
  p25: number;
  mediana: number;
  p75: number;
  p90: number;
  p95: number;
  media: number;
  maior: number;
  /** Fração (0–1) com `alertaMin` ou mais. */
  fracAlerta: number;
  /** 60+ e 120+ min, idem. */
  frac60: number;
  frac120: number;
  /** Horas somadas além do limite (ex.: 55 min = 15 min além de 40). */
  horasAlem: number;
  horasTotal: number;
  abertas: number;
  semSinal: number;
}

export function resumir(ps: readonly Parada[], alertaMin: number): Resumo {
  const m = ps.map((p) => p.min).sort((a, b) => a - b);
  const n = m.length;
  const soma = m.reduce((s, x) => s + x, 0);
  const conta = (lim: number) => (n ? m.filter((x) => x >= lim).length / n : NaN);
  return {
    n,
    p25: quantil(m, 0.25),
    mediana: quantil(m, 0.5),
    p75: quantil(m, 0.75),
    p90: quantil(m, 0.9),
    p95: quantil(m, 0.95),
    media: n ? soma / n : NaN,
    maior: n ? m[n - 1] : NaN,
    fracAlerta: conta(alertaMin),
    frac60: conta(60),
    frac120: conta(120),
    horasAlem: m.reduce((s, x) => s + Math.max(0, x - alertaMin), 0) / 60,
    horasTotal: soma / 60,
    abertas: ps.filter((p) => p.fim === "aberta").length,
    semSinal: ps.filter((p) => p.fim === "sem-sinal").length,
  };
}

// ── Série no tempo ──
export interface PontoSerie {
  chave: string;
  inicio: number;
  /** Dias do balde (semana parcial nas pontas tem menos). */
  dias: number;
  resumo: Resumo;
}

/** Segunda-feira (Salvador) da semana do dia. */
export function segundaDa(dia: string): string {
  return somarDias(dia, -diaSemana(inicioDoDia(dia) + 3_600_000));
}

export function serie(ps: readonly Parada[], de: number, ate: number, balde: "dia" | "semana", alertaMin: number): PontoSerie[] {
  const chaves: string[] = [];
  const dias = new Map<string, number>();
  for (let t = de; t < ate; t += DIA_MS) {
    const d = diaBahia(t + 3_600_000);
    const k = balde === "dia" ? d : segundaDa(d);
    if (!dias.has(k)) chaves.push(k);
    dias.set(k, (dias.get(k) ?? 0) + 1);
  }
  const grupos = new Map<string, Parada[]>(chaves.map((k) => [k, []]));
  for (const p of ps) {
    const d = diaBahia(p.inicio);
    grupos.get(balde === "dia" ? d : segundaDa(d))?.push(p);
  }
  return chaves.map((k) => ({ chave: k, inicio: inicioDoDia(k), dias: dias.get(k) ?? 0, resumo: resumir(grupos.get(k)!, alertaMin) }));
}

// ── Distribuição ──
export const FAIXAS: { de: number; ate: number; rotulo: string }[] = [
  { de: 10, ate: 20, rotulo: "10–19" },
  { de: 20, ate: 30, rotulo: "20–29" },
  { de: 30, ate: 40, rotulo: "30–39" },
  { de: 40, ate: 60, rotulo: "40–59" },
  { de: 60, ate: 90, rotulo: "60–89" },
  { de: 90, ate: 120, rotulo: "90–119" },
  { de: 120, ate: 180, rotulo: "2–3 h" },
  { de: 180, ate: Infinity, rotulo: "3 h +" },
];

export function histograma(ps: readonly Parada[]): { rotulo: string; de: number; n: number }[] {
  return FAIXAS.map((f) => ({ rotulo: f.rotulo, de: f.de, n: ps.filter((p) => p.min >= f.de && p.min < f.ate).length }));
}

// ── Por grupo (local, viatura, perfil) ──
export interface LinhaGrupo {
  chave: string;
  rotulo: string;
  extra: string;
  resumo: Resumo;
}

export function porGrupo(
  ps: readonly Parada[],
  chave: (p: Parada) => string,
  rotulo: (p: Parada) => string,
  extra: (p: Parada) => string,
  alertaMin: number,
): LinhaGrupo[] {
  const g = new Map<string, Parada[]>();
  for (const p of ps) g.set(chave(p), [...(g.get(chave(p)) ?? []), p]);
  return [...g.entries()].map(([k, xs]) => ({ chave: k, rotulo: rotulo(xs[0]), extra: extra(xs[0]), resumo: resumir(xs, alertaMin) }));
}

export type Ordem = "p90" | "mediana" | "fracAlerta" | "n" | "horasAlem";
export const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "p90", rotulo: "P90" },
  { id: "mediana", rotulo: "Mediana" },
  { id: "fracAlerta", rotulo: "% retidas" },
  { id: "horasAlem", rotulo: "Horas além do limite" },
  { id: "n", rotulo: "Paradas" },
];

/** Amostra pequena vai para o fim, seja qual for a ordem: não disputa o topo com um caso só. */
export function ordenar(ls: readonly LinhaGrupo[], o: Ordem): LinhaGrupo[] {
  const v = (l: LinhaGrupo) => (Number.isFinite(l.resumo[o]) ? l.resumo[o] : -1);
  return [...ls].sort(
    (a, b) =>
      Number(b.resumo.n >= AMOSTRA_MIN) - Number(a.resumo.n >= AMOSTRA_MIN) || v(b) - v(a) || b.resumo.n - a.resumo.n,
  );
}

// ── Dia da semana × hora da chegada ──
export const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/** Faixas de 2 h: 0 = 00–01h … 11 = 22–23h. */
export function calor(ps: readonly Parada[], alertaMin: number): Resumo[][] {
  const g: Parada[][][] = DIAS_SEMANA.map(() => Array.from({ length: 12 }, () => []));
  for (const p of ps) g[diaSemana(p.inicio)][Math.floor(horaBahia(p.inicio) / 2)].push(p);
  return g.map((linha) => linha.map((xs) => resumir(xs, alertaMin)));
}

// ── Exportação ──
const SIT_ROTULO = { ocorrencia: "em ocorrência", livre: "livre", "sem-dado": "sem dado do mapa" } as const;
const FIM_ROTULO = { saiu: "saiu", aberta: "ainda no local", "sem-sinal": "sem sinal (mínimo)" } as const;

export function csv(ps: readonly Parada[]): string {
  const q = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = ps.map((p) => {
    const d = bahia(p.inicio).toISOString();
    return [d.slice(0, 10), d.slice(11, 16), p.viatura, p.tipo, p.base, p.local, PERFIS.find((x) => x.id === p.perfil)?.rotulo ?? p.perfil,
      String(p.min), SIT_ROTULO[p.situacao], FIM_ROTULO[p.fim]].map(q).join(";");
  });
  return ["data;chegada;viatura;tipo;base;local;perfil;minutos;situacao;fim", ...linhas].join("\n");
}

export const rotuloSituacao = (s: Parada["situacao"]) => SIT_ROTULO[s];
export const rotuloFim = (f: Parada["fim"]) => FIM_ROTULO[f];

// ── Formato ──
export function minutos(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const m = Math.round(x);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
export const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
export const dataCurta = (ms: number) => {
  const d = bahia(ms).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};
export const dataHora = (ms: number) => {
  const d = bahia(ms).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};
