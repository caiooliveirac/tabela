// ═══════════════════════════════════════════════════════════════
// Fases da ocorrência pelo GPS: o que a viatura FEZ, não o que a equipe
// apertou. Em 3 dias (nov/2026), de 867 ocorrências, a equipe registrou
// "saída da base" em 0%, "chegada ao local" em 40% e "saída do local" em 2%;
// 9% das chegadas foram apertadas no mesmo minuto da "visualizada".
//
//   vinculação ─ partida ─ chegada ao local ─ saída do local ─ unidade ─ retorno ─ base
//      (status)    (GPS)        (GPS)              (GPS)        (cerca)    (GPS)   (GPS)
//
// - Partida: estava a até 150 m da própria base (ou numa parada de base, a
//   base dentro de hospital/UPA) e passou de 200 m; fora da base, quando
//   começou a andar (80 m do ponto da vinculação).
// - Local: parada de 5 min ou mais a até 80 m, fora de cerca e da base, entre
//   a partida e a unidade. Paradas a até 150 m uma da outra são a mesma (o
//   sinal falha e parte a parada). Qual é o local: a que contém a "chegada ao
//   local" que a equipe apertou (o botão diz qual, o GPS diz quando); sem o
//   botão, a primeira de 10 min ou mais (trânsito costuma ser menos; depois
//   do local ela pode parar longe numa unidade fora da nossa lista). As outras
//   ficam como paradas intermediárias — sem o ponto da ocorrência não dá para
//   dizer se foi trânsito ou procura do endereço.
// - Unidade: a primeira parada em hospital/UPA (cerca de 150 m) com 3 min ou
//   mais depois da partida (passar pela cerca dá ~2 min), ou de qualquer
//   duração se a equipe registrou "chegada ao hospital" nela. Sem parada de rua antes e com outra unidade
//   depois, a primeira foi o local (transferência: pegou na UPA).
// - Retorno: da saída da unidade (ou do local, sem unidade) até voltar à base.
//
// Sem o ponto da ocorrência, tudo é estimativa: a linha do tempo diz "pelo GPS".
// ═══════════════════════════════════════════════════════════════
import type { ParadaDetalhe, PosicaoDetalhe } from "./detalhe.js";
import { distanciaM, RAIO_M, RAIO_SAIDA_M } from "./regras.js";

/** Parada de rua: tanto tempo... */
export const PARADA_MIN = 5;
/** ...a até tanto do primeiro ponto. */
export const PARADA_RAIO_M = 80;
/** Paradas tão perto uma da outra são a mesma (falha de sinal no meio). */
export const JUNTAR_M = 150;
/** Parada em hospital/UPA mais curta que isto é passagem, não a unidade (sem o botão da equipe). */
export const UNIDADE_MIN = 3;
/** Sem o botão de chegada: a primeira parada de rua tão longa é o local. */
export const LOCAL_MIN = 10;

const MIN = 60_000;

export type FaseRastro = "antes" | "resposta" | "local" | "transporte" | "unidade" | "retorno" | "depois";

export interface ParadaRua {
    inicio: Date;
    fim: Date;
    lat: number;
    lng: number;
    minutos: number;
    /** Ainda parada lá (o último ponto é dela). */
    aberta: boolean;
    /** Transferência: o local foi dentro desta cerca (hospital/UPA). */
    hospitalId?: string;
}

export interface Tempo {
    minutos: number;
    /** Ainda correndo. */
    aberto: boolean;
}

export interface Fases {
    vinculacao: Date;
    /** Estava na base quando foi vinculada. */
    naBase: boolean;
    partida: Date | null;
    local: ParadaRua | null;
    intermediarias: ParadaRua[];
    unidade: { paradaId: number; hospitalId: string; entrada: Date; saida: Date | null } | null;
    chegadaBase: Date | null;
    tempos: {
        /** Vinculação → saída da base (só quem estava na base). */
        saida: Tempo | null;
        /** Vinculação → chegada ao local. */
        resposta: Tempo | null;
        noLocal: Tempo | null;
        /** Saída do local → chegada à unidade. */
        transporte: Tempo | null;
        naUnidade: Tempo | null;
        /** Saída da unidade (ou do local) → chegada à base. */
        retorno: Tempo | null;
    };
}

const fimDa = (p: ParadaDetalhe, agora: Date) => p.saida ?? (p.motivoFim === null ? agora : p.ultimaVez);
const dentro = (p: ParadaDetalhe, t: Date, agora: Date) => p.entrada.getTime() <= t.getTime() && t.getTime() <= fimDa(p, agora).getTime();
const minutos = (de: Date, ate: Date) => Math.max(0, Math.round((ate.getTime() - de.getTime()) / MIN));

/** Paradas de rua: pontos seguidos a até PARADA_RAIO_M do primeiro, por PARADA_MIN ou mais; as vizinhas se juntam. */
export function paradasDeRua(pts: readonly PosicaoDetalhe[], ultimoPonto: Date | null): ParadaRua[] {
    const brutas: ParadaRua[] = [];
    let i = 0;
    while (i < pts.length) {
        let j = i;
        while (j + 1 < pts.length && distanciaM(pts[i], pts[j + 1]) <= PARADA_RAIO_M) j++;
        if (pts[j].em.getTime() - pts[i].em.getTime() >= PARADA_MIN * MIN) {
            const grupo = pts.slice(i, j + 1);
            brutas.push({
                inicio: pts[i].em,
                fim: pts[j].em,
                lat: grupo.reduce((s, p) => s + p.lat, 0) / grupo.length,
                lng: grupo.reduce((s, p) => s + p.lng, 0) / grupo.length,
                minutos: minutos(pts[i].em, pts[j].em),
                aberta: false,
            });
            i = j + 1;
        } else i++;
    }
    const juntas: ParadaRua[] = [];
    for (const p of brutas) {
        const a = juntas.at(-1);
        if (a && distanciaM(a, p) <= JUNTAR_M) {
            a.fim = p.fim;
            a.minutos = minutos(a.inicio, a.fim);
        } else juntas.push({ ...p });
    }
    const u = juntas.at(-1);
    if (u && ultimoPonto && u.fim.getTime() === ultimoPonto.getTime()) u.aberta = true;
    return juntas;
}

export function fasesDaOcorrencia(e: {
    vinculacao: Date;
    /** Ocorrência ainda no mapa de equipes: o que falta está correndo. */
    ativa: boolean;
    posicoes: readonly PosicaoDetalhe[];
    paradas: readonly ParadaDetalhe[];
    /** Ponto da base da viatura (catalogo.ts), quando se sabe. */
    base: { lat: number; lng: number } | null;
    /** "CHEGADA AO LOCAL" apertada pela equipe nesta ocorrência: diz qual parada foi o local. */
    chegadaRegistrada?: Date | null;
    /** "CHEGADA AO HOSPITAL" apertada: a parada em que ela cai é a unidade, por curta que seja. */
    chegadaUnidadeRegistrada?: Date | null;
    agora: Date;
}): Fases {
    const { vinculacao, agora } = e;
    const pts = e.posicoes.filter((p) => p.em.getTime() >= vinculacao.getTime() - 10 * MIN).sort((a, b) => a.em.getTime() - b.em.getTime());
    const paradaBase = (t: Date) => e.paradas.some((p) => p.naBase && dentro(p, t, agora));
    const naBase = (p: PosicaoDetalhe, raio: number) => (e.base !== null && distanciaM(p, e.base) <= raio) || paradaBase(p.em);
    const emCerca = (t: Date) => e.paradas.some((p) => !p.naBase && dentro(p, t, agora));

    // Onde estava na vinculação: o último ponto até ela (ou o primeiro depois).
    const p0 = [...pts].reverse().find((p) => p.em.getTime() <= vinculacao.getTime()) ?? pts[0] ?? null;
    const estavaNaBase = p0 !== null && naBase(p0, RAIO_M);
    const depois = pts.filter((p) => p.em.getTime() > vinculacao.getTime());
    const saiu = p0 === null ? undefined : estavaNaBase ? depois.find((p) => !naBase(p, RAIO_SAIDA_M)) : depois.find((p) => distanciaM(p, p0) > PARADA_RAIO_M);
    const partida = saiu?.em ?? null;
    const desde = partida ?? vinculacao;

    // Unidade: hospital/UPA com 3+ min depois da partida, ou a do botão "chegada ao hospital".
    const regUnidade = e.chegadaUnidadeRegistrada?.getTime() ?? NaN;
    const doBotao = (p: ParadaDetalhe) =>
        p.entrada.getTime() - 5 * MIN <= regUnidade && regUnidade <= fimDa(p, agora).getTime() + 5 * MIN;
    const cercas = e.paradas
        .filter((p) => !p.naBase && p.entrada.getTime() > desde.getTime() - MIN &&
            (p.motivoFim === null || minutos(p.entrada, fimDa(p, agora)) >= UNIDADE_MIN || doBotao(p)))
        .sort((a, b) => a.entrada.getTime() - b.entrada.getTime());
    // Voltou à base sem passar por unidade (atendimento sem remoção).
    // (Voltar em menos de 10 min é arrancada falsa, não atendimento.)
    const voltaSemUnidade = partida
        ? depois.find((p) => p.em.getTime() - partida.getTime() >= 10 * MIN && naBase(p, RAIO_M) && (!cercas[0] || p.em < cercas[0].entrada))
        : undefined;
    let u: ParadaDetalhe | null = voltaSemUnidade ? null : (cercas[0] ?? null);

    // Paradas de rua entre a partida e a unidade (ou a volta à base, ou agora).
    const limite = u?.entrada ?? voltaSemUnidade?.em ?? null;
    const trecho = partida ? pts.filter((p) => p.em >= partida && (!limite || p.em < limite) && !emCerca(p.em) && !naBase(p, RAIO_M)) : [];
    const ultimo = pts.at(-1)?.em ?? null;
    let ruas = paradasDeRua(trecho, u || voltaSemUnidade ? null : ultimo);

    let local: ParadaRua | null = null;
    if (ruas.length) {
        const k = qualELocal(ruas, e.chegadaRegistrada ?? null);
        local = ruas[k];
        ruas = ruas.filter((_, i) => i !== k);
    } else if (u && cercas[1] && fimDa(u, agora) <= cercas[1].entrada && u.motivoFim === "saiu") {
        // Transferência: nenhuma parada de rua; pegou numa unidade e levou a outra.
        const dentroDela = pts.filter((p) => dentro(u!, p.em, agora));
        const c = dentroDela.length ? dentroDela : pts;
        local = {
            inicio: u.entrada, fim: fimDa(u, agora), minutos: minutos(u.entrada, fimDa(u, agora)), aberta: false, hospitalId: u.hospitalId,
            lat: c.reduce((s, p) => s + p.lat, 0) / Math.max(1, c.length), lng: c.reduce((s, p) => s + p.lng, 0) / Math.max(1, c.length),
        };
        u = cercas[1];
    }
    const unidade = u ? { paradaId: u.id, hospitalId: u.hospitalId, entrada: u.entrada, saida: u.motivoFim === "saiu" ? u.saida : null } : null;

    // Volta à base depois de tudo.
    const desdeRetorno = unidade?.saida ?? (unidade ? null : local && !local.aberta ? local.fim : null);
    const chegadaBase = desdeRetorno ? (depois.find((p) => p.em > desdeRetorno && naBase(p, RAIO_M))?.em ?? null) : null;

    const t = (de: Date | null, ate: Date | null, correndo: boolean): Tempo | null =>
        !de ? null : ate ? { minutos: minutos(de, ate), aberto: false } : correndo ? { minutos: minutos(de, agora), aberto: true } : null;
    const correndo = e.ativa;
    return {
        vinculacao,
        naBase: estavaNaBase,
        partida,
        local,
        intermediarias: ruas,
        unidade,
        chegadaBase,
        tempos: {
            saida: estavaNaBase ? t(vinculacao, partida, correndo) : null,
            resposta: local ? t(vinculacao, local.inicio, false) : !unidade && !voltaSemUnidade ? t(vinculacao, null, correndo) : null,
            noLocal: local ? t(local.inicio, local.aberta ? null : local.fim, true) : null,
            transporte: local && !local.aberta && unidade ? t(local.fim, unidade.entrada, false) : null,
            naUnidade: unidade ? t(unidade.entrada, unidade.saida, u!.motivoFim === null) : null,
            retorno: desdeRetorno ? t(desdeRetorno, chegadaBase, correndo) : null,
        },
    };
}

/** Índice da parada que foi o local (ver o cabeçalho). */
function qualELocal(ruas: readonly ParadaRua[], registrada: Date | null): number {
    if (registrada) {
        const r = registrada.getTime();
        const contem = ruas.findIndex((p) => p.inicio.getTime() - 2 * MIN <= r && r <= p.fim.getTime() + 2 * MIN);
        if (contem >= 0) return contem;
        // apertou depois de sair (ou antes de chegar): a mais próxima do botão
        return ruas.reduce((m, p, i) => (Math.abs(p.inicio.getTime() - r) < Math.abs(ruas[m].inicio.getTime() - r) ? i : m), 0);
    }
    const longa = ruas.findIndex((p) => p.minutos >= LOCAL_MIN);
    return longa >= 0 ? longa : ruas.reduce((m, p, i) => (p.minutos > ruas[m].minutos ? i : m), 0);
}

/** Em que fase estava num instante (cor do rastro). */
export function faseEm(f: Fases | null, t: Date): FaseRastro | null {
    if (!f) return null;
    const x = t.getTime();
    if (x < f.vinculacao.getTime()) return "antes";
    if (f.chegadaBase && x >= f.chegadaBase.getTime()) return "depois";
    const u = f.unidade;
    if (u && x >= u.entrada.getTime() && (!u.saida || x < u.saida.getTime())) return "unidade";
    if (u?.saida && x >= u.saida.getTime()) return "retorno";
    const l = f.local;
    if (l && x >= l.inicio.getTime() && (l.aberta || x <= l.fim.getTime())) return "local";
    if (l && x > l.fim.getTime()) return u ? "transporte" : "retorno";
    return "resposta";
}
