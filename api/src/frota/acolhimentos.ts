// ═══════════════════════════════════════════════════════════════
// Cruzamento com o Acolhimentos (acolhimentos.mnrs.com.br, repo
// caio-olive/help-mnrs): o que a equipe NOTIFICOU — chegada, passagem do
// paciente, liberação e maca retida — ao lado do que o GPS VIU.
//
// Leitura pelo endpoint de serviço `GET /api/servico/acolhimentos` (token
// ACOLHIMENTOS_TOKEN). O Acolhimentos só cobre as USAs; USB parada 40+ min
// sem notificação não é falta de ninguém.
// Sem token: cruzamento desligado, a linha do tempo segue só com o GPS.
// ═══════════════════════════════════════════════════════════════

const URL_BASE = (process.env.ACOLHIMENTOS_URL || "https://acolhimentos.mnrs.com.br").replace(/\/$/, "");
const TOKEN = process.env.ACOLHIMENTOS_TOKEN || "";
const MEMO_MS = 60_000;
/** Folga para casar GPS e notificação: relógio do celular e 2 min de coleta. */
const FOLGA_MS = 15 * 60_000;
/**
 * Notificação sem liberação: a equipe esquece de fechar. Vale no máximo 2 h
 * depois da chegada — senão uma notificação aberta de anteontem atravessaria
 * a linha do tempo inteira.
 */
export const ABERTA_MAX_MS = 2 * 3_600_000;

export interface Acolhimento {
    id: string;
    unidade: string;
    hospital: string | null;
    status: string;
    vagaZero: boolean;
    chegada: string | null;
    passagem: string | null;
    liberada: string | null;
    totalS: number | null;
    motivos: string[];
    retencoes: { equipamento: string; inicio: string; fim: string | null }[];
}

export function acolhimentosLigado(): boolean {
    return Boolean(TOKEN);
}

let memo: { chave: string; em: number; dados: Acolhimento[] } | null = null;

export async function buscarAcolhimentos(desde: Date, ate: Date): Promise<Acolhimento[]> {
    const chave = `${desde.toISOString().slice(0, 16)}|${ate.toISOString().slice(0, 16)}`;
    if (memo && memo.chave === chave && Date.now() - memo.em < MEMO_MS) return memo.dados;
    // O serviço aceita no máximo 7 dias por chamada: período maior vai em pedaços.
    const porId = new Map<string, Acolhimento>();
    for (let ini = desde.getTime(); ini < ate.getTime(); ini += PEDACO_MS) {
        const fim = Math.min(ate.getTime(), ini + PEDACO_MS);
        for (const o of await buscarPedaco(new Date(ini), new Date(fim))) porId.set(o.id, o);
    }
    const dados = [...porId.values()].filter((o) => o.status !== "cancelled");
    memo = { chave, em: Date.now(), dados };
    return dados;
}

const PEDACO_MS = 6 * 86_400_000;

async function buscarPedaco(desde: Date, ate: Date): Promise<Acolhimento[]> {
    const q = new URLSearchParams({ desde: desde.toISOString(), ate: ate.toISOString() });
    const res = await fetch(`${URL_BASE}/api/servico/acolhimentos?${q}`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`acolhimentos: HTTP ${res.status}`);
    return ((await res.json()) as { ocorrencias?: Acolhimento[] }).ocorrencias ?? [];
}

/**
 * Início da busca no Acolhimentos para cruzar as paradas de uma janela que
 * começa em `desde`. O serviço filtra pela chegada: a parada aberta mais antiga
 * (fora da base) puxa o início para trás — senão a USA presa há mais tempo que
 * a janela perde a notificação que a equipe já fez e o médico é cobrado.
 * Quem chegou até 2 h antes ainda pode estar dentro (notificação sem liberação).
 */
export function inicioBusca(desde: Date, paradas: readonly { entrada: string; aberta: boolean; naBase: boolean }[]): Date {
    let ini = desde.getTime();
    for (const p of paradas) if (p.aberta && !p.naBase) ini = Math.min(ini, Date.parse(p.entrada));
    return new Date(ini - ABERTA_MAX_MS);
}

/** Janela da notificação: da chegada à liberação (sem liberação: até agora, no máximo 2 h). */
export function janela(a: Pick<Acolhimento, "chegada" | "passagem" | "liberada">, agora: number): [number, number] | null {
    const ini = a.chegada ?? a.passagem;
    if (!ini) return null;
    const t = Date.parse(ini);
    return [t, a.liberada ? Date.parse(a.liberada) : Math.min(agora, t + ABERTA_MAX_MS)];
}

/**
 * Casa cada parada do GPS com a notificação da mesma viatura no mesmo
 * hospital cujo intervalo se sobrepõe (com folga). Cada notificação casa com
 * uma parada só — a de maior sobreposição.
 */
export function cruzar<P extends { id: number; chave: string; hospitalId: string; entrada: string; fim: string }>(
    paradas: readonly P[],
    acolhimentos: readonly Acolhimento[],
    agora: number,
): { casadas: Map<number, Acolhimento>; soltas: Acolhimento[] } {
    const casadas = new Map<number, Acolhimento>();
    const usadas = new Set<string>();
    const candidatos: { p: P; a: Acolhimento; sobra: number }[] = [];
    for (const a of acolhimentos) {
        const j = janela(a, agora);
        if (!j || !a.hospital) continue;
        for (const p of paradas) {
            if (p.chave !== a.unidade || p.hospitalId !== a.hospital) continue;
            const ini = Math.max(Date.parse(p.entrada) - FOLGA_MS, j[0]);
            const fim = Math.min(Date.parse(p.fim) + FOLGA_MS, j[1]);
            if (fim > ini) candidatos.push({ p, a, sobra: fim - ini });
        }
    }
    candidatos.sort((x, y) => y.sobra - x.sobra);
    for (const c of candidatos) {
        if (casadas.has(c.p.id) || usadas.has(c.a.id)) continue;
        casadas.set(c.p.id, c.a);
        usadas.add(c.a.id);
    }
    return { casadas, soltas: acolhimentos.filter((a) => !usadas.has(a.id) && janela(a, agora)) };
}
