// ═══════════════════════════════════════════════════════════════
// Quem responde por cada viatura agora, para o coordenador saber de quem
// cobrar: o médico na USA, o técnico(a) de enfermagem na USB.
//
// USA: o médico com chegada registrada na Mesa do Plantões (plantoes.ts) é
// quem está lá; sem chegada ainda, o médico que a escala espera, marcado
// como "escalado". USB: o técnico(a) que a escala (escalas-e-trocas,
// GET /api/servicos/relatorio/turno) espera no posto neste turno.
// Token da escala = ESPERADOS_TOKEN de lá, aqui ESCALA_TOKEN. Sem token ou
// fora do ar: só o que a Mesa der. Nunca inventa: sem fonte, sem nome.
// ═══════════════════════════════════════════════════════════════
import { mesaAgora } from "./plantoes.js";

const URL_BASE = (process.env.ESCALA_URL || "https://escala.mnrs.com.br").replace(/\/$/, "");
const TOKEN = process.env.ESCALA_TOKEN || "";
const MEMO_MS = 5 * 60_000;

export interface Responsavel {
    /** Nome curto ("Fulano Silva"); dupla na USA vem como "Fulano + Beltrano". */
    nome: string;
    funcao: "médico" | "técnico";
    /** mesa = chegada registrada no Plantões; escala = esperado pela escala do turno. */
    fonte: "mesa" | "escala";
}

export interface PessoaEscala {
    nome: string;
    nomeCurto?: string | null;
    categoria: string;
}

/** "SM-01" → "SM01" (o código do catálogo da frota). */
export const codigoDoPosto = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

const nomesDe = (ps: readonly PessoaEscala[], categoria: string) =>
    ps.filter((p) => p.categoria === categoria).map((p) => (p.nomeCurto || p.nome).trim()).filter(Boolean);

/** Pura: o responsável de uma viatura a partir do que Mesa e escala disseram. */
export function responsavelDe(
    tipo: "USA" | "USB" | "MOTO" | null,
    codigo: string | null,
    medicosMesa: ReadonlyMap<string, string>,
    escala: ReadonlyMap<string, readonly PessoaEscala[]>,
): Responsavel | null {
    if (!codigo) return null;
    if (tipo === "USA") {
        const mesa = medicosMesa.get(codigo);
        if (mesa) return { nome: mesa, funcao: "médico", fonte: "mesa" };
        const esc = nomesDe(escala.get(codigo) ?? [], "MEDICO");
        return esc.length ? { nome: esc.join(" + "), funcao: "médico", fonte: "escala" } : null;
    }
    if (tipo === "USB") {
        const esc = nomesDe(escala.get(codigo) ?? [], "TECNICO_ENFERMAGEM");
        return esc.length ? { nome: esc.join(" + "), funcao: "técnico", fonte: "escala" } : null;
    }
    return null;
}

let medicos: Map<string, string> = new Map();
let escala: { em: number; porCodigo: Map<string, PessoaEscala[]> } | null = null;

async function lerEscala(): Promise<Map<string, PessoaEscala[]> | null> {
    if (!TOKEN) return null;
    if (escala && Date.now() - escala.em < MEMO_MS) return escala.porCodigo;
    const res = await fetch(`${URL_BASE}/api/servicos/relatorio/turno`, {
        headers: { "x-esperados-token": TOKEN, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`escala: HTTP ${res.status}`);
    const corpo = (await res.json()) as { postos?: { codigo: string; pessoas?: PessoaEscala[] }[] };
    const porCodigo = new Map<string, PessoaEscala[]>();
    for (const p of corpo.postos ?? []) if (p.pessoas?.length) porCodigo.set(codigoDoPosto(p.codigo), p.pessoas);
    escala = { em: Date.now(), porCodigo };
    return porCodigo;
}

/** Chamado a cada coleta; falha de uma fonte não apaga o que a outra deu. */
export async function atualizarEquipe(): Promise<void> {
    const [mesa, esc] = await Promise.allSettled([mesaAgora(), lerEscala()]);
    if (mesa.status === "fulfilled") medicos = mesa.value?.medicos ?? new Map();
    if (esc.status === "rejected") throw esc.reason;
    if (mesa.status === "rejected") throw mesa.reason;
}

/** Para o painel (síncrono): o que as últimas leituras deram. */
export function responsavelAgora(tipo: "USA" | "USB" | "MOTO" | null, codigo: string | null): Responsavel | null {
    return responsavelDe(tipo, codigo, medicos, escala?.porCodigo ?? new Map());
}
