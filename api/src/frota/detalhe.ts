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
import { artigo, duracaoTexto, hhmm, nomeProprio } from "./aviso.js";
import type { HospitalFrota } from "./hospitais.js";
import type { Ocorrencia, SituacaoOcorrencia } from "./ocorrencias.js";
import { faseEm, type FaseRastro, type Fases, type ParadaRua } from "./fases.js";
import { ALERTA_MIN, distanciaLocal, distanciaM as distancia, hospitalNoRaio, RAIO_M, RAIO_SAIDA_M, RECENTE_MIN } from "./regras.js";

/** Fora da cerca com o status de hospital há tanto tempo: vira aviso (painel). */
export const FORA_CERCA_MIN = 15;
/** Rastro guardado (frota_posicoes): é também o máximo que o seletor do modal volta. */
export const RASTRO_DIAS = 5;
/** Fora de ocorrência: o rastro da última hora. */
export const JANELA_LIVRE_MIN = 60;
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

/** Como terminou o aviso de "fora da cerca" no grupo. "encerrado" = sem sinal, desativada, outra parada: fecha sem resposta. */
export type FimForaDaCerca =
    | { tipo: "status"; status: string; em: string | null }
    | { tipo: "livre" }
    | { tipo: "voltou"; hospitalNome: string; em: string }
    | { tipo: "encerrado" };

/**
 * O aviso de "fora da cerca" da parada `paradaId` acabou? `null` = segue
 * aberto — inclusive com o mapa de equipes mudo, quando ninguém sabe.
 */
export function fimForaDaCerca(
    v: {
        situacao: string;
        foraDaCerca: ForaDaCerca | null;
        noHospital: { naBase: boolean; hospitalNome: string; entrada: string } | null;
        ocorrencia: SituacaoOcorrencia | null;
    } | undefined,
    paradaId: number,
): FimForaDaCerca | null {
    if (!v || v.situacao !== "mapa") return { tipo: "encerrado" };
    if (v.foraDaCerca?.paradaId === paradaId) return null;
    if (v.noHospital && !v.noHospital.naBase) return { tipo: "voltou", hospitalNome: v.noHospital.hospitalNome, em: v.noHospital.entrada };
    if (v.foraDaCerca) return { tipo: "encerrado" };
    if (!v.ocorrencia) return null;
    const o = v.ocorrencia.ocorrencia;
    if (!o) return { tipo: "livre" };
    return { tipo: "status", status: o.status ?? "status novo", em: o.statusEm };
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
    /** MR da ocorrência na hora do status (frota_ocorrencia_status.medico). */
    medico?: string | null;
}

/** Notificação do Acolhimentos casada com uma parada (coletor.ts, `resumo`). Só USA em hospital. */
export interface AcolhimentoDetalhe {
    chegada: string | null;
    passagem: string | null;
    liberada: string | null;
    minutos: number | null;
    maca: { inicio: string; fim: string | null } | null;
    motivos: string[];
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
    /** "fase": marco das fases pelo GPS (fases.ts) — partida, local, parada no caminho, volta à base. */
    tipo: "abertura" | "status" | "entrou" | "alerta" | "saiu" | "sem-sinal" | "desativada" | "acolhimento" | "posicao" | "fase";
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
    /** Fase da ocorrência naquele instante (cor do rastro); `null` = sem ocorrência. */
    fase: FaseRastro | null;
}

export interface ParadaRuaDetalhe {
    inicio: string;
    fim: string;
    lat: number;
    lng: number;
    minutos: number;
    aberta: boolean;
    /** Transferência: o local foi dentro desta unidade. */
    hospitalId: string | null;
}

/** Fases da ocorrência pelo GPS (fases.ts), prontas para o modal. */
export interface FasesDetalhe {
    vinculacao: string;
    naBase: boolean;
    partida: string | null;
    local: ParadaRuaDetalhe | null;
    intermediarias: ParadaRuaDetalhe[];
    unidade: { hospitalId: string; nome: string; entrada: string; saida: string | null } | null;
    chegadaBase: string | null;
    tempos: Fases["tempos"];
    /** O que a equipe apertou para cada marco (null = não apertou). */
    registrado: { saidaBase: string | null; chegadaLocal: string | null; saidaLocal: string | null; chegadaUnidade: string | null; saidaUnidade: string | null };
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
    /** MRs da ocorrência na ordem em que apareceram nos status. */
    medicos: string[];
    /** A notificação do Acolhimentos da parada do caso; `cobre` = USA em hospital do Acolhimentos. */
    acolhimento: {
        cobre: boolean;
        ligado: boolean;
        erro: string | null;
        notificacao: AcolhimentoDetalhe | null;
        /** USA 40+ min fora da base sem notificação (o mesmo critério da cobrança). */
        semNotificacao: boolean;
    };
    linha: EventoLinha[];
    rastro: PontoRastro[];
    fases: FasesDetalhe | null;
    janela: {
        desde: string;
        ate: string;
        /** O começo padrão: vinculação à ocorrência ou a última hora. */
        padrao: string;
        motivo: MotivoJanela;
        /** Quantas horas o seletor pediu (null = padrão) e o máximo que ele volta. */
        horas: number | null;
        maxHoras: number;
    };
    limites: { raioM: number; raioSaidaM: number; alertaMin: number; foraCercaMin: number };
}

export type MotivoJanela = "vinculacao" | "ultima-hora";

export interface Janela {
    desde: Date;
    padrao: Date;
    motivo: MotivoJanela;
    horas: number | null;
}

/**
 * Desde quando olhar o rastro e a linha do tempo. Padrão: em ocorrência, a
 * hora em que a viatura foi vinculada a ela (o primeiro status dela nesta
 * ocorrência); fora de ocorrência, a última hora. `horas` (seletor do modal)
 * volta mais, até RASTRO_DIAS — nunca menos que o padrão.
 *
 * O protocolo tem 4 dígitos e recomeça todo dia: a mesma viatura e o mesmo
 * número juntam status de dias diferentes. Status de antes da abertura (ou,
 * sem abertura, de mais de 24 h) é de outra ocorrência e não conta.
 */
export function janelaDoRastro(
    ocorrencia: (Pick<Ocorrencia, "abertura"> & { ativa: boolean }) | null,
    status: readonly StatusDetalhe[],
    agora: Date,
    horas: number | null = null,
): Janela {
    const minimo = agora.getTime() - RASTRO_DIAS * 24 * 3_600_000;
    const v = ocorrencia?.ativa ? vinculacaoDa(ocorrencia, status, agora) : null;
    const vinculo = v ? v.getTime() : NaN;
    const motivo: MotivoJanela = Number.isNaN(vinculo) ? "ultima-hora" : "vinculacao";
    const padrao = Math.max(minimo, motivo === "vinculacao" ? vinculo : agora.getTime() - JANELA_LIVRE_MIN * MIN);
    const pedido = horas && horas > 0 ? Math.max(minimo, agora.getTime() - horas * 3_600_000) : padrao;
    return { desde: new Date(Math.min(padrao, pedido)), padrao: new Date(padrao), motivo, horas: horas && horas > 0 ? horas : null };
}

/**
 * Quando a viatura foi vinculada à ocorrência: o primeiro status dela nesta
 * ocorrência. Status de antes da abertura (ou, sem abertura, de mais de 24 h)
 * é de outra com o mesmo protocolo de 4 dígitos.
 */
export function vinculacaoDa(ocorrencia: Pick<Ocorrencia, "abertura"> | null, status: readonly StatusDetalhe[], agora: Date): Date | null {
    if (!ocorrencia) return null;
    const abertura = ocorrencia.abertura ? Date.parse(ocorrencia.abertura) : NaN;
    const corte = Number.isNaN(abertura) ? agora.getTime() - 24 * 3_600_000 : abertura - 10 * MIN;
    const destas = status.map((s) => s.em.getTime()).filter((t) => t >= corte && t <= agora.getTime());
    return destas.length ? new Date(Math.min(...destas)) : null;
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
    janela: Janela;
    agora: Date;
    /** Notificações do Acolhimentos por id de parada; `cobre(hospitalId)` = USA e hospital do Acolhimentos. */
    acolhimentos?: { ligado: boolean; erro: string | null; porParada: ReadonlyMap<number, AcolhimentoDetalhe>; cobre: (hospitalId: string) => boolean };
    /** Fases pelo GPS da ocorrência (fases.ts, `fasesDaOcorrencia`). */
    fases?: Fases | null;
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
    // Ocorrência em curso: a abertura abre a linha mesmo antes da vinculação (dá o
    // tempo até designar). Encerrada, a abertura guardada pode ser de outro dia
    // (protocolo repetido): só dentro da janela.
    const desdeAbertura = oc?.ativa ? Math.min(e.janela.desde.getTime(), agora.getTime() - 24 * 3_600_000) : e.janela.desde.getTime();
    if (oc?.abertura && Date.parse(oc.abertura) >= desdeAbertura) {
        linha.push({
            em: oc.abertura,
            tipo: "abertura",
            titulo: "Abertura da ocorrência",
            detalhe: [oc.protocolo && `#${oc.protocolo}`, oc.risco && `risco ${oc.risco.toLowerCase()}`].filter(Boolean).join(" · ") || null,
            tom: "neutro",
        });
    }
    let mrAntes: string | null = null;
    for (const s of status) {
        const st = s.status.toUpperCase();
        const mr = s.medico?.trim() || null;
        const trocou = mr !== null && mr !== mrAntes;
        if (mr) mrAntes = mr;
        linha.push({
            em: s.em.toISOString(),
            tipo: "status",
            titulo: TITULO_STATUS[st] ?? frase(s.status),
            detalhe: `Registrado no mapa de equipes${trocou ? ` · MR ${nomeProprio(mr!)}` : ""}`,
            tom: /DISPON/.test(st) ? "ok" : NO_HOSPITAL.test(st) ? "info" : "neutro",
        });
    }
    for (const p of paradas) {
        const nome = nomeLocal(p.hospitalId);
        const de = `d${artigo(nome)} ${nome}`;
        if (p.entrada.getTime() >= e.janela.desde.getTime()) {
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
    // ── Marcos pelo GPS (fases.ts): o que a viatura fez, com o que a equipe apertou ao lado ──
    const f = e.fases ?? null;
    const reg = (re: RegExp) =>
        f ? status.find((x) => re.test(x.status.toUpperCase()) && x.em.getTime() >= f.vinculacao.getTime() - MIN)?.em ?? null : null;
    const registrado = f
        ? {
              saidaBase: reg(/SA[IÍ]DA DA BASE/), chegadaLocal: reg(/CHEGADA AO LOCAL/), saidaLocal: reg(/SA[IÍ]DA DO LOCAL/),
              chegadaUnidade: reg(NO_HOSPITAL), saidaUnidade: reg(/SA[IÍ]DA DO HOSPITAL/),
          }
        : null;
    const naJanela = (d: Date) => d.getTime() >= e.janela.desde.getTime();
    const perto = (tipo: EventoLinha["tipo"], d: Date) => linha.some((x) => x.tipo === tipo && Math.abs(Date.parse(x.em) - d.getTime()) <= 3 * MIN);
    const apertou = (gps: Date, r: Date | null) => {
        if (!r) return "";
        const m = Math.round((r.getTime() - gps.getTime()) / MIN);
        return ` · equipe registrou ${hhmm(r)} (${m === 0 ? "no mesmo minuto" : `${m > 0 ? "+" : "−"}${Math.abs(m)} min`})`;
    };
    if (f && registrado) {
        const ev = (em: Date, titulo: string, detalhe: string, tom: Tom = "neutro") => {
            if (naJanela(em)) linha.push({ em: em.toISOString(), tipo: "fase", titulo, detalhe, tom });
        };
        // base dentro de hospital/UPA já tem "Saiu da base"/"Chegou à base" pela parada
        if (f.partida && f.naBase && !perto("saiu", f.partida)) ev(f.partida, "Saiu da base", "pelo GPS" + apertou(f.partida, registrado.saidaBase));
        if (f.partida && !f.naBase) ev(f.partida, "Começou a andar", "pelo GPS · estava fora da base na vinculação");
        const l = f.local;
        if (l) {
            const onde = l.hospitalId ? ` (n${artigo(nomeLocal(l.hospitalId))} ${nomeLocal(l.hospitalId)})` : "";
            ev(l.inicio, `Chegou ao local${onde}`,
               `pelo GPS · ${l.aberta ? "parada há" : "parada de"} ${duracaoTexto(l.minutos)}` +
               (registrado.chegadaLocal ? apertou(l.inicio, registrado.chegadaLocal) : " · equipe não registrou a chegada"), "info");
            if (!l.aberta && !l.hospitalId) ev(l.fim, "Saiu do local", `pelo GPS · ${duracaoTexto(l.minutos)} no local` + apertou(l.fim, registrado.saidaLocal));
        }
        for (const p of f.intermediarias) {
            const antes = !l || p.inicio < l.inicio;
            const d = l ? distancia(p, l) : null;
            const procura = antes && d !== null && d <= 1000;
            ev(p.inicio,
               procura ? `Parada de ${duracaoTexto(p.minutos)} a ${km(d!)} do local` : `Parada de ${duracaoTexto(p.minutos)} ${antes ? "no caminho" : "depois do local"}`,
               procura ? "pelo GPS · antes de chegar ao local: procurando o endereço?" : "pelo GPS · fora do local",
               procura ? "atencao" : "neutro");
        }
        if (f.chegadaBase && !perto("entrou", f.chegadaBase)) ev(f.chegadaBase, "Chegou à base", "pelo GPS");
    }

    const ac = e.acolhimentos;
    for (const p of paradas) {
        const n = ac?.porParada.get(p.id);
        if (!n) continue;
        const nome = nomeLocal(p.hospitalId);
        const ev = (em: string | null, titulo: string, detalhe: string | null, tom: Tom) => {
            if (em) linha.push({ em, tipo: "acolhimento", titulo, detalhe, tom });
        };
        ev(n.chegada, `Chegada notificada no Acolhimentos`, nome, "info");
        ev(n.maca?.inicio ?? null, "Maca retida", "Notificado no Acolhimentos", "atencao");
        ev(n.maca?.fim ?? null, "Maca devolvida", "Notificado no Acolhimentos", "ok");
        ev(n.passagem, "Paciente passado ao hospital", "Notificado no Acolhimentos", "ok");
        ev(
            n.liberada,
            "Liberação notificada no Acolhimentos",
            [n.minutos != null && `${duracaoTexto(n.minutos)} no total`, n.motivos.length && `motivos: ${n.motivos.join(", ").toLowerCase()}`]
                .filter(Boolean).join(" · ") || null,
            "ok",
        );
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
    // Status e paradas de antes da janela (carregados para as fases) ficam fora; a abertura tem regra própria.
    for (let i = linha.length - 1; i >= 0; i--) {
        if (linha[i].tipo !== "abertura" && Date.parse(linha[i].em) < e.janela.desde.getTime()) linha.splice(i, 1);
    }
    linha.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));

    // ── Rastro ──
    const rastro = e.posicoes
        .filter((p) => p.em.getTime() >= e.janela.desde.getTime())
        .sort((a, b) => a.em.getTime() - b.em.getTime())
        .map((p) => ({ em: p.em.toISOString(), lat: p.lat, lng: p.lng, local: hospitalNoRaio(p, e.locais)?.id ?? null, fase: faseEm(f, p.em) }));
    const ruaDetalhe = (p: ParadaRua): ParadaRuaDetalhe => ({
        inicio: p.inicio.toISOString(), fim: p.fim.toISOString(), lat: p.lat, lng: p.lng, minutos: p.minutos, aberta: p.aberta, hospitalId: p.hospitalId ?? null,
    });

    const medicos: string[] = [];
    for (const m of [...status.map((x) => x.medico), oc?.medico]) {
        const n = m?.trim() ? nomeProprio(m.trim()) : null;
        if (n && !medicos.includes(n)) medicos.push(n);
    }
    const cobre = Boolean(parada && !parada.naBase && ac?.cobre(parada.hospitalId));
    const notificacao = parada ? ac?.porParada.get(parada.id) ?? null : null;

    return {
        ocorrencia: oc,
        destino,
        permanencia,
        medicos,
        acolhimento: {
            cobre,
            ligado: ac?.ligado ?? false,
            erro: ac?.erro ?? null,
            notificacao,
            semNotificacao: cobre && !notificacao && !ac?.erro && Boolean(ac?.ligado) && Boolean(permanencia?.alerta),
        },
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
        fases: f && registrado
            ? {
                  vinculacao: f.vinculacao.toISOString(),
                  naBase: f.naBase,
                  partida: f.partida?.toISOString() ?? null,
                  local: f.local ? ruaDetalhe(f.local) : null,
                  intermediarias: f.intermediarias.map(ruaDetalhe),
                  unidade: f.unidade
                      ? { hospitalId: f.unidade.hospitalId, nome: nomeLocal(f.unidade.hospitalId), entrada: f.unidade.entrada.toISOString(), saida: f.unidade.saida?.toISOString() ?? null }
                      : null,
                  chegadaBase: f.chegadaBase?.toISOString() ?? null,
                  tempos: f.tempos,
                  registrado: Object.fromEntries(Object.entries(registrado).map(([k, v]) => [k, v?.toISOString() ?? null])) as FasesDetalhe["registrado"],
              }
            : null,
        janela: {
            desde: e.janela.desde.toISOString(),
            ate: agora.toISOString(),
            padrao: e.janela.padrao.toISOString(),
            motivo: e.janela.motivo,
            horas: e.janela.horas,
            maxHoras: RASTRO_DIAS * 24,
        },
        limites: { raioM: RAIO_M, raioSaidaM: RAIO_SAIDA_M, alertaMin: ALERTA_MIN, foraCercaMin: FORA_CERCA_MIN },
    };
}
