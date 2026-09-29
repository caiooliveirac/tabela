// ═══════════════════════════════════════════════════════════════
// Avisos de sinal e bateria, o /frota e o resumo da troca de plantão —
// regras puras, sem rede nem banco (testadas em sinal.test.ts). O coletor
// chama a cada 2 min e publica no grupo da frota (TELEGRAM_FROTA_CHAT_ID).
//
// Só caso AGUDO vai ao grupo na hora. Viatura muda há mais de 3 h é
// crônica: fica fora dos avisos e do ranking, e aparece numa linha do resumo.
// Limites de 29/09/2026, para calibrar com o registro (GET /frota/alertas).
// ═══════════════════════════════════════════════════════════════
import { escapeHtml } from "../lib/telegram.js";
import { hhmm } from "./aviso.js";
import { ALERTA_MIN } from "./regras.js";
import type { ViaturaFrota } from "./painel.js";

/** Sem posição nova há 10 min: perdeu o sinal. */
export const SEM_SINAL_MIN = 10;
/** Queda só abre se vista antes de 30 min de silêncio: mais que isso já é velho (deploy, crônico). */
export const QUEDA_JANELA_MIN = 30;
/**
 * Muda há 3 h: crônica. O aviso fecha e ela sai do ranking. Em 29/09/2026,
 * 9 viaturas estavam mudas desde a troca das 07h — com 12 h ocupavam o topo.
 */
export const CRONICO_MIN = 3 * 60;
/** Queda que começa até 60 min depois da volta da anterior é reincidência: não avisa... */
export const REINCIDE_MIN = 60;
/** ...a não ser que dure 30 min. */
export const REINCIDE_AVISA_MIN = 30;
/** Sinal instável: 3 quedas em 3 h (a atual conta). Um aviso por viatura a cada 6 h. */
export const INSTAVEL_QUEDAS = 3;
export const INSTAVEL_JANELA_MIN = 180;
export const INSTAVEL_REPETE_MIN = 360;
/** 8 quedas no mesmo ciclo: quem parou foi o SAMU+, não as viaturas. Um aviso só. */
export const SURTO_QUEDAS = 8;
/** Bateria abaixo de 20%, lida há até 30 min e sem subir: orientar carregar. */
export const BATERIA_MIN = 20;
export const BATERIA_FRESCA_MIN = 30;
/** Leitura de bateria mais velha que isto não entra no ranking nem no resumo. */
export const BATERIA_VALE_MIN = 6 * 60;
/** Resumo da troca de plantão: 07:30 e 19:30, enviado até 1 h depois (deploy no meio). */
export const RESUMO_HORAS = [7, 19] as const;
export const RESUMO_ATRASO_MIN = 30;
export const RESUMO_TOLERA_MIN = 60;

const MIN = 60_000;
const PAINEL = "https://mnrs.com.br/tabela/?tab=frota";

// ── Quem entra na conta ─────────────────────────────────────────

/** Viatura do catálogo, escalada agora e não desativada — a que deveria transmitir. */
export function elegivel(v: Pick<ViaturaFrota, "foraDoCatalogo" | "situacao" | "motivo">): boolean {
    if (v.foraDoCatalogo) return false;
    if (v.situacao === "desativada" || v.situacao === "fora-do-turno") return false;
    return v.motivo !== "fora da escala oficial agora";
}

/** Minutos desde a última posição; null = nunca apareceu no SAMU+. */
export function silencioMin(v: Pick<ViaturaFrota, "posicao">, agora: Date): number | null {
    if (!v.posicao) return null;
    return Math.max(0, Math.floor((agora.getTime() - new Date(v.posicao.em).getTime()) / MIN));
}

export const cronica = (silencio: number | null) => silencio === null || silencio >= CRONICO_MIN;

// ── Quedas de sinal ─────────────────────────────────────────────

export interface Queda {
    id?: number;
    chave: string;
    /** Última posição antes do silêncio. */
    desde: Date;
    abertaEm: Date;
    /** Vai (ou foi) ao grupo. Reincidência e surto ficam só no registro. */
    avisar: boolean;
    silenciada: "reincidente" | "surto" | null;
    msgId?: number | null;
    chat?: string | null;
}

export interface QuedaRecente {
    chave: string;
    desde: Date;
    /** Posição que voltou; null = fechou sem voltar (turno, crônica). */
    volta: Date | null;
    fechadaEm: Date;
}

export interface QuedaFechada {
    queda: Queda;
    volta: Date | null;
    motivo: "voltou" | "fora-do-turno" | "cronica";
}

export interface Instavel {
    chave: string;
    quedas: number;
    /** Minutos sem sinal somados nas 3 h. */
    minutos: number;
}

export function avancarQuedas(
    abertas: ReadonlyMap<string, Queda>,
    recentes: readonly QuedaRecente[],
    viaturas: readonly ViaturaFrota[],
    instavelEm: ReadonlyMap<string, Date>,
    agora: Date,
): {
    abertas: Map<string, Queda>;
    novas: Queda[];
    /** Reincidência que passou de 30 min: vai ao grupo agora. */
    promovidas: Queda[];
    fechadas: QuedaFechada[];
    instaveis: Instavel[];
    /** Quantas quedas abriram juntas, quando passou de SURTO_QUEDAS. */
    surto: number | null;
} {
    const proximas = new Map(abertas);
    const novas: Queda[] = [];
    const promovidas: Queda[] = [];
    const fechadas: QuedaFechada[] = [];
    const instaveis: Instavel[] = [];
    const t = agora.getTime();

    for (const v of viaturas) {
        const posicao = v.posicao ? new Date(v.posicao.em) : null;
        const a = proximas.get(v.chave);
        if (a) {
            const fecha = (volta: Date | null, motivo: QuedaFechada["motivo"]) => {
                proximas.delete(v.chave);
                fechadas.push({ queda: a, volta, motivo });
            };
            const mudo = (t - a.desde.getTime()) / MIN;
            if (posicao && posicao > a.desde) fecha(posicao, "voltou");
            else if (!elegivel(v)) fecha(null, "fora-do-turno");
            else if (mudo >= CRONICO_MIN) fecha(null, "cronica");
            else if (!a.avisar && a.silenciada === "reincidente" && mudo >= REINCIDE_AVISA_MIN) {
                const p = { ...a, avisar: true };
                proximas.set(v.chave, p);
                promovidas.push(p);
            }
            continue;
        }
        if (!posicao || !elegivel(v)) continue;
        const mudo = (t - posicao.getTime()) / MIN;
        if (mudo < SEM_SINAL_MIN || mudo >= QUEDA_JANELA_MIN) continue;

        const antes = recentes.filter((q) => q.chave === v.chave && t - q.fechadaEm.getTime() <= INSTAVEL_JANELA_MIN * MIN);
        const reincide = antes.some((q) => q.volta && posicao.getTime() - q.volta.getTime() <= REINCIDE_MIN * MIN);
        const q: Queda = {
            chave: v.chave, desde: posicao, abertaEm: agora,
            avisar: !reincide, silenciada: reincide ? "reincidente" : null,
        };
        proximas.set(v.chave, q);
        novas.push(q);

        const ultimo = instavelEm.get(v.chave);
        if (antes.length + 1 >= INSTAVEL_QUEDAS && (!ultimo || t - ultimo.getTime() > INSTAVEL_REPETE_MIN * MIN)) {
            const minutos = antes.reduce((s, x) => s + ((x.volta ?? x.fechadaEm).getTime() - x.desde.getTime()) / MIN, mudo);
            instaveis.push({ chave: v.chave, quedas: antes.length + 1, minutos: Math.round(minutos) });
        }
    }

    if (novas.length < SURTO_QUEDAS) return { abertas: proximas, novas, promovidas, fechadas, instaveis, surto: null };
    for (const q of novas) {
        q.avisar = false;
        q.silenciada = "surto";
    }
    return { abertas: proximas, novas, promovidas, fechadas, instaveis: [], surto: novas.length };
}

/** Viaturas com 3+ quedas nas últimas 3 h (fechadas e a aberta) — para o ranking e o resumo. */
export function instaveisAgora(
    recentes: readonly QuedaRecente[],
    abertas: ReadonlyMap<string, Queda>,
    agora: Date,
): Map<string, Instavel> {
    const t = agora.getTime();
    const por = new Map<string, Instavel>();
    const soma = (chave: string, min: number) => {
        const i = por.get(chave) ?? { chave, quedas: 0, minutos: 0 };
        i.quedas++;
        i.minutos += min;
        por.set(chave, i);
    };
    for (const q of recentes) {
        if (t - q.fechadaEm.getTime() <= INSTAVEL_JANELA_MIN * MIN) soma(q.chave, ((q.volta ?? q.fechadaEm).getTime() - q.desde.getTime()) / MIN);
    }
    for (const q of abertas.values()) soma(q.chave, (t - q.desde.getTime()) / MIN);
    for (const [k, i] of por) {
        if (i.quedas < INSTAVEL_QUEDAS) por.delete(k);
        else i.minutos = Math.round(i.minutos);
    }
    return por;
}

// ── Bateria ─────────────────────────────────────────────────────

const minDesde = (iso: string | null, agora: Date) =>
    iso ? (agora.getTime() - new Date(iso).getTime()) / MIN : Infinity;

/** Subiu desde a leitura anterior: está carregando. */
const carregando = (v: Pick<ViaturaFrota, "bateria" | "bateriaAntes">) =>
    v.bateria !== null && v.bateriaAntes !== null && v.bateriaAntes < v.bateria;

/** Bateria abaixo de 20%, lida agora há pouco, transmitindo e sem subir. */
export function bateriaBaixa(v: ViaturaFrota, agora: Date): boolean {
    if (!elegivel(v) || v.bateria === null || v.bateria >= BATERIA_MIN || carregando(v)) return false;
    const s = silencioMin(v, agora);
    // Muda: quem avisa é a queda de sinal.
    if (s === null || s >= SEM_SINAL_MIN) return false;
    return minDesde(v.bateriaEm, agora) <= BATERIA_FRESCA_MIN;
}

/** Plantão de 12 h: "2026-09-29-D" (07–19) ou "2026-09-29-N" (19–07, data do início). */
export function plantaoDe(agora: Date): string {
    const bahia = new Date(agora.getTime() - 3 * 3_600_000);
    const h = bahia.getUTCHours();
    if (h >= 7 && h < 19) return `${bahia.toISOString().slice(0, 10)}-D`;
    const inicio = h < 7 ? new Date(bahia.getTime() - 24 * 3_600_000) : bahia;
    return `${inicio.toISOString().slice(0, 10)}-N`;
}

/** Horário do resumo a mandar agora ("2026-09-29 19:30"), ou null fora da janela. */
export function resumoDevido(agora: Date): string | null {
    const bahia = new Date(agora.getTime() - 3 * 3_600_000);
    const dia = bahia.toISOString().slice(0, 10);
    for (const h of RESUMO_HORAS) {
        const slot = Date.parse(`${dia}T${String(h).padStart(2, "0")}:${RESUMO_ATRASO_MIN}:00-03:00`);
        if (agora.getTime() >= slot && agora.getTime() - slot < RESUMO_TOLERA_MIN * MIN) {
            return `${dia} ${String(h).padStart(2, "0")}:${RESUMO_ATRASO_MIN}`;
        }
    }
    return null;
}

// ── Textos ──────────────────────────────────────────────────────

/** "32 min", "2h05". */
export function duracao(min: number): string {
    const m = Math.max(0, Math.round(min));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Hora de hoje, ou "28/09 18:42" se for de outro dia. */
export function quando(d: Date, agora: Date): string {
    const dia = (x: Date) => x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
    return dia(d) === dia(agora) ? hhmm(d) : `${dia(d)} ${hhmm(d)}`;
}

const quem = (v: Pick<ViaturaFrota, "nome" | "tipo">) =>
    `<b>${escapeHtml(v.nome)}</b>${v.tipo ? ` (${escapeHtml(v.tipo)})` : ""}`;

/**
 * O que o SAMU+ diz do app, se for desta queda (evento a partir de 10 min
 * antes da última posição). Não é diagnóstico: é o último registro do app.
 */
export function causa(v: ViaturaFrota, desde: Date, agora: Date): string | null {
    const partes: string[] = [];
    const ev = v.evento && new Date(v.evento.em).getTime() >= desde.getTime() - SEM_SINAL_MIN * MIN ? v.evento : null;
    if (ev?.tipo === "OFFLINE" && v.conexao === "none") partes.push(`<b>sem internet</b> (app caiu às ${quando(new Date(ev.em), agora)})`);
    else if (ev?.tipo === "OFFLINE") partes.push(`app caiu às ${quando(new Date(ev.em), agora)} com ${escapeHtml(v.conexao ?? "conexão ?")}`);
    else if (ev?.tipo === "ONLINE") partes.push(`app online desde ${quando(new Date(ev.em), agora)}, mas sem posição (GPS?)`);
    if (v.bateria !== null && v.bateria < BATERIA_MIN && minDesde(v.bateriaEm, agora) <= BATERIA_VALE_MIN) {
        partes.push(`bateria <b>${v.bateria}%</b> às ${quando(new Date(v.bateriaEm!), agora)}`);
    }
    return partes.length ? partes.join(" · ") : null;
}

export function textoQueda(v: ViaturaFrota, q: Queda, agora: Date): string {
    const c = causa(v, q.desde, agora);
    return (
        `📵 ${quem(v)} <b>sem sinal</b> há <b>${duracao((agora.getTime() - q.desde.getTime()) / MIN)}</b> — última posição ${hhmm(q.desde)}\n` +
        (c ? `SAMU+: ${c}\n` : "") +
        `<a href="${PAINEL}">ver no painel</a>` +
        (hhmm(agora) !== hhmm(q.abertaEm) ? `\n<i>aviso das ${hhmm(q.abertaEm)}, atualizado às ${hhmm(agora)}</i>` : "")
    );
}

/** Texto final da mensagem da queda (edição) e a resposta, que notifica — só na volta. */
export function textoFimQueda(v: ViaturaFrota, f: QuedaFechada, agora: Date): { edicao: string; resposta: string | null } {
    const q = f.queda;
    if (f.motivo === "voltou") {
        const min = (f.volta!.getTime() - q.desde.getTime()) / MIN;
        return {
            edicao: `✅ ${quem(v)} ficou sem sinal de ${hhmm(q.desde)} a ${hhmm(f.volta!)} — <b>${duracao(min)}</b>`,
            resposta: `✅ ${quem(v)} voltou a transmitir às ${hhmm(f.volta!)} — ${duracao(min)} sem sinal`,
        };
    }
    if (f.motivo === "fora-do-turno") {
        return { edicao: `⚪ ${quem(v)} sem sinal desde ${hhmm(q.desde)} — saiu do turno, aviso encerrado às ${hhmm(agora)}`, resposta: null };
    }
    return {
        edicao: `⚫ ${quem(v)} sem sinal desde ${quando(q.desde, agora)} — mais de ${CRONICO_MIN / 60} h: segue só no resumo do plantão`,
        resposta: null,
    };
}

export function textoInstavel(v: ViaturaFrota, i: Instavel): string {
    return `📶 ${quem(v)} <b>sinal instável</b>: ${i.quedas} quedas em 3 h, ${duracao(i.minutos)} sem sinal no total`;
}

export function textoSurto(n: number, agora: Date): string {
    return (
        `⚠️ <b>${n} viaturas pararam de transmitir juntas</b> (${hhmm(agora)}) — provável falha do SAMU+, ` +
        `não das viaturas. Sem aviso individual dessas quedas; a volta de cada uma aparece no painel.`
    );
}

export function textoBateria(v: ViaturaFrota, agora: Date): string {
    return (
        `🔋 ${quem(v)} bateria <b>${v.bateria}%</b> (lida às ${quando(new Date(v.bateriaEm!), agora)}) — ` +
        `<b>colocar o tablet para carregar</b>`
    );
}

// ── Ranking (/frota) e resumo do plantão ────────────────────────

export interface ItemRanking {
    chave: string;
    score: number;
    linha: string;
}

/**
 * Severidade: o que pesa é o tempo fora de ação, seja qual for o motivo —
 * sem sinal (+10: nem se sabe onde está) ou parada 40+ min no hospital/UPA,
 * vale o maior. Somam: bateria baixa (2 pontos por % abaixo de 20) e
 * instabilidade (metade dos minutos caídos em 3 h). USA vale 1,5×.
 * Crônica (muda há 3 h+) fica fora — senão ocuparia o topo o plantão todo.
 */
export function ranking(
    viaturas: readonly ViaturaFrota[],
    instaveis: ReadonlyMap<string, Instavel>,
    agora: Date,
): {
    itens: ItemRanking[];
    /** "CN11 08:07" (desde quando) ou "CN10 nunca" — só listadas. */
    cronicas: string[];
    escaladas: number;
    transmitindo: number;
} {
    const itens: ItemRanking[] = [];
    const cronicas: string[] = [];
    let escaladas = 0;
    let transmitindo = 0;
    for (const v of viaturas) {
        if (!elegivel(v)) continue;
        escaladas++;
        const s = silencioMin(v, agora);
        if (cronica(s)) {
            cronicas.push(`${v.nome} ${v.posicao ? quando(new Date(v.posicao.em), agora) : "nunca"}`);
            continue;
        }
        if (s! < SEM_SINAL_MIN) transmitindo++;
        const partes: string[] = [];
        let tempo = 0;
        if (s! >= SEM_SINAL_MIN) {
            tempo = s! + 10;
            const c = causa(v, new Date(v.posicao!.em), agora);
            partes.push(`📵 sem sinal há <b>${duracao(s!)}</b> (desde ${hhmm(new Date(v.posicao!.em))})${c ? ` · ${c}` : ""}`);
        }
        const h = v.noHospital;
        if (h && !h.naBase && h.minutos >= ALERTA_MIN) {
            tempo = Math.max(tempo, h.minutos);
            partes.push(`⏱ <b>${duracao(h.minutos)}</b> n${/^(UPA|UE)\b/.test(h.hospitalNome) ? "a" : "o"} ${escapeHtml(h.hospitalNome)}`);
        }
        let extra = 0;
        if (s! < SEM_SINAL_MIN && v.bateria !== null && v.bateria < BATERIA_MIN && !carregando(v) && minDesde(v.bateriaEm, agora) <= BATERIA_VALE_MIN) {
            extra += 2 * (BATERIA_MIN - v.bateria);
            partes.push(`🔋 bateria <b>${v.bateria}%</b> (${quando(new Date(v.bateriaEm!), agora)})`);
        }
        const i = instaveis.get(v.chave);
        if (i) {
            extra += i.minutos / 2;
            partes.push(`📶 ${i.quedas} quedas em 3 h (${duracao(i.minutos)})`);
        }
        if (!partes.length) continue;
        const score = (tempo + extra) * (v.tipo === "USA" ? 1.5 : 1);
        itens.push({ chave: v.chave, score, linha: `${quem(v)} — ${partes.join(" · ")}` });
    }
    itens.sort((a, b) => b.score - a.score);
    return { itens, cronicas, escaladas, transmitindo };
}

export const RANKING_MAX = 15;

/** O Telegram recusa mensagem acima de 4096 caracteres: corta na linha (cada linha fecha suas tags). */
export function cortar(linhas: string[], max = 4000): string {
    const saida: string[] = [];
    let n = 0;
    for (const l of linhas) {
        if (n + l.length + 1 > max - 2) {
            saida.push("…");
            break;
        }
        saida.push(l);
        n += l.length + 1;
    }
    return saida.join("\n");
}

export function textoFrota(r: ReturnType<typeof ranking>, agora: Date): string {
    const linhas = [`🚑 <b>Frota agora</b> (${hhmm(agora)}) — ${r.transmitindo} de ${r.escaladas} escaladas transmitindo`];
    if (!r.itens.length) linhas.push("", "✅ Nenhum problema agudo.");
    else {
        linhas.push("");
        r.itens.slice(0, RANKING_MAX).forEach((it, n) => linhas.push(`${n + 1}. ${it.linha}`));
        if (r.itens.length > RANKING_MAX) linhas.push(`… e mais ${r.itens.length - RANKING_MAX}.`);
    }
    if (r.cronicas.length) {
        linhas.push("", `⚫ ${r.cronicas.length} sem transmitir há ${CRONICO_MIN / 60} h+ (fora do ranking): ${r.cronicas.map(escapeHtml).join(", ")}`);
    }
    linhas.push(`<a href="${PAINEL}">ver no painel</a>`);
    return cortar(linhas);
}

export function textoResumo(
    viaturas: readonly ViaturaFrota[],
    instaveis: ReadonlyMap<string, Instavel>,
    agora: Date,
): string {
    const r = ranking(viaturas, instaveis, agora);
    const el = viaturas.filter(elegivel);
    const mudas = el
        .filter((v) => {
            const s = silencioMin(v, agora);
            return s !== null && s >= SEM_SINAL_MIN && !cronica(s);
        })
        .sort((a, b) => a.posicao!.em.localeCompare(b.posicao!.em));
    const paradas = el.filter((v) => v.noHospital && !v.noHospital.naBase && v.noHospital.minutos >= ALERTA_MIN);
    const baterias = el.filter(
        (v) => v.bateria !== null && v.bateria < BATERIA_MIN && !carregando(v) && minDesde(v.bateriaEm, agora) <= BATERIA_VALE_MIN,
    );
    const linhas = [
        `📋 <b>Frota — troca de plantão</b> (${hhmm(agora)})`,
        `${r.transmitindo} de ${r.escaladas} escaladas transmitindo`,
    ];
    if (mudas.length) {
        linhas.push("", `📵 <b>Sem sinal</b> (${mudas.length})`);
        for (const v of mudas) {
            const desde = new Date(v.posicao!.em);
            const c = causa(v, desde, agora);
            linhas.push(`• ${quem(v)} desde ${quando(desde, agora)}${c ? ` — ${c}` : ""}`);
        }
    }
    if (paradas.length) {
        linhas.push("", `⏱ <b>Paradas de 40+ min agora</b> (${paradas.length})`);
        for (const v of paradas) linhas.push(`• ${quem(v)} ${duracao(v.noHospital!.minutos)} — ${escapeHtml(v.noHospital!.hospitalNome)}`);
    }
    if (baterias.length) {
        linhas.push("", `🔋 <b>Bateria abaixo de 20%</b> (${baterias.length})`);
        for (const v of baterias) linhas.push(`• ${quem(v)} ${v.bateria}% (lida ${quando(new Date(v.bateriaEm!), agora)})`);
    }
    if (instaveis.size) {
        const nomes = [...instaveis.values()].map((i) => {
            const v = viaturas.find((x) => x.chave === i.chave);
            return `${escapeHtml(v?.nome ?? i.chave)} (${i.quedas} quedas, ${duracao(i.minutos)})`;
        });
        linhas.push("", `📶 <b>Instáveis nas últimas 3 h</b>: ${nomes.join(", ")}`);
    }
    if (r.cronicas.length) {
        linhas.push("", `⚫ <b>Sem transmitir há ${CRONICO_MIN / 60} h+</b> (${r.cronicas.length}): ${r.cronicas.map(escapeHtml).join(", ")}`);
    }
    if (!mudas.length && !paradas.length && !baterias.length && !instaveis.size && !r.cronicas.length) {
        linhas.push("", "✅ Nenhum problema.");
    }
    linhas.push(`<a href="${PAINEL}">ver no painel</a>`);
    return cortar(linhas);
}
