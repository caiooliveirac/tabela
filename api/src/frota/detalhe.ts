// ═══════════════════════════════════════════════════════════════
// Detalhe de uma viatura (modal da aba Frota): a ocorrência, a parada no
// hospital, o rastro do GPS e uma linha do tempo que junta o que a equipe
// registrou (status do mapa de equipes) com o que o GPS viu (entrou/saiu da
// cerca). Pura: o coletor lê o banco e chama (testada em detalhe.test.ts).
//
// A divergência que importa: o mapa de equipes segue em "CHEGADA AO HOSPITAL"
// mas o GPS já saiu da cerca. A viatura provavelmente está livre e ninguém
// registrou — `foraDaCerca` marca a hora em que saiu.
// ═══════════════════════════════════════════════════════════════
import { artigo, duracaoTexto, hhmm } from "./aviso.js";
import type { HospitalFrota } from "./hospitais.js";
import type { Ocorrencia } from "./ocorrencias.js";
import { ALERTA_MIN, distanciaLocal, hospitalNoRaio, RAIO_M, RAIO_SAIDA_M, RECENTE_MIN } from "./regras.js";

/** Fora da cerca com o status de hospital há tanto tempo: vira aviso (painel). */
export const FORA_CERCA_MIN = 15;
/** O rastro e a linha do tempo nunca voltam mais que isto. */
export const JANELA_MAX_H = 12;
/** Sem ocorrência: o rastro das últimas 3 h. */
export const JANELA_LIVRE_H = 3;
/** Chegada registrada há tanto, sem o GPS em hospital: o destino não confere. */
export const CHEGADA_SEM_GPS_MIN = 10;

const MIN = 60_000;
const NO_HOSPITAL = /CHEGADA AO HOSPITAL/i;
const minEntre = (de: Date, ate: Date) => Math.max(0, Math.floor((ate.getTime() - de.getTime()) / MIN));

/** A última parada (fora da base) que fechou porque a viatura saiu — guardada pelo coletor. */
export interface SaidaCerca {
    id: number;
    hospitalId: string;
    entrada: Date;
    saida: Date;
}

export interface ForaDaCerca {
    paradaId: number;
    hospitalId: string;
    hospitalNome: string;
    entrada: string;
    saiuEm: string;
    /** Minutos desde que saiu da cerca. */
    minutos: number;
    /** Quando a equipe registrou a chegada ao hospital. */
    statusEm: string | null;
}

/**
 * O mapa de equipes ainda diz "chegada ao hospital", mas a parada daquele
 * hospital fechou por saída depois do status e a viatura não está em
 * nenhum outro hospital ou UPA. Sem a hora do status, ninguém afirma nada.
 */
export function foraDaCerca(
    o: Ocorrencia | null | undefined,
    emOutroHospital: boolean,
    saida: SaidaCerca | undefined,
    locais: readonly HospitalFrota[],
    agora: Date,
): ForaDaCerca | null {
    if (!o?.statusEm || !NO_HOSPITAL.test(o.status ?? "") || emOutroHospital || !saida) return null;
    // A parada é a desta chegada: saiu depois do status (10 min de folga — o
    // status às vezes é apertado já na porta, depois do GPS entrar e sair).
    if (saida.saida.getTime() < Date.parse(o.statusEm) - 10 * MIN) return null;
    return {
        paradaId: saida.id,
        hospitalId: saida.hospitalId,
        hospitalNome: locais.find((h) => h.id === saida.hospitalId)?.nome ?? saida.hospitalId,
        entrada: saida.entrada.toISOString(),
        saiuEm: saida.saida.toISOString(),
        minutos: minEntre(saida.saida, agora),
        statusEm: o.statusEm,
    };
}

// ── Detalhe ──────────────────────────────────────────────────────

export interface ParadaDetalhe {
    id: number;
    hospitalId: string;
    entrada: Date;
    ultimaVez: Date;
    saida: Date | null;
    motivoFim: "saiu" | "sem-sinal" | "desativada" | null;
    alertaEm: Date | null;
    naBase: boolean;
}

export interface StatusDetalhe {
    status: string;
    em: Date;
}

export interface PosicaoDetalhe {
    em: Date;
    lat: number;
    lng: number;
}

/** O que o detalhe precisa saber da viatura agora (um pedaço de ViaturaFrota). */
export interface ViaturaAgora {
    chave: string;
    nome: string;
    posicao: { lat: number; lng: number; em: string; idadeMin: number } | null;
    naBase: boolean;
    noHospital: { id: number | null; hospitalId: string; entrada: string; minutos: number; alerta: boolean; naBase: boolean } | null;
    foraDaCerca: ForaDaCerca | null;
}

export type EstadoLocalizacao =
    | "na-cerca"
    | "fora-da-cerca"
    | "sem-sinal"
    | "na-base"
    | "saiu"
    | "a-caminho"
    | "livre"
    | "sem-posicao";

export type Tom = "neutro" | "info" | "ok" | "atencao" | "critico";

export interface EventoLinha {
    em: string;
    tipo: "abertura" | "status" | "entrou" | "alerta" | "saiu" | "sem-sinal" | "desativada" | "posicao";
    titulo: string;
    detalhe: string | null;
    tom: Tom;
}

export interface PontoRastro {
    em: string;
    lat: number;
    lng: number;
    /** Hospital ou UPA em cujo raio (150 m) o ponto está; `null` = na rua. */
    local: string | null;
}

export interface DetalheMontado {
    ocorrencia: (Ocorrencia & { ativa: boolean }) | null;
    /** Hospital da parada atual ou da última do caso. */
    destino: {
        id: string;
        nome: string;
        tipo: "hospital" | "upa";
        lat: number;
        lng: number;
        raio: number;
        pontos: { lat: number; lng: number }[];
        /** "atual" = dentro agora; "ultima" = já saiu. */
        papel: "atual" | "ultima";
    } | null;
    permanencia: {
        id: number;
        entrada: string;
        saida: string | null;
        minutos: number;
        aberta: boolean;
        alerta: boolean;
        motivoFim: ParadaDetalhe["motivoFim"];
    } | null;
    localizacao: {
        estado: EstadoLocalizacao;
        titulo: string;
        /** Da última posição ao destino (ponto mais perto do local). */
        distanciaM: number | null;
        saiuEm: string | null;
        minutosFora: number | null;
    };
    aviso: { nivel: "critico" | "atencao"; titulo: string; texto: string; mensagem: string | null } | null;
    linha: EventoLinha[];
    rastro: PontoRastro[];
    janela: { desde: string; ate: string };
    limites: { raioM: number; raioSaidaM: number; alertaMin: number; foraCercaMin: number };
}

/**
 * Desde quando olhar: abertura da ocorrência (ou o primeiro status), 10 min
 * antes; sem ocorrência, as últimas 3 h. A parada aberta sempre entra; nunca
 * mais que 12 h.
 */
export function inicioJanela(
    ocorrencia: Pick<Ocorrencia, "abertura"> | null,
    status: readonly StatusDetalhe[],
    entradaAberta: Date | null,
    agora: Date,
): Date {
    const marcos = [
        ocorrencia?.abertura ? Date.parse(ocorrencia.abertura) : NaN,
        status.length ? Math.min(...status.map((s) => s.em.getTime())) : NaN,
    ].filter((x) => !Number.isNaN(x));
    let desde = marcos.length ? Math.min(...marcos) - 10 * MIN : agora.getTime() - JANELA_LIVRE_H * 3_600_000;
    if (entradaAberta) desde = Math.min(desde, entradaAberta.getTime());
    return new Date(Math.max(desde, agora.getTime() - JANELA_MAX_H * 3_600_000));
}

/** "CHEGADA AO HOSPITAL" → "Chegada ao hospital (registrada)". O que a equipe aperta no app ou o rádio lança. */
const TITULO_STATUS: Record<string, string> = {
    "DESIGNADA": "Unidade designada",
    "RECEBIDA NO APLICATIVO": "Recebida no aplicativo",
    "VISUALIZADA NO APLICATIVO": "Visualizada no aplicativo",
    "SAÍDA DA BASE": "Saída da base",
    "CHEGADA AO LOCAL": "Chegada ao local",
    "SAÍDA DO LOCAL": "Saída do local",
    "CHEGADA AO HOSPITAL": "Chegada ao hospital (registrada)",
    "SAÍDA DO HOSPITAL": "Saída do hospital (registrada)",
    "DISPONÍVEL / RETORNO À BASE": "Disponível / retorno à base",
};

const frase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

export function montarDetalhe(e: {
    viatura: ViaturaAgora;
    ocorrencia: (Ocorrencia & { ativa: boolean }) | null;
    status: readonly StatusDetalhe[];
    paradas: readonly ParadaDetalhe[];
    posicoes: readonly PosicaoDetalhe[];
    locais: readonly HospitalFrota[];
    desde: Date;
    agora: Date;
}): DetalheMontado {
    const { viatura: v, ocorrencia: oc, agora } = e;
    const local = (id: string) => e.locais.find((h) => h.id === id);
    const nomeLocal = (id: string) => local(id)?.nome ?? id;
    const paradas = [...e.paradas].sort((a, b) => a.entrada.getTime() - b.entrada.getTime());
    const status = [...e.status].sort((a, b) => a.em.getTime() - b.em.getTime());

    // ── Destino: a parada aberta fora da base; senão, a última do caso ──
    const fora = paradas.filter((p) => !p.naBase);
    const aberta = v.noHospital && !v.noHospital.naBase ? fora.find((p) => p.id === v.noHospital!.id) ?? null : null;
    const doCaso = v.foraDaCerca
        ? fora.find((p) => p.id === v.foraDaCerca!.paradaId) ?? null
        : null;
    const parada = aberta ?? doCaso ?? fora.at(-1) ?? null;
    const h = parada ? local(parada.hospitalId) : undefined;
    const destino = parada && h
        ? {
            id: h.id, nome: h.nome, tipo: h.tipo, lat: h.lat, lng: h.lng, raio: h.raio ?? RAIO_M,
            pontos: [...(h.portas ?? []), ...(h.pontos ?? [])].map((p) => ({ lat: p.lat, lng: p.lng })),
            papel: (parada === aberta ? "atual" : "ultima") as "atual" | "ultima",
        }
        : null;

    const permanencia = parada
        ? (() => {
            const ab = parada.motivoFim === null;
            const fim = ab ? agora : (parada.saida ?? parada.ultimaVez);
            return {
                id: parada.id,
                entrada: parada.entrada.toISOString(),
                saida: parada.saida?.toISOString() ?? null,
                minutos: ab && v.noHospital ? v.noHospital.minutos : minEntre(parada.entrada, fim),
                aberta: ab,
                alerta: ab ? Boolean(v.noHospital?.alerta) : parada.alertaEm !== null,
                motivoFim: parada.motivoFim,
            };
        })()
        : null;

    // ── Localização agora ──
    const distanciaM = v.posicao && h ? Math.round(distanciaLocal(v.posicao, h)) : null;
    const chegadaReg = [...status].reverse().find((s) => NO_HOSPITAL.test(s.status)) ?? null;
    const ultimoStatusHospital = oc?.ativa && NO_HOSPITAL.test(oc.status ?? "");
    let estado: EstadoLocalizacao;
    let titulo: string;
    if (!v.posicao) {
        estado = "sem-posicao";
        titulo = "Sem posição do GPS";
    } else if (aberta && h) {
        estado = "na-cerca";
        titulo = `Dentro da cerca d${artigo(h.nome)} ${h.nome}`;
    } else if (v.foraDaCerca) {
        estado = "fora-da-cerca";
        titulo = `Fora da cerca desde ${hhmm(new Date(v.foraDaCerca.saiuEm))}`;
    } else if (v.posicao.idadeMin > RECENTE_MIN) {
        estado = "sem-sinal";
        titulo = `Sem posição nova há ${duracaoTexto(v.posicao.idadeMin)}`;
    } else if (v.naBase || v.noHospital?.naBase) {
        estado = "na-base";
        titulo = "Na própria base";
    } else if (parada?.saida && h) {
        estado = "saiu";
        titulo = `Saiu d${artigo(h.nome)} ${h.nome} às ${hhmm(parada.saida)}`;
    } else if (oc?.ativa) {
        estado = "a-caminho";
        titulo = "Em deslocamento";
    } else {
        estado = "livre";
        titulo = "Em circulação";
    }

    // ── Aviso (a faixa vermelha/âmbar com a ação) ──
    let aviso: DetalheMontado["aviso"] = null;
    const caso = oc?.protocolo ? ` (ocorrência ${oc.protocolo})` : "";
    if (v.foraDaCerca) {
        const f = v.foraDaCerca;
        const onde = `d${artigo(f.hospitalNome)} ${f.hospitalNome}`;
        aviso = {
            nivel: f.minutos >= FORA_CERCA_MIN ? "critico" : "atencao",
            titulo: `Saiu da cerca às ${hhmm(new Date(f.saiuEm))} e o status segue "Chegada ao hospital"`,
            texto:
                `Há ${duracaoTexto(f.minutos)} a viatura está fora ${onde}` +
                (distanciaM !== null ? `, a ${km(distanciaM)} de lá` : "") +
                ". Provável liberação sem registro: confirme com a equipe e atualize o status na regulação.",
            mensagem:
                `${v.nome} saiu ${onde} às ${hhmm(new Date(f.saiuEm))} e o mapa de equipes ainda mostra ` +
                `"Chegada ao hospital"${caso}. Favor confirmar a liberação e atualizar o status.`,
        };
    } else if (aberta && permanencia?.alerta && h) {
        aviso = {
            nivel: "critico",
            titulo: `Parada de ${ALERTA_MIN} min ou mais`,
            texto: `N${artigo(h.nome)} ${h.nome} desde ${hhmm(aberta.entrada)} (${duracaoTexto(permanencia.minutos)})${caso}. Maca possivelmente retida.`,
            mensagem: null,
        };
    } else if (
        // Base dentro de UPA/hospital (Vale dos Barris, Cajazeiras) também é chegada: conta toda parada.
        ultimoStatusHospital && chegadaReg && !v.noHospital &&
        minEntre(chegadaReg.em, agora) >= CHEGADA_SEM_GPS_MIN &&
        !paradas.some((p) => (p.saida ?? agora).getTime() >= chegadaReg.em.getTime() - 30 * MIN)
    ) {
        aviso = {
            nivel: "atencao",
            titulo: `Chegada ao hospital registrada às ${hhmm(chegadaReg.em)}, mas o GPS não passou por hospital ou UPA`,
            texto: "O destino pode estar fora da lista da frota, ou a posição está errada. Confira com a equipe.",
            mensagem: null,
        };
    } else if (estado === "sem-sinal") {
        aviso = {
            nivel: "atencao",
            titulo: titulo,
            texto: "A localização não está confirmada: o tablet pode estar desligado ou sem internet.",
            mensagem: null,
        };
    }

    // ── Linha do tempo: status da equipe + o que o GPS viu ──
    const linha: EventoLinha[] = [];
    if (oc?.abertura && Date.parse(oc.abertura) >= e.desde.getTime()) {
        linha.push({
            em: oc.abertura,
            tipo: "abertura",
            titulo: "Abertura da ocorrência",
            detalhe: [oc.protocolo && `#${oc.protocolo}`, oc.risco && `risco ${oc.risco.toLowerCase()}`].filter(Boolean).join(" · ") || null,
            tom: "neutro",
        });
    }
    for (const s of status) {
        const st = s.status.toUpperCase();
        linha.push({
            em: s.em.toISOString(),
            tipo: "status",
            titulo: TITULO_STATUS[st] ?? frase(s.status),
            detalhe: "Registrado no mapa de equipes",
            tom: /DISPON/.test(st) ? "ok" : NO_HOSPITAL.test(st) ? "info" : "neutro",
        });
    }
    for (const p of paradas) {
        const nome = nomeLocal(p.hospitalId);
        const de = `d${artigo(nome)} ${nome}`;
        if (p.entrada.getTime() >= e.desde.getTime()) {
            linha.push({
                em: p.entrada.toISOString(),
                tipo: "entrou",
                titulo: p.naBase ? `Chegou à base (junto ${de})` : `Entrou na cerca ${de}`,
                detalhe: p.naBase ? null : `GPS a até ${local(p.hospitalId)?.raio ?? RAIO_M} m`,
                tom: p.naBase ? "neutro" : "info",
            });
        }
        if (p.alertaEm && !p.naBase) {
            linha.push({
                em: p.alertaEm.toISOString(),
                tipo: "alerta",
                titulo: `Passou de ${ALERTA_MIN} min n${artigo(nome)} ${nome}`,
                detalhe: "Aviso de retenção no grupo da frota",
                tom: "critico",
            });
        }
        if (p.motivoFim === "saiu" && p.saida) {
            const divergente = v.foraDaCerca?.paradaId === p.id;
            linha.push({
                em: p.saida.toISOString(),
                tipo: "saiu",
                titulo: p.naBase ? "Saiu da base" : `Saiu da cerca ${de}`,
                detalhe: p.naBase
                    ? null
                    : `${duracaoTexto(minEntre(p.entrada, p.saida))} lá dentro` +
                      (divergente ? ` · o status seguiu "Chegada ao hospital"` : ""),
                tom: divergente ? "critico" : "neutro",
            });
        } else if (p.motivoFim === "sem-sinal") {
            linha.push({
                em: p.ultimaVez.toISOString(),
                tipo: "sem-sinal",
                titulo: `Sem sinal ${de}`,
                detalhe: "Última posição confirmada lá; não se sabe quando saiu",
                tom: "atencao",
            });
        } else if (p.motivoFim === "desativada") {
            linha.push({
                em: (p.saida ?? p.ultimaVez).toISOString(),
                tipo: "desativada",
                titulo: "Viatura desativada no painel",
                detalhe: `A parada ${de} foi encerrada`,
                tom: "neutro",
            });
        }
    }
    if (v.posicao) {
        linha.push({
            em: v.posicao.em,
            tipo: "posicao",
            titulo: "Última posição GPS",
            detalhe:
                `há ${duracaoTexto(v.posicao.idadeMin)}` +
                (estado === "na-cerca"
                    ? " · dentro da cerca"
                    : distanciaM !== null && destino
                      ? ` · a ${km(distanciaM)} d${artigo(destino.nome)} ${destino.nome}`
                      : ""),
            tom: estado === "fora-da-cerca" ? "critico" : estado === "sem-sinal" ? "atencao" : "neutro",
        });
    }
    linha.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));

    // ── Rastro ──
    const rastro = e.posicoes
        .filter((p) => p.em.getTime() >= e.desde.getTime())
        .sort((a, b) => a.em.getTime() - b.em.getTime())
        .map((p) => ({ em: p.em.toISOString(), lat: p.lat, lng: p.lng, local: hospitalNoRaio(p, e.locais)?.id ?? null }));

    return {
        ocorrencia: oc,
        destino,
        permanencia,
        localizacao: {
            estado,
            titulo,
            distanciaM,
            saiuEm: v.foraDaCerca?.saiuEm ?? (estado === "saiu" ? parada?.saida?.toISOString() ?? null : null),
            minutosFora: v.foraDaCerca?.minutos ?? null,
        },
        aviso,
        linha,
        rastro,
        janela: { desde: e.desde.toISOString(), ate: agora.toISOString() },
        limites: { raioM: RAIO_M, raioSaidaM: RAIO_SAIDA_M, alertaMin: ALERTA_MIN, foraCercaMin: FORA_CERCA_MIN },
    };
}
