// ═══════════════════════════════════════════════════════════════
// Análise de retenção (tela /tabela/retencao, só chefia e admin — o porteiro
// do mnrs-portal barra `/tabela/api/frota/retencao*` para os demais).
//
// Devolve CADA parada de 10 min ou mais fora da própria base, compacta, para
// a tela filtrar e agregar sem ida ao servidor (viatura, local, perfil,
// período). Função pura — o coletor busca as linhas, a rota
// `GET /frota/retencao?de=&ate=` devolve o que sai daqui.
//
// Mesma regra do histórico (historico.ts): sem base, 10 min ou mais, porta
// declarada puxa a parada para o dono. Só minuto e local: nada de paciente,
// protocolo, endereço, MR ou médico.
// ═══════════════════════════════════════════════════════════════
import { HOSPITALS } from "../services/score.js";
import type { HospitalFrota } from "./hospitais.js";
import { VISITA_MIN } from "./historico.js";
import { ALERTA_MIN, donoDaPorta } from "./regras.js";

const MIN = 60_000;

/** geral/psiq/infecto: `cat` do painel; privado: só na frota; upa: UPA e PA. */
export type PerfilLocal = "geral" | "psiq" | "infecto" | "privado" | "upa";

export function perfilDo(h: Pick<HospitalFrota, "id" | "tipo">): PerfilLocal {
    if (h.tipo === "upa") return "upa";
    const cat = HOSPITALS.find((x) => x.id === h.id)?.cat;
    return cat === "geral" || cat === "psiq" || cat === "infecto" ? cat : "privado";
}

/** 0 = em ocorrência no mapa de equipes; 1 = livre (sem paciente); 2 = sem dado do mapa. */
export type SituacaoParada = 0 | 1 | 2;
/** 0 = saiu; 1 = ainda no local; 2 = fechou sem saída vista (sem sinal, desativada) — duração mínima. */
export type FimParada = 0 | 1 | 2;
/** [entrada em minutos desde a época, minutos, índice do local, índice da viatura, situação, fim] */
export type ParadaRetencao = [number, number, number, number, SituacaoParada, FimParada];

export interface Retencao {
    de: string;
    ate: string;
    geradoEm: string;
    alertaMin: number;
    visitaMin: number;
    locais: { id: string; nome: string; tipo: "hospital" | "upa"; perfil: PerfilLocal }[];
    viaturas: { nome: string; tipo: string | null; base: string | null }[];
    paradas: ParadaRetencao[];
}

export interface ParadaRetencaoBruta {
    chave: string;
    hospitalId: string;
    entrada: Date;
    /** Saída, ou a última posição confirmada (aberta, sem sinal). */
    fim: Date;
    naBase: boolean;
    motivoFim: string | null;
    lat: number | null;
    lng: number | null;
    ocColetas: number;
    livreColetas: number;
}

export function montarRetencao(
    brutas: readonly ParadaRetencaoBruta[],
    locais: readonly HospitalFrota[],
    descrever: (chave: string) => { nome: string; tipo: string | null; base: string | null },
    de: Date,
    ate: Date,
    agora = new Date(),
): Retencao {
    const idxLocal = new Map(locais.map((h, i) => [h.id, i]));
    const viaturas: Retencao["viaturas"] = [];
    const idxViatura = new Map<string, number>();
    const paradas: ParadaRetencao[] = [];
    for (const p of brutas) {
        if (p.naBase || p.entrada < de || p.entrada >= ate) continue;
        const min = Math.floor((p.fim.getTime() - p.entrada.getTime()) / MIN);
        if (min < VISITA_MIN) continue;
        const dono = p.lat != null && p.lng != null ? donoDaPorta({ lat: p.lat, lng: p.lng }, locais) : null;
        const local = idxLocal.get(dono?.id ?? p.hospitalId);
        if (local === undefined) continue;
        let v = idxViatura.get(p.chave);
        if (v === undefined) {
            v = viaturas.length;
            idxViatura.set(p.chave, v);
            const d = descrever(p.chave);
            viaturas.push({ nome: d.nome, tipo: d.tipo, base: d.base });
        }
        const situacao: SituacaoParada = p.ocColetas > 0 ? 0 : p.livreColetas > 0 ? 1 : 2;
        const fim: FimParada = p.motivoFim == null ? 1 : p.motivoFim === "saiu" ? 0 : 2;
        paradas.push([Math.floor(p.entrada.getTime() / MIN), min, local, v, situacao, fim]);
    }
    paradas.sort((a, b) => a[0] - b[0]);
    return {
        de: de.toISOString(),
        ate: ate.toISOString(),
        geradoEm: agora.toISOString(),
        alertaMin: ALERTA_MIN,
        visitaMin: VISITA_MIN,
        locais: locais.map((h) => ({ id: h.id, nome: h.nome, tipo: h.tipo, perfil: perfilDo(h) })),
        viaturas,
        paradas,
    };
}
