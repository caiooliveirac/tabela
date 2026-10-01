// ═══════════════════════════════════════════════════════════════
// Quem está em cada USA agora, pelo Plantões (repo plantoes): a rota de
// serviço que o Quadro Informativo já lê. `medico` é o nome curto de quem
// registrou chegada na base ("Fulano + Beltrano" em dupla).
// Token: ESCALA_SSO_TOKEN do plantoes, aqui PLANTOES_TOKEN. Sem token: sem nome.
// ═══════════════════════════════════════════════════════════════

const URL_BASE = (process.env.PLANTOES_URL || "https://plantoes.mnrs.com.br").replace(/\/$/, "");
const TOKEN = process.env.PLANTOES_TOKEN || "";
const MEMO_MS = 5 * 60_000;

let memo: { em: number; medicos: Map<string, string> } | null = null;

/** Nome(s) do médico por código da base (SM01, CB02…). Falha: mapa vazio — a cobrança sai sem nome. */
export async function medicosPorBase(): Promise<Map<string, string>> {
    if (!TOKEN) return new Map();
    if (memo && Date.now() - memo.em < MEMO_MS) return memo.medicos;
    const res = await fetch(`${URL_BASE}/api/servicos/quadro/plantao`, {
        headers: { "x-escala-token": TOKEN, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`plantoes: HTTP ${res.status}`);
    const corpo = (await res.json()) as { bases?: { codigo: string; ativa: boolean; medico: string | null }[] };
    const medicos = new Map<string, string>();
    for (const b of corpo.bases ?? []) if (b.ativa && b.medico?.trim()) medicos.set(b.codigo, b.medico.trim());
    memo = { em: Date.now(), medicos };
    return medicos;
}
