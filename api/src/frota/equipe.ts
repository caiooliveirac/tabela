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
//
// Regra dura 7 (~/Projetos/CLAUDE.md): a escala é o ESPERADO. O informado na
// hora vence: Relatório da chefia (linha confirmada ou editada; GET
// /api/servicos/equipe, RELATORIO_TOKEN = RELATORIO_SERVICO_TOKEN de lá) e
// Quadro Informativo (equipe do turno digitada pela Central ou passada no
// Telegram; GET /api/interno/equipes, QUADRO_TOKEN = QUADRO_INTERNO_TOKEN de
// lá). Médico: Relatório > Mesa > Quadro > escala; o resto: Relatório >
// Quadro > escala. Falta informada no Relatório é falta, não o nome da escala.
// ═══════════════════════════════════════════════════════════════
import { mesaAgora } from "./plantoes.js";

const URL_BASE = (process.env.ESCALA_URL || "https://escala.mnrs.com.br").replace(/\/$/, "");
const TOKEN = process.env.ESCALA_TOKEN || "";
const RELATORIO_URL = (process.env.RELATORIO_URL || "https://relatorio.mnrs.com.br").replace(/\/$/, "");
const RELATORIO_TOKEN = process.env.RELATORIO_TOKEN || "";
const QUADRO_URL = (process.env.QUADRO_URL || "https://quadro.mnrs.com.br").replace(/\/$/, "");
const QUADRO_TOKEN = process.env.QUADRO_TOKEN || "";
const MEMO_MS = 5 * 60_000;

export interface Responsavel {
    /** Nome curto ("Fulano Silva"); dupla na USA vem como "Fulano + Beltrano". */
    nome: string;
    funcao: "médico" | "técnico";
    /**
     * relatorio = confirmado/editado no Relatório da chefia; quadro = informado
     * no Quadro; mesa = chegada registrada no Plantões; escala = só o esperado.
     */
    fonte: Fonte;
}

export type Fonte = "relatorio" | "quadro" | "mesa" | "escala";
export type Categoria = "MEDICO" | "ENFERMEIRO" | "TECNICO_ENFERMAGEM" | "CONDUTOR";

/** Quem foi informado na hora para uma viatura (Relatório ou Quadro). `nome: null` = falta informada. */
export interface Informado {
    categoria: Categoria;
    nome: string | null;
    fonte: "relatorio" | "quadro";
}

/** Função do Relatório (MI, ENF, TE, COND) → categoria da escala. */
const DO_RELATORIO: Record<string, Categoria> = { MI: "MEDICO", ENF: "ENFERMEIRO", TE: "TECNICO_ENFERMAGEM", COND: "CONDUTOR" };

/** Papel livre do Quadro ("Médico(a)", "TE", "Téc. enf.", "Condutor(a)") → categoria. */
export function categoriaDoPapel(papel: string): Categoria | null {
    const p = papel.trim().toLowerCase();
    if (/^m[eé]d/.test(p)) return "MEDICO";
    if (/^enf/.test(p)) return "ENFERMEIRO";
    if (/^(te\b|t[eé]c)/.test(p)) return "TECNICO_ENFERMAGEM";
    if (/^cond|^motor/.test(p)) return "CONDUTOR";
    return null;
}

export interface PessoaEscala {
    nome: string;
    nomeCurto?: string | null;
    categoria: string;
}

/** "SM-01" → "SM01" (o código do catálogo da frota). */
export const codigoDoPosto = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Pura: o responsável de uma viatura — o médico da USA, o técnico(a) da USB —
 * pela mesma precedência da equipe (informado > escala). Falta informada sem
 * substituto: ninguém.
 */
export function responsavelDe(
    tipo: "USA" | "USB" | "MOTO" | null,
    codigo: string | null,
    medicosMesa: ReadonlyMap<string, string>,
    escala: ReadonlyMap<string, readonly PessoaEscala[]>,
    informado: ReadonlyMap<string, readonly Informado[]> = new Map(),
): Responsavel | null {
    const categoria = tipo === "USA" ? "MEDICO" : tipo === "USB" ? "TECNICO_ENFERMAGEM" : null;
    if (!categoria) return null;
    const quem = equipeDe(tipo, codigo, medicosMesa, escala, informado).filter((m) => m.categoria === categoria && m.nome);
    if (!quem.length) return null;
    return { nome: quem.map((m) => m.nome).join(" + "), funcao: categoria === "MEDICO" ? "médico" : "técnico", fonte: quem[0].fonte };
}

let medicos: Map<string, string> = new Map();
let escala: { em: number; porCodigo: Map<string, PessoaEscala[]> } | null = null;
let doRelatorio: { em: number; porCodigo: Map<string, Informado[]> } | null = null;
let doQuadro: { em: number; porCodigo: Map<string, Informado[]> } | null = null;

const juntar = (porCodigo: Map<string, Informado[]>, codigo: string, i: Informado) => {
    const arr = porCodigo.get(codigo) ?? [];
    arr.push(i);
    porCodigo.set(codigo, arr);
};

/** Relatório da chefia, turno vigente: só linha confirmada ou editada (o resto é a escala). */
async function lerRelatorio(): Promise<void> {
    if (!RELATORIO_TOKEN || (doRelatorio && Date.now() - doRelatorio.em < MEMO_MS)) return;
    const res = await fetch(`${RELATORIO_URL}/api/servicos/equipe`, {
        headers: { "x-relatorio-token": RELATORIO_TOKEN, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`relatório: HTTP ${res.status}`);
    const corpo = (await res.json()) as {
        equipe?: { posto: string; funcao: string; nome: string | null; confirmado: boolean; editado: boolean }[];
    };
    const porCodigo = new Map<string, Informado[]>();
    for (const l of corpo.equipe ?? []) {
        const categoria = DO_RELATORIO[l.funcao];
        if (!categoria || !(l.confirmado || l.editado)) continue;
        juntar(porCodigo, codigoDoPosto(l.posto), { categoria, nome: l.nome?.trim() || null, fonte: "relatorio" });
    }
    doRelatorio = { em: Date.now(), porCodigo };
}

/** Quadro Informativo: equipe digitada/passada para o turno vigente (`doTurno`). */
async function lerQuadro(): Promise<void> {
    if (!QUADRO_TOKEN || (doQuadro && Date.now() - doQuadro.em < MEMO_MS)) return;
    const res = await fetch(`${QUADRO_URL}/api/interno/equipes`, {
        headers: { "x-quadro-token": QUADRO_TOKEN, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`quadro: HTTP ${res.status}`);
    const corpo = (await res.json()) as { unidades?: { codigo: string; pessoas: { papel: string; nome: string }[]; doTurno: boolean }[] };
    const porCodigo = new Map<string, Informado[]>();
    for (const u of corpo.unidades ?? []) {
        if (!u.doTurno) continue;
        for (const p of u.pessoas ?? []) {
            const categoria = categoriaDoPapel(p.papel);
            if (categoria && p.nome?.trim()) juntar(porCodigo, codigoDoPosto(u.codigo), { categoria, nome: p.nome.trim(), fonte: "quadro" });
        }
    }
    doQuadro = { em: Date.now(), porCodigo };
}

/** Relatório e Quadro juntos, por código (a precedência entre eles é do `equipeDe`). */
function informadoAgora(): Map<string, Informado[]> {
    const saida = new Map<string, Informado[]>();
    for (const fonte of [doRelatorio?.porCodigo, doQuadro?.porCodigo]) {
        for (const [codigo, lista] of fonte ?? []) for (const i of lista) juntar(saida, codigo, i);
    }
    return saida;
}

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
    const [mesa, esc, rel, quadro] = await Promise.allSettled([mesaAgora(), lerEscala(), lerRelatorio(), lerQuadro()]);
    if (mesa.status === "fulfilled") medicos = mesa.value?.medicos ?? new Map();
    for (const r of [esc, mesa, rel, quadro]) if (r.status === "rejected") throw r.reason;
}

/** Para o painel (síncrono): o que as últimas leituras deram. */
export function responsavelAgora(tipo: "USA" | "USB" | "MOTO" | null, codigo: string | null): Responsavel | null {
    return responsavelDe(tipo, codigo, medicos, escala?.porCodigo ?? new Map(), informadoAgora());
}

const FUNCAO: Record<Categoria, string> = {
    MEDICO: "Médico(a)",
    ENFERMEIRO: "Enfermeiro(a)",
    TECNICO_ENFERMAGEM: "Técnico(a) de enfermagem",
    CONDUTOR: "Condutor(a)",
};
const ORDEM = Object.keys(FUNCAO) as Categoria[];

export interface MembroEquipe {
    /** `null` = falta informada (Relatório da chefia), sem substituto. */
    nome: string | null;
    categoria: string;
    funcao: string;
    fonte: Fonte;
}

/**
 * Pura: a equipe da viatura no turno, função por função, da fonte mais
 * confiável que tiver alguém: Relatório (confirmado/editado) > Mesa (só o
 * médico da USA) > Quadro > escala. Sem fonte, vazia.
 */
export function equipeDe(
    tipo: "USA" | "USB" | "MOTO" | null,
    codigo: string | null,
    medicosMesa: ReadonlyMap<string, string>,
    escalaPorCodigo: ReadonlyMap<string, readonly PessoaEscala[]>,
    informado: ReadonlyMap<string, readonly Informado[]> = new Map(),
): MembroEquipe[] {
    if (!codigo) return [];
    const info = informado.get(codigo) ?? [];
    const esperados = escalaPorCodigo.get(codigo) ?? [];
    const mesa = tipo === "USA" ? medicosMesa.get(codigo) : undefined;
    const outras = [...new Set(esperados.map((p) => p.categoria).filter((c) => !ORDEM.includes(c as Categoria)))];
    const saida: MembroEquipe[] = [];
    for (const categoria of [...ORDEM, ...outras]) {
        const funcao = FUNCAO[categoria as Categoria] ?? categoria.toLowerCase().replace(/_/g, " ");
        const de = (f: "relatorio" | "quadro") => info.filter((i) => i.fonte === f && i.categoria === categoria);
        const rel = de("relatorio");
        const quadro = de("quadro");
        const esc = esperados.filter((p) => p.categoria === categoria).map((p) => (p.nomeCurto || p.nome).trim()).filter(Boolean);
        const lista: { nome: string | null; fonte: Fonte }[] = rel.length
            ? rel.map((i) => ({ nome: i.nome, fonte: "relatorio" }))
            : categoria === "MEDICO" && mesa
              ? [{ nome: mesa, fonte: "mesa" }]
              : quadro.length
                ? quadro.map((i) => ({ nome: i.nome, fonte: "quadro" }))
                : esc.map((nome) => ({ nome, fonte: "escala" }));
        // Relatório com quem veio e com falta na mesma função: a falta é da pessoa escalada, quem veio cobre.
        const comNome = lista.filter((m) => m.nome);
        for (const m of comNome.length ? comNome : lista) saida.push({ nome: m.nome, categoria, funcao, fonte: m.fonte });
    }
    return saida;
}

/** Para o detalhe da viatura: a equipe e quais fontes estão ligadas. */
export function equipeAgora(tipo: "USA" | "USB" | "MOTO" | null, codigo: string | null): {
    escalaLigada: boolean;
    informadoLigado: boolean;
    membros: MembroEquipe[];
} {
    return {
        escalaLigada: Boolean(TOKEN),
        informadoLigado: Boolean(RELATORIO_TOKEN || QUADRO_TOKEN),
        membros: equipeDe(tipo, codigo, medicos, escala?.porCodigo ?? new Map(), informadoAgora()),
    };
}

/**
 * Só a escala (o ESPERADO), por função — para quem precisa SUGERIR e pedir
 * confirmação (o Quadro pré-preenche a equipe a confirmar). Nunca é "quem está".
 */
export function escalaAgora(codigo: string | null): { categoria: string; funcao: string; nome: string }[] {
    if (!codigo) return [];
    const pos = (c: string) => (ORDEM.includes(c as Categoria) ? ORDEM.indexOf(c as Categoria) : ORDEM.length);
    return [...(escala?.porCodigo.get(codigo) ?? [])]
        .sort((a, b) => pos(a.categoria) - pos(b.categoria))
        .map((p) => ({ categoria: p.categoria, funcao: FUNCAO[p.categoria as Categoria] ?? p.categoria.toLowerCase().replace(/_/g, " "), nome: (p.nomeCurto || p.nome).trim() }))
        .filter((p) => p.nome);
}
