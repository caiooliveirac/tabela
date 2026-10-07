// ═══════════════════════════════════════════════════════════════
// Ocorrência de cada equipe, pelo mapa de equipes da regulação (dashmapa,
// só na rede da SMS): a viatura parada há 40 min está em ocorrência? Com
// qual médico regulador (MR)? Sem isso o aviso acusa sem saber.
//
// O magalu não alcança o mapa. Um coletor dentro da rede
// (scripts/mapa-equipes-coletor.mjs) lê o JSON, corta o dado do paciente na
// origem (nome, idade, sexo, telefone, solicitante) e manda só isto a POST /frota/ocorrencias (header x-mapa-token =
// MAPA_EQUIPES_TOKEN). O estado atual fica em memória; o histórico, em
// frota_ocorrencias (coletor.ts, `registrarOcorrencias`) — para os relatórios.
// ═══════════════════════════════════════════════════════════════
import { z } from "zod";
import type { ViaturaCatalogo } from "./catalogo.js";
import { vincular } from "./regras.js";

/** Sem envio do coletor há mais que isto, ninguém afirma nada sobre ocorrência. */
export const OCORRENCIA_VALE_MIN = 5;

const texto = (max: number) => z.string().trim().max(max).nullish();

export const esquemaOcorrencias = z.object({
    equipes: z
        .array(
            z.object({
                /** Nome no mapa: "SM 01 (A)", "CZ 53 (8h)". */
                equipe: z.string().trim().min(1).max(60),
                /** null = livre no mapa. Datas como o mapa manda: "07/10/2026 15:59:58" (hora da Bahia). */
                ocorrencia: z
                    .object({
                        protocolo: texto(30),
                        medico: texto(120),
                        status: texto(60),
                        statusEm: texto(30),
                        abertura: texto(30),
                        risco: texto(30),
                        regulacaoSecundaria: z.boolean().nullish(),
                        endereco: texto(300),
                        bairro: texto(100),
                        queixa: texto(500),
                        hma: texto(6000),
                    })
                    .nullable(),
            }),
        )
        .max(500),
});

export interface Ocorrencia {
    protocolo: string | null;
    /** Médico regulador da ocorrência. */
    medico: string | null;
    /** "CHEGADA AO HOSPITAL", "CHEGADA AO LOCAL"… como o mapa escreve. */
    status: string | null;
    statusEm: string | null;
    abertura: string | null;
    risco: string | null;
    regulacaoSecundaria: boolean;
    endereco: string | null;
    bairro: string | null;
    queixa: string | null;
    /** História clínica, texto livre. Só no painel (atrás do login), nunca no Telegram. */
    hma: string | null;
}

/** Equipe no mapa: em ocorrência, ou livre (`ocorrencia: null`). */
export interface SituacaoOcorrencia {
    ocorrencia: Ocorrencia | null;
}

/** "07/10/2026 15:59:58" (Bahia) → ISO. */
export function instanteMapa(s: string | null | undefined): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s ?? "");
    if (!m) return null;
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}-03:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Nome da equipe no mapa → código do catálogo, pela mesma regra do SAMU+ (`vincular`). Moto e evento ficam fora. */
export function porCodigo(
    envio: z.infer<typeof esquemaOcorrencias>,
    catalogo: readonly ViaturaCatalogo[],
): Map<string, SituacaoOcorrencia> {
    const vinculo = vincular(envio.equipes.map((e, i) => ({ unidadeSamu: i, nome: e.equipe })), catalogo);
    const saida = new Map<string, SituacaoOcorrencia>();
    envio.equipes.forEach((e, i) => {
        const v = vinculo.get(i);
        if (!v) return;
        const o = e.ocorrencia;
        saida.set(v.codigo, {
            ocorrencia: o && {
                protocolo: o.protocolo || null,
                medico: o.medico || null,
                status: o.status || null,
                statusEm: instanteMapa(o.statusEm),
                abertura: instanteMapa(o.abertura),
                risco: o.risco || null,
                regulacaoSecundaria: Boolean(o.regulacaoSecundaria),
                endereco: o.endereco || null,
                bairro: o.bairro || null,
                queixa: o.queixa || null,
                hma: o.hma || null,
            },
        });
    });
    return saida;
}

let recebido: { em: Date; equipes: number; porCodigo: Map<string, SituacaoOcorrencia> } | null = null;

export function receberOcorrencias(envio: z.infer<typeof esquemaOcorrencias>, catalogo: readonly ViaturaCatalogo[], agora = new Date()) {
    recebido = { em: agora, equipes: envio.equipes.length, porCodigo: porCodigo(envio, catalogo) };
    return { equipes: recebido.equipes, noCatalogo: recebido.porCodigo.size };
}

/** O último envio, por código — o que `registrarOcorrencias` grava. */
export function situacoesRecebidas(): ReadonlyMap<string, SituacaoOcorrencia> {
    return recebido?.porCodigo ?? new Map();
}

/** `null` = não sei (coletor parado, ou a viatura não está no mapa). */
export function ocorrenciaDe(chave: string, agora: Date): SituacaoOcorrencia | null {
    if (!recebido || agora.getTime() - recebido.em.getTime() > OCORRENCIA_VALE_MIN * 60_000) return null;
    return recebido.porCodigo.get(chave) ?? null;
}

export function diagnosticoOcorrencias(agora = Date.now()) {
    return {
        ligado: Boolean(process.env.MAPA_EQUIPES_TOKEN),
        recebidoEm: recebido?.em.toISOString() ?? null,
        recebidoHaMin: recebido ? Math.floor((agora - recebido.em.getTime()) / 60_000) : null,
        equipes: recebido?.equipes ?? 0,
        noCatalogo: recebido?.porCodigo.size ?? 0,
        emOcorrencia: recebido ? [...recebido.porCodigo.values()].filter((s) => s.ocorrencia).length : 0,
    };
}
