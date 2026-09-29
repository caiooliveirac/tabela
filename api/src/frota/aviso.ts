// ═══════════════════════════════════════════════════════════════
// Aviso no grupo REGULADORES - RECADOS (Telegram) quando uma viatura passa
// de 40 min parada num hospital ou UPA. Uma mensagem por parada: sai aos 40 min,
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
    /** Quando o aviso saiu. O Telegram mostra essa hora no balão, mesmo depois de editado. */
    avisoEm?: Date | null;
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

/** "na UPA", "na UE"; o resto (hospital, PA, Centro) é masculino. */
const artigo = (nome: string) => (/^(UPA|UE)\b/.test(nome) ? "a" : "o");

/**
 * Texto da mensagem. Com `agora`, a edição diz de quando é o aviso e quando
 * foi atualizado — o Telegram não marca edição de bot, e "saiu às 14:33"
 * num balão das 14:18 parece hora do futuro.
 */
export function textoAviso(d: DadosAviso, e: EstadoAviso, agora?: Date): string {
    const quem = `<b>${escapeHtml(d.nome)}</b>${d.tipo ? ` (${escapeHtml(d.tipo)})` : ""}`;
    const onde = `<b>${escapeHtml(d.hospitalNome)}</b>`;
    const a = artigo(d.hospitalNome);
    const editado =
        d.avisoEm && agora && hhmm(agora) !== hhmm(d.avisoEm)
            ? `\n<i>aviso das ${hhmm(d.avisoEm)}, atualizado às ${hhmm(agora)}</i>`
            : "";
    if (e.tipo === "parada") {
        return (
            `⏱ ${quem} parada há <b>${e.minutos} min</b> n${a} ${onde}\n` +
            `entrou ${hhmm(d.entrada)} · posição confirmada ${hhmm(d.ultimaVez)}\n` +
            `<a href="${PAINEL}">ver no painel</a>` +
            editado
        );
    }
    if (e.tipo === "saiu") {
        return (
            `✅ ${quem} saiu d${a} ${onde} às ${hhmm(e.saida)} — <b>${min(d.entrada, e.saida)} min</b> parada ` +
            `(entrou ${hhmm(d.entrada)})` +
            editado
        );
    }
    return (
        `⚪ ${quem} n${a} ${onde}: sem sinal desde ${hhmm(d.ultimaVez)} — ` +
        `pelo menos <b>${min(d.entrada, d.ultimaVez)} min</b> parada (entrou ${hhmm(d.entrada)})` +
        editado
    );
}
