// ═══════════════════════════════════════════════════════════════
// Período e turno para os relatórios de regulação (bot da chefia).
//
// Dia operacional = 07:00 → 07:00 do dia seguinte, a mesma virada que o
// motor de score já usa (resetTs em services/score.ts). É por isso que
// "hoje" aqui não é o dia do calendário: o plantão que começou ontem às
// 19:00 pertence ao dia operacional de ontem, não ao de hoje.
//
// Turnos: SD = 07:00–18:59 · SN = 19:00–06:59.
// Fuso America/Sao_Paulo em todos os cortes e rótulos — o container roda
// em UTC, então a conversão é sempre explícita.
// ═══════════════════════════════════════════════════════════════

export const TIME_ZONE = "America/Sao_Paulo";

export type Turno = "SD" | "SN";
export type PeriodoKey = "hoje" | "ontem" | "7d";

export interface Periodo {
    key: PeriodoKey;
    /** Rótulo curto para o cabeçalho da mensagem. */
    label: string;
    /** Início inclusivo (instante UTC). */
    start: Date;
    /** Fim exclusivo (instante UTC). */
    end: Date;
}

interface WallParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

/** Horário de parede em São Paulo para um instante. */
export function wallParts(d: Date): WallParts {
    const bag: Record<string, string> = {};
    for (const p of partsFormatter.formatToParts(d)) {
        if (p.type !== "literal") bag[p.type] = p.value;
    }
    return {
        year: Number(bag.year),
        month: Number(bag.month),
        day: Number(bag.day),
        hour: Number(bag.hour),
        minute: Number(bag.minute),
        second: Number(bag.second),
    };
}

/** Offset do fuso (ms) no instante dado — positivo a leste de Greenwich. */
function offsetMs(d: Date): number {
    const p = wallParts(d);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Instante UTC correspondente a um horário de parede em São Paulo. */
export function fromWall(year: number, month: number, day: number, hour = 0, minute = 0): Date {
    const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
    // Duas passadas: a primeira estima o offset, a segunda corrige quando a
    // estimativa caiu do outro lado de uma eventual virada de fuso.
    let ts = naive - offsetMs(new Date(naive));
    ts = naive - offsetMs(new Date(ts));
    return new Date(ts);
}

/** Soma dias à data de parede (sem depender de aritmética de 24h). */
function shiftDay(p: WallParts, deltaDays: number): { year: number; month: number; day: number } {
    const t = new Date(Date.UTC(p.year, p.month - 1, p.day));
    t.setUTCDate(t.getUTCDate() + deltaDays);
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Início do dia operacional (07:00) que contém `now`. */
export function operationalDayStart(now: Date): Date {
    const p = wallParts(now);
    if (p.hour >= 7) return fromWall(p.year, p.month, p.day, 7);
    const prev = shiftDay(p, -1);
    return fromWall(prev.year, prev.month, prev.day, 7);
}

/** Soma dias ao início de um dia operacional, preservando as 07:00 de parede. */
function addOperationalDays(start: Date, deltaDays: number): Date {
    const p = wallParts(start);
    const s = shiftDay(p, deltaDays);
    return fromWall(s.year, s.month, s.day, 7);
}

/** SD = 07:00–18:59 · SN = 19:00–06:59, no fuso de São Paulo. */
export function turnoOf(d: Date): Turno {
    const h = wallParts(d).hour;
    return h >= 7 && h < 19 ? "SD" : "SN";
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/** "28/07" */
export function formatDate(d: Date): string {
    return dateFormatter.format(d);
}

/** "19:25" */
export function formatTime(d: Date): string {
    return timeFormatter.format(d);
}

/** "28/07 19:25" */
export function formatDateTime(d: Date): string {
    return `${formatDate(d)} ${formatTime(d)}`;
}

/**
 * Resolve o argumento de período. Retorna null para argumento desconhecido —
 * quem chama decide se responde com ajuda ou ignora.
 */
export function parsePeriodo(arg: string | undefined, now: Date): Periodo | null {
    const a = (arg || "").trim().toLowerCase();
    const hojeStart = operationalDayStart(now);

    if (a === "" || a === "hoje") {
        return {
            key: "hoje",
            label: "hoje",
            start: hojeStart,
            end: addOperationalDays(hojeStart, 1),
        };
    }
    if (a === "ontem") {
        const start = addOperationalDays(hojeStart, -1);
        return { key: "ontem", label: "ontem", start, end: hojeStart };
    }
    if (a === "7d") {
        return {
            key: "7d",
            label: "últimos 7 dias",
            start: addOperationalDays(hojeStart, -6),
            end: addOperationalDays(hojeStart, 1),
        };
    }
    return null;
}

/** "📅 28/07 07:00 → 29/07 07:00" — o intervalo exato que foi contado. */
export function formatRange(p: Periodo): string {
    return `${formatDateTime(p.start)} → ${formatDateTime(p.end)}`;
}
