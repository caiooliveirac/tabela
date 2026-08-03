// ═══════════════════════════════════════════════════════════════
// Leitura do banco para os relatórios de regulação do bot da chefia.
// Só I/O — nenhuma formatação, nenhuma regra de texto. A agregação e o
// texto ficam em lib/destinosBot.ts, que é puro e testável sem banco.
//
// ⚠️ SELEÇÃO DE COLUNAS É REGRA DE PRIVACIDADE, NÃO ESTILO:
//   • `oc` (nº da ocorrência) e `medico` (médico que RECEBEU no hospital)
//     NÃO são lidos. `oc` + data + hospital reidentifica o paciente;
//     `medico` é terceiro de outra instituição, que não figura em
//     relatório de regulação. O que não entra no processo não vaza.
//   • O autor da regulação é `mr` (Médico Regulador), com fallback para
//     `criado_por`. NUNCA `medico` — usar `medico` imputaria a regulação
//     ao médico do hospital de destino, ou seja, acusaria a pessoa errada.
//   • `ativo = false` é exclusão/correção: fica de fora de tudo, igual ao
//     que o painel faz em services/score.ts.
// ═══════════════════════════════════════════════════════════════
import { and, asc, eq, gte, lt, or } from "drizzle-orm";
import { db } from "../index.js";
import { cases, intel } from "../db/schema.js";

/** Um paciente regulado para um destino. */
export interface EnvioRow {
    hospitalId: string;
    timestamp: Date;
    /** 'ACEITO' | 'ZERO' — nos dois casos o paciente foi regulado para lá. */
    situacao: string;
    /** Quadro clínico, texto livre digitado no painel. */
    caso: string | null;
    mr: string | null;
    criadoPor: string;
}

/** Alerta qualitativo lançado por um regulador sobre um hospital. */
export interface IntelRow {
    hospitalId: string;
    tipo: string;
    nota: string | null;
    autor: string;
    timestamp: Date;
}

/** Envios ativos no intervalo [start, end). */
export async function loadEnvios(start: Date, end: Date): Promise<EnvioRow[]> {
    return db
        .select({
            hospitalId: cases.hospitalId,
            timestamp: cases.timestamp,
            situacao: cases.situacao,
            caso: cases.caso,
            mr: cases.mr,
            criadoPor: cases.criadoPor,
        })
        .from(cases)
        .where(and(eq(cases.ativo, true), gte(cases.timestamp, start), lt(cases.timestamp, end)))
        .orderBy(asc(cases.timestamp));
}

/**
 * Ator usado pela expiração automática de intel (services/intel-policy.ts).
 * Intel expirada por TTL era VÁLIDA no momento em que foi lançada — num
 * relatório histórico ela conta. Só intel apagada por uma PESSOA é correção,
 * e essa fica de fora. Sem esta distinção o bloco de alertas viria sempre
 * vazio para qualquer período passado: `lotado` expira em 12h, então nenhum
 * registro de ontem continua com `ativo = true`.
 */
const INTEL_AUTO_REMOVAL_ACTOR = "sistema";

/** Intel do intervalo [start, end) — o que o sistema sabia de lotação na época. */
export async function loadIntel(start: Date, end: Date): Promise<IntelRow[]> {
    return db
        .select({
            hospitalId: intel.hospitalId,
            tipo: intel.tipo,
            nota: intel.nota,
            autor: intel.autor,
            timestamp: intel.timestamp,
        })
        .from(intel)
        .where(
            and(
                or(eq(intel.ativo, true), eq(intel.removidoPor, INTEL_AUTO_REMOVAL_ACTOR)),
                gte(intel.timestamp, start),
                lt(intel.timestamp, end)
            )
        )
        .orderBy(asc(intel.timestamp));
}

export interface DestinosData {
    envios: EnvioRow[];
    intel: IntelRow[];
}

export async function loadDestinosData(start: Date, end: Date): Promise<DestinosData> {
    const [envios, intelRows] = await Promise.all([loadEnvios(start, end), loadIntel(start, end)]);
    return { envios, intel: intelRows };
}
