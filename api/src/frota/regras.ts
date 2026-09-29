// ═══════════════════════════════════════════════════════════════
// Regras da frota — funções puras, sem rede nem banco (testadas em
// regras.test.ts). O coletor chama; a rota só serializa.
// ═══════════════════════════════════════════════════════════════
import type { ViaturaCatalogo } from "./catalogo.js";
import type { HospitalFrota, PontoAprendido } from "./hospitais.js";

/** Entra no hospital a 150 m do prédio. */
export const RAIO_M = 150;
/** Só sai a 200 m: o GPS oscila na borda e abriria/fecharia a toda leitura. */
export const RAIO_SAIDA_M = 200;
/**
 * Depois de chegar, a parada segue a viatura até 300 m do local — o
 * estacionamento pode ser longe da porta (Valéria, HGESF, 16º Centro).
 */
export const RAIO_BUSCA_M = 300;
/** GPS parado: posição a até 50 m da anterior. */
export const PARADO_M = 50;
/**
 * A chegada: nos primeiros 20 min a parada segue a viatura até o
 * estacionamento. Depois, só fica perto do local ou de onde ela parou —
 * lanchonete ou ocorrência a 250 m, depois de liberar, não vira retenção.
 */
export const JANELA_CHEGADA_MIN = 20;
/** Parada no hospital que vira alerta. */
export const ALERTA_MIN = 40;
/** Posição até 15 min: verde. Até 60 min: âmbar. Mais velha: fora do mapa. */
export const RECENTE_MIN = 15;
export const MAPA_MIN = 60;
/** Sem confirmar a posição há 1 h, a permanência fecha como "sem sinal". */
export const SEM_SINAL_FECHA_MIN = 60;

const MIN = 60_000;

/** `data_evento` do SAMU+ vem sem fuso; é hora de Salvador (UTC-3). */
export function instanteSamu(dataEvento: string): Date | null {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(dataEvento.trim());
    if (!m) return null;
    const d = new Date(`${m[1]}T${m[2]}-03:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

/** Distância ao ponto mais perto do local: o pino ou um estacionamento aprendido. */
export function distanciaLocal(p: { lat: number; lng: number }, h: HospitalFrota): number {
    let d = distanciaM(p, h);
    for (const q of h.pontos ?? []) d = Math.min(d, distanciaM(p, q));
    return d;
}

/** Local mais perto dentro do raio. Raios que se cruzam: vence o ponto mais perto. */
export function hospitalNoRaio(
    p: { lat: number; lng: number },
    hospitais: readonly HospitalFrota[],
    raio = RAIO_M,
): HospitalFrota | null {
    let melhor: HospitalFrota | null = null;
    let menor = Infinity;
    for (const h of hospitais) {
        const d = distanciaLocal(p, h);
        if (d <= raio && d < menor) {
            melhor = h;
            menor = d;
        }
    }
    return melhor;
}

// ── Vínculo: nome no SAMU+ → código do catálogo ────────────────
//
// O SAMU+ escreve "CB 02 (A)", "PB 60 [A]", "LFEX 01 (A)", "MT 07". O
// catálogo tem CB02, BR60, LFEX. O número da viatura é único no catálogo,
// mas o prefixo do SAMU+ às vezes é de outra base (viatura remanejada) e há
// unidades de evento com número repetido ("FV 02", Festival da Virada).
// Por isso duas passadas: primeiro o código exato; depois, só para quem
// sobrou, o número — e nunca para um código que já casou exato.

export interface VinculoCatalogo {
    codigo: string;
    /** O nome no SAMU+ tem prefixo de outra base (ex.: "PB 60" → BR60). */
    nomeDifere: boolean;
}

function lerNome(nome: string): { prefixo: string; numero: string | null } | null {
    const m = /^\s*([A-Za-z]{2,4})\s*-?\s*0*(\d+)?/.exec(nome);
    if (!m) return null;
    return { prefixo: m[1].toUpperCase(), numero: m[2] ? String(Number(m[2])) : null };
}

export function ehMoto(nome: string): boolean {
    return lerNome(nome)?.prefixo === "MT";
}

export function vincular(
    unidades: readonly { unidadeSamu: number; nome: string }[],
    catalogo: readonly ViaturaCatalogo[],
): Map<number, VinculoCatalogo> {
    const porCodigo = new Map(catalogo.map((c) => [c.codigo, c]));
    const porNumero = new Map<string, ViaturaCatalogo>();
    for (const c of catalogo) {
        const n = c.codigo.replace(/\D/g, "");
        if (n) porNumero.set(String(Number(n)), c);
    }
    const saida = new Map<number, VinculoCatalogo>();
    const tomados = new Set<string>();

    for (const u of unidades) {
        const l = lerNome(u.nome);
        if (!l) continue;
        const exato = l.numero
            ? porCodigo.get(l.prefixo + l.numero.padStart(2, "0")) ?? porCodigo.get(l.prefixo)
            : porCodigo.get(l.prefixo);
        if (exato && !tomados.has(exato.codigo)) {
            saida.set(u.unidadeSamu, { codigo: exato.codigo, nomeDifere: false });
            tomados.add(exato.codigo);
        }
    }
    for (const u of unidades) {
        if (saida.has(u.unidadeSamu)) continue;
        const l = lerNome(u.nome);
        if (!l?.numero || l.prefixo === "MT") continue;
        const c = porNumero.get(l.numero);
        if (c && !tomados.has(c.codigo)) {
            saida.set(u.unidadeSamu, { codigo: c.codigo, nomeDifere: true });
            tomados.add(c.codigo);
        }
    }
    return saida;
}

// ── Permanência no hospital ────────────────────────────────────

export interface Leitura {
    /** Código do catálogo, ou `samu:<unidade>` / `equipe:<id>` fora dele. */
    chave: string;
    em: Date;
    lat: number;
    lng: number;
    /** Ponto exato da base da viatura, quando se sabe. */
    base?: { lat: number; lng: number } | null;
}

/** Parada a 150 m da própria base é base, mesmo com hospital do lado. */
export function naBase(l: Pick<Leitura, "lat" | "lng" | "base">): boolean {
    return Boolean(l.base && distanciaM(l, l.base) <= RAIO_M);
}

export interface Permanencia {
    id?: number;
    chave: string;
    hospitalId: string;
    entrada: Date;
    ultimaVez: Date;
    alertaEm: Date | null;
    /**
     * Parada na própria base, que fica no hospital (Pau Miúdo ao lado do
     * HGESF/Mário Leal, Cajazeiras no Municipal). Aparece na tabela e na linha
     * do tempo com a hora de entrada, mas não conta para o alerta de 40 min.
     */
    naBase: boolean;
    /** Mensagem do aviso no Telegram, para editar e responder na saída. */
    avisoMsgId?: number | null;
    /** Chat da mensagem. null = grupo dos reguladores (avisos de antes do grupo da frota). */
    avisoChat?: string | null;
    /** Última posição confirmada: a parada segue a viatura num raio de 150 m. */
    lat?: number | null;
    lng?: number | null;
    /** Pulou para longe (ainda a até 300 m): a próxima posição decide. Só em memória. */
    fora?: { lat: number; lng: number; em: Date } | null;
    /** Posições paradas seguidas (a até 50 m uma da outra). Só em memória. */
    corrida?: PontoParado | null;
    /**
     * Onde o GPS ficou parado mais tempo, entre as paradas que começaram na
     * chegada (20 min): é daqui que se aprende o estacionamento.
     */
    estavel?: PontoParado | null;
}

interface PontoParado {
    lat: number;
    lng: number;
    /** Posições (uma a cada ~2 min). */
    n: number;
    /** Primeira posição parada ali (só em memória; o `estavel` do banco não tem). */
    desde?: Date;
}

const naChegada = (p: Pick<Permanencia, "entrada">, em: Date) =>
    em.getTime() - p.entrada.getTime() <= JANELA_CHEGADA_MIN * MIN;

export interface Fechamento {
    permanencia: Permanencia;
    /** null = perdeu o sinal lá dentro; não se sabe quando saiu. */
    saida: Date | null;
    motivo: "saiu" | "sem-sinal";
}

/**
 * Quanto tempo a viatura está no hospital. Com posição recente o relógio
 * corre até agora; sem confirmação há mais de 15 min, congela na última
 * posição dentro do raio — não se conta tempo que não se viu.
 */
export function duracaoMin(p: Pick<Permanencia, "entrada" | "ultimaVez">, agora: Date): number {
    const fresca = agora.getTime() - p.ultimaVez.getTime() <= RECENTE_MIN * MIN;
    const fim = fresca ? agora.getTime() : p.ultimaVez.getTime();
    return Math.max(0, Math.floor((fim - p.entrada.getTime()) / MIN));
}

/**
 * A parada aberta segue? Nunca troca de local: fica no mesmo, ou fecha.
 * - "fica": a até 200 m de um ponto do local; ou a até 150 m de onde a
 *   viatura parou na chegada (o GPS oscila); ou, na chegada (20 min) e sem
 *   passar de 300 m do local, a até 150 m da última posição (manobra);
 * - "fora": na chegada, pulou para longe, ainda a até 300 m — a próxima
 *   posição decide: parou ali (fica) ou seguiu (saiu, na hora do pulo);
 * - "saiu": passou de 300 m, pulou depois da chegada, ou entrou na própria base.
 */
export function seguir(
    p: Permanencia,
    l: Pick<Leitura, "lat" | "lng" | "em">,
    h: HospitalFrota | undefined,
    dBase: number,
): "fica" | "fora" | "saiu" {
    if (!h) return "saiu";
    const dLocal = distanciaLocal(l, h);
    // Parada de base: mesma histerese da base (150 m entra, 200 m sai).
    if (p.naBase) return dBase <= RAIO_SAIDA_M && dLocal <= RAIO_SAIDA_M ? "fica" : "saiu";
    if (dBase <= RAIO_M) return "saiu";
    if (dLocal <= RAIO_SAIDA_M) return "fica";
    const perto = (q: { lat: number; lng: number } | null | undefined) => q != null && distanciaM(l, q) <= RAIO_M;
    // O `estavel` só guarda parada da chegada; a corrida atual, só se começou nela.
    const corridaDaChegada = p.corrida && p.corrida.n >= 2 && p.corrida.desde && naChegada(p, p.corrida.desde);
    if ((corridaDaChegada && perto(p.corrida)) || perto(p.estavel)) return "fica";
    if (dLocal > RAIO_BUSCA_M || !naChegada(p, l.em)) return "saiu";
    if (perto(p.fora)) return "fica";
    if (p.lat != null && p.lng != null && perto({ lat: p.lat, lng: p.lng })) return "fica";
    return p.fora ? "saiu" : "fora";
}

/** Sequência de posições paradas e a mais longa da chegada (o `estavel`). */
function acompanhar(p: Permanencia, l: Pick<Leitura, "lat" | "lng" | "em">): Pick<Permanencia, "corrida" | "estavel"> {
    // Voltando de um pulo, a posição anterior é a do pulo.
    const c: PontoParado | null | undefined = p.fora ? { lat: p.fora.lat, lng: p.fora.lng, n: 1, desde: p.fora.em } : p.corrida;
    const corrida: PontoParado =
        c && distanciaM(l, c) <= PARADO_M
            ? { lat: c.lat + (l.lat - c.lat) / (c.n + 1), lng: c.lng + (l.lng - c.lng) / (c.n + 1), n: c.n + 1, desde: c.desde ?? l.em }
            : { lat: l.lat, lng: l.lng, n: 1, desde: l.em };
    const melhor = corrida.n >= 2 && corrida.n > (p.estavel?.n ?? 0) && naChegada(p, corrida.desde!);
    return { corrida, estavel: melhor ? corrida : (p.estavel ?? null) };
}

export function avancarPermanencias(
    abertas: ReadonlyMap<string, Permanencia>,
    leituras: readonly Leitura[],
    hospitais: readonly HospitalFrota[],
    agora: Date,
): {
    abertas: Map<string, Permanencia>;
    novas: Permanencia[];
    alteradas: Permanencia[];
    fechadas: Fechamento[];
} {
    const proximas = new Map(abertas);
    const novas: Permanencia[] = [];
    const alteradas: Permanencia[] = [];
    const fechadas: Fechamento[] = [];
    const porId = new Map(hospitais.map((h) => [h.id, h]));

    for (const l of leituras) {
        // Posição velha não abre nem confirma nada.
        if (agora.getTime() - l.em.getTime() > SEM_SINAL_FECHA_MIN * MIN) continue;
        const atual = proximas.get(l.chave);
        const dBase = l.base ? distanciaM(l, l.base) : Infinity;
        if (atual) {
            if (l.em.getTime() <= (atual.fora?.em ?? atual.ultimaVez).getTime()) continue;
            const s = seguir(atual, l, porId.get(atual.hospitalId), dBase);
            if (s === "fica") {
                const nova: Permanencia = {
                    ...atual,
                    ...acompanhar(atual, l),
                    ultimaVez: l.em,
                    lat: l.lat,
                    lng: l.lng,
                    fora: null,
                };
                if (!nova.naBase && !nova.alertaEm && duracaoMin(nova, agora) >= ALERTA_MIN) nova.alertaEm = agora;
                proximas.set(l.chave, nova);
                alteradas.push(nova);
                continue;
            }
            if (s === "fora") {
                proximas.set(l.chave, { ...atual, fora: { lat: l.lat, lng: l.lng, em: l.em } });
                continue;
            }
            // Base ↔ local também passa por aqui: fecha uma parada e abre a outra.
            proximas.delete(l.chave);
            fechadas.push({ permanencia: atual, saida: atual.fora?.em ?? l.em, motivo: "saiu" });
        }
        const h = hospitalNoRaio(l, hospitais);
        if (h) {
            const p: Permanencia = {
                chave: l.chave,
                hospitalId: h.id,
                entrada: l.em,
                ultimaVez: l.em,
                alertaEm: null,
                naBase: dBase <= RAIO_M,
                lat: l.lat,
                lng: l.lng,
                corrida: { lat: l.lat, lng: l.lng, n: 1, desde: l.em },
                estavel: null,
            };
            proximas.set(l.chave, p);
            novas.push(p);
        }
    }

    for (const [chave, p] of proximas) {
        if (agora.getTime() - p.ultimaVez.getTime() > SEM_SINAL_FECHA_MIN * MIN) {
            proximas.delete(chave);
            fechadas.push({ permanencia: p, saida: null, motivo: "sem-sinal" });
        }
    }
    return { abertas: proximas, novas, alteradas, fechadas };
}

// ── Estacionamentos aprendidos ─────────────────────────────────
//
// Cada parada guarda onde o GPS ficou parado mais tempo (`estavel`). Quando
// 3 viaturas diferentes, em 2 dias diferentes, param no mesmo lugar (40 m)
// longe do pino (60 m ou mais, até 300 m), esse lugar vira ponto do local:
// quem estaciona ali chega naquele local, mesmo mais perto do pino de outro.

export const APRENDE_RAIO_M = 40;
export const APRENDE_VIATURAS = 3;
export const APRENDE_DIAS = 2;
/** Mais perto que isso do pino não acrescenta nada. */
const APRENDE_LONGE_M = 60;
const APRENDE_MAX_POR_LOCAL = 3;

export interface Evidencia {
    hospitalId: string;
    chave: string;
    lat: number;
    lng: number;
    /** Dia (AAAA-MM-DD, Salvador) da parada. */
    dia: string;
}

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function aprenderPontos(
    evidencias: readonly Evidencia[],
    locais: readonly HospitalFrota[],
): Map<string, PontoAprendido[]> {
    const achados: (PontoAprendido & { hospitalId: string })[] = [];
    for (const h of locais) {
        let resto = evidencias.filter((e) => e.hospitalId === h.id && distanciaM(e, h) <= RAIO_BUSCA_M);
        const meus: PontoAprendido[] = [];
        while (resto.length && meus.length < APRENDE_MAX_POR_LOCAL) {
            // O lugar com mais viaturas diferentes paradas a até 40 m.
            let grupo: Evidencia[] = [];
            let viaturas = 0;
            for (const e of resto) {
                const viz = resto.filter((o) => distanciaM(e, o) <= APRENDE_RAIO_M);
                const n = new Set(viz.map((o) => o.chave)).size;
                if (n > viaturas || (n === viaturas && viz.length > grupo.length)) {
                    grupo = viz;
                    viaturas = n;
                }
            }
            if (viaturas < APRENDE_VIATURAS || new Set(grupo.map((o) => o.dia)).size < APRENDE_DIAS) break;
            resto = resto.filter((o) => !grupo.includes(o));
            const c = { lat: media(grupo.map((o) => o.lat)), lng: media(grupo.map((o) => o.lng)), viaturas };
            if (distanciaM(c, h) < APRENDE_LONGE_M || meus.some((m) => distanciaM(c, m) < APRENDE_LONGE_M)) continue;
            meus.push(c);
        }
        achados.push(...meus.map((m) => ({ ...m, hospitalId: h.id })));
    }
    // Dois locais aprenderam o mesmo lugar: fica com quem tem mais viaturas
    // (empate: nenhum). E nunca em cima do pino de outro local.
    const saida = new Map<string, PontoAprendido[]>();
    for (const a of achados) {
        const rival = achados.some(
            (o) => o.hospitalId !== a.hospitalId && distanciaM(a, o) <= 2 * APRENDE_RAIO_M && o.viaturas >= a.viaturas,
        );
        const pinoAlheio = locais.some((h) => h.id !== a.hospitalId && distanciaM(a, h) <= APRENDE_RAIO_M);
        if (rival || pinoAlheio) continue;
        const { hospitalId, ...p } = a;
        saida.set(hospitalId, [...(saida.get(hospitalId) ?? []), p]);
    }
    return saida;
}

// ── Situação de cada viatura no painel ─────────────────────────

export type Situacao = "mapa" | "sem-sinal" | "fora-do-turno" | "desativada";

/**
 * SD e 10h rodam de dia. O horário exato do 10h não está na planilha
 * (NÃO DETERMINADO); assume-se dentro de 07h–19h, a janela do SD.
 */
export function noTurno(turno: string | null, agora: Date): boolean {
    if (turno !== "SD" && turno !== "10h") return true;
    const hora = (agora.getUTCHours() + 24 - 3) % 24;
    return hora >= 7 && hora < 19;
}

/** A planilha oficial põe esta viatura na rua agora? (sem o catálogo: sim) */
function escaladaAgora(v: { turno: string | null; status: string | null }, agora: Date): boolean {
    if (v.status === "DESATIVADA 24H") return false;
    if (v.status === "DESATIVADA SD") return v.turno !== "SD" && !noTurno("SD", agora);
    return noTurno(v.turno, agora);
}

export function situacao(
    v: { codigo: string | null; turno: string | null; status: string | null },
    idadeMin: number | null,
    desativadas: ReadonlySet<string>,
    agora: Date,
): { situacao: Situacao; motivo: string | null } {
    if (v.codigo && desativadas.has(v.codigo)) {
        return { situacao: "desativada", motivo: "até segunda ordem" };
    }
    // Quem transmite agora aparece, mesmo que a planilha diga o contrário:
    // o GPS vê a rua, a planilha pode estar velha.
    if (idadeMin !== null && idadeMin <= MAPA_MIN) {
        return {
            situacao: "mapa",
            motivo: escaladaAgora(v, agora) ? null : "fora da escala oficial agora",
        };
    }
    if (v.status === "DESATIVADA 24H" || (v.status === "DESATIVADA SD" && v.turno === "SD")) {
        return { situacao: "desativada", motivo: "no cadastro oficial" };
    }
    if (!escaladaAgora(v, agora)) {
        return {
            situacao: "fora-do-turno",
            motivo: v.status === "DESATIVADA SD" ? "desativada de dia" : `turno ${v.turno}, só de dia`,
        };
    }
    return {
        situacao: "sem-sinal",
        motivo: idadeMin === null ? "não aparece no SAMU+" : null,
    };
}
