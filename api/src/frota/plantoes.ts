// ═══════════════════════════════════════════════════════════════
// Quem está em cada USA agora, pelo Plantões (repo plantoes): a rota de
// serviço que o Quadro Informativo já lê. `medico` é o nome curto de quem
// registrou chegada na base ("Fulano + Beltrano" em dupla).
// Token: ESCALA_SSO_TOKEN do plantoes, aqui PLANTOES_TOKEN. Sem token: sem nome.
// ═══════════════════════════════════════════════════════════════

const URL_BASE = (process.env.PLANTOES_URL || "https://plantoes.mnrs.com.br").replace(/\/$/, "");
const TOKEN = process.env.PLANTOES_TOKEN || "";
const MEMO_MS = 5 * 60_000;

let memo: { em: number; medicos: Map<string, string>; desativadas: Set<string> } | null = null;

/** Nome(s) do médico por código da base (SM01, CB02…). Falha: mapa vazio — a cobrança sai sem nome. */
export async function medicosPorBase(): Promise<Map<string, string>> {
    return (await mesaAgora())?.medicos ?? new Map();
}

/**
 * A Mesa agora: médico por base e as bases que a chefia desativou neste turno
 * (`ativa: false`). `em` = quando foi lida. null sem token.
 */
export async function mesaAgora(): Promise<{ em: number; medicos: Map<string, string>; desativadas: Set<string> } | null> {
    if (!TOKEN) return null;
    if (memo && Date.now() - memo.em < MEMO_MS) return memo;
    const res = await fetch(`${URL_BASE}/api/servicos/quadro/plantao`, {
        headers: { "x-escala-token": TOKEN, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`plantoes: HTTP ${res.status}`);
    const corpo = (await res.json()) as { bases?: { codigo: string; ativa: boolean; medico: string | null }[] };
    const medicos = new Map<string, string>();
    for (const b of corpo.bases ?? []) if (b.ativa && b.medico?.trim()) medicos.set(b.codigo, b.medico.trim());
    memo = { em: Date.now(), medicos, desativadas: new Set((corpo.bases ?? []).filter((b) => !b.ativa).map((b) => b.codigo)) };
    return memo;
}
