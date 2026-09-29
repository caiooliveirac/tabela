// ═══════════════════════════════════════════════════════════════
// Cliente do SAMU+ (IMTECH). Duas fontes:
//   • API com token — `GET /localizacoes/ultimas-posicoes`: a última posição
//     de cada EQUIPE. É o contrato. Não diz qual viatura é a equipe.
//   • página pública `status-unidades.php` — traz o vínculo unidade↔equipe
//     (mais bateria, sinal e velocidade) num objeto `devices` embutido no
//     HTML. Não é contrato: se a IMTECH fechar a página, fica valendo o
//     último vínculo salvo. A pedir a eles: `id_unidade` na API.
// ═══════════════════════════════════════════════════════════════

const API_URL = (process.env.SAMUMAIS_API_URL || "https://apiconecta.samumais.com.br/api/web").replace(/\/$/, "");
const STATUS_URL = process.env.SAMUMAIS_STATUS_URL || "https://apiconecta.samumais.com.br/status-unidades.php";

export interface PosicaoSamu {
    idEquipe: number;
    dataEvento: string;
    lat: number | null;
    lng: number | null;
}

export interface DispositivoSamu {
    unidadeSamu: number;
    equipe: number | null;
    nome: string;
    /** Bateria e conexão do último evento ONLINE/OFFLINE — pode ter horas. */
    bateria: number | null;
    sinal: number | null;
    velocidade: number | null;
    // Opcionais: o vínculo salvo antes de 30/09/2026 em frota_estado não tem.
    /** `online`, `unstable`, `offline`, `disabled` (situação do app no SAMU+). */
    status?: string | null;
    /** `Dados Móveis`, `Wi-Fi`, `none` (caiu sem internet). */
    conexao?: string | null;
    /** Quando a bateria foi lida (ISO). */
    bateriaEm?: string | null;
    /** Leitura anterior com valor diferente: maior = descarregando; menor = carregando. */
    bateriaAntes?: number | null;
    /** Último evento do app: ONLINE ou OFFLINE, e quando (ISO). */
    evento?: { tipo: string; em: string } | null;
}

function numero(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

export function lerPosicoes(corpo: unknown): PosicaoSamu[] {
    if (!Array.isArray(corpo)) throw new Error("ultimas-posicoes: resposta não é lista");
    const saida: PosicaoSamu[] = [];
    for (const r of corpo as Record<string, unknown>[]) {
        const idEquipe = numero(r.id_equipe);
        if (idEquipe === null || typeof r.data_evento !== "string") continue;
        saida.push({ idEquipe, dataEvento: r.data_evento, lat: numero(r.latitude), lng: numero(r.longitude) });
    }
    return saida;
}

export async function buscarPosicoes(token: string): Promise<PosicaoSamu[]> {
    const res = await fetch(`${API_URL}/localizacoes/ultimas-posicoes`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`ultimas-posicoes: HTTP ${res.status}`);
    return lerPosicoes(await res.json());
}

/** Recorta o literal `{...}` que começa em `inicio`, respeitando strings. */
function recortarObjeto(texto: string, inicio: number): string {
    let nivel = 0;
    let emString = false;
    for (let i = inicio; i < texto.length; i++) {
        const c = texto[i];
        if (emString) {
            if (c === "\\") i++;
            else if (c === '"') emString = false;
        } else if (c === '"') emString = true;
        else if (c === "{") nivel++;
        else if (c === "}" && --nivel === 0) return texto.slice(inicio, i + 1);
    }
    throw new Error("status-unidades: objeto devices sem fim");
}

export function lerDispositivos(html: string): DispositivoSamu[] {
    const m = /\bdevices\s*=\s*\{/.exec(html);
    if (!m) throw new Error("status-unidades: objeto devices não encontrado");
    const devices = JSON.parse(recortarObjeto(html, m.index + m[0].length - 1)) as Record<string, Record<string, unknown>>;
    const saida: DispositivoSamu[] = [];
    for (const d of Object.values(devices)) {
        const unidadeSamu = numero(d.unitId);
        const nome = typeof d.unitName === "string" ? d.unitName.trim() : "";
        if (unidadeSamu === null || !nome) continue;
        // Eventos ONLINE/OFFLINE ("Auditoria"), do mais novo ao mais velho.
        const eventos = (Array.isArray(d.history) ? (d.history as Record<string, unknown>[]) : [])
            .filter((e) => e.source === "Auditoria" && numero(e.timestamp) !== null)
            .sort((a, b) => numero(b.timestamp)! - numero(a.timestamp)!);
        const leituras = eventos.filter((e) => numero(e.battery) !== null);
        const bateria = numero(d.battery);
        const anterior = leituras.find((e) => numero(e.battery) !== bateria);
        const iso = (e: Record<string, unknown> | undefined) => (e ? new Date(numero(e.timestamp)! * 1000).toISOString() : null);
        saida.push({
            unidadeSamu,
            equipe: numero(d.teamId),
            nome,
            bateria,
            sinal: numero(d.signal),
            velocidade: numero(d.speed),
            status: typeof d.status === "string" ? d.status : null,
            conexao: typeof d.connection === "string" && d.connection ? d.connection : null,
            bateriaEm: bateria !== null ? iso(leituras[0]) : null,
            bateriaAntes: anterior ? numero(anterior.battery) : null,
            evento: eventos[0] ? { tipo: String(eventos[0].event), em: iso(eventos[0])! } : null,
        });
    }
    return saida;
}

export async function buscarDispositivos(): Promise<DispositivoSamu[]> {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`status-unidades: HTTP ${res.status}`);
    return lerDispositivos(await res.text());
}
