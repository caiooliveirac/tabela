// ═══════════════════════════════════════════════════════════════
// Aviso no grupo REGULADORES - RECADOS (Telegram) quando uma viatura passa
// de 40 min parada num hospital. Uma mensagem por parada: sai aos 40 min,
// é editada a cada coleta com o tempo corrente e fecha com a liberação —
// o grupo não recebe uma enxurrada, e quem olha a mensagem vê o estado atual.
// Desligar sem deploy: FROTA_AVISOS_TELEGRAM=0 no .env.
// ═══════════════════════════════════════════════════════════════
import { escapeHtml } from "../lib/telegram.js";

export interface DadosAviso {
    nome: string;
    tipo: string | null;
    hospitalNome: string;
    entrada: Date;
    ultimaVez: Date;
}

export type EstadoAviso =
    | { tipo: "parada"; minutos: number }
    | { tipo: "saiu"; saida: Date }
    | { tipo: "sem-sinal" };

const PAINEL = "https://mnrs.com.br/tabela/?tab=frota";

export function hhmm(d: Date): string {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
}

const min = (de: Date, ate: Date) => Math.max(0, Math.floor((ate.getTime() - de.getTime()) / 60_000));

export function textoAviso(d: DadosAviso, e: EstadoAviso): string {
    const quem = `<b>${escapeHtml(d.nome)}</b>${d.tipo ? ` (${escapeHtml(d.tipo)})` : ""}`;
    const onde = `<b>${escapeHtml(d.hospitalNome)}</b>`;
    if (e.tipo === "parada") {
        return (
            `⏱ ${quem} parada há <b>${e.minutos} min</b> no ${onde}\n` +
            `entrou ${hhmm(d.entrada)} · posição confirmada ${hhmm(d.ultimaVez)}\n` +
            `<a href="${PAINEL}">ver no painel</a>`
        );
    }
    if (e.tipo === "saiu") {
        return `✅ ${quem} saiu do ${onde} às ${hhmm(e.saida)} — <b>${min(d.entrada, e.saida)} min</b> parada (entrou ${hhmm(d.entrada)})`;
    }
    return (
        `⚪ ${quem} no ${onde}: sem sinal desde ${hhmm(d.ultimaVez)} — ` +
        `pelo menos <b>${min(d.entrada, d.ultimaVez)} min</b> parada (entrou ${hhmm(d.entrada)})`
    );
}
