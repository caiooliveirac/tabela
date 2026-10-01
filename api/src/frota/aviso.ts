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
    | { tipo: "sem-sinal" }
    | { tipo: "desativada"; em: Date };

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
    if (e.tipo === "desativada") {
        return (
            `⚪ ${quem} n${a} ${onde}: <b>desativada</b> no painel às ${hhmm(e.em)} — aviso encerrado ` +
            `(entrou ${hhmm(d.entrada)}, ${min(d.entrada, d.ultimaVez)} min até a última posição)` +
            editado
        );
    }
    return (
        `⚪ ${quem} n${a} ${onde}: sem sinal desde ${hhmm(d.ultimaVez)} — ` +
        `pelo menos <b>${min(d.entrada, d.ultimaVez)} min</b> parada (entrou ${hhmm(d.entrada)})` +
        editado
    );
}

// ── Cobrança da denúncia no grupo SAMU-Salvador (WhatsApp, pelo Tom) ──
// USA 40+ min no hospital sem notificação no Acolhimentos: o médico da
// viatura é chamado pelo nome para registrar a retenção no app.
// Formatação do WhatsApp (*negrito*), não HTML.

export const ACOLHIMENTOS_APP = "https://acolhimentos.mnrs.com.br/";

/** "Fulano + Beltrano" (dupla no Plantões) → "Dr(a). *Fulano* e Dr(a). *Beltrano*". */
function chamada(medico: string | null, codigo: string): string {
    const nomes = (medico ?? "").split(/\s*\+\s*/).map((n) => n.replace(/[*_~`]/g, "").trim()).filter(Boolean);
    if (!nomes.length) return `Médico(a) da *${codigo}*`;
    return nomes.map((n) => `Dr(a). *${n}*`).join(" e ");
}

export function textoCobranca(
    d: Pick<DadosAviso, "nome" | "hospitalNome" | "entrada">,
    medico: string | null,
    agora: Date,
): string {
    return (
        `🚨 *${d.nome}* presa n${artigo(d.hospitalNome)} *${d.hospitalNome}* há *${min(d.entrada, agora)} min* ` +
        `(chegou ${hhmm(d.entrada)}), sem registro no Acolhimentos.\n\n` +
        `${chamada(medico, d.nome)}, por favor abra o aplicativo e registre a retenção da maca — ` +
        `é assim que a denúncia chega a quem pode resolver.\n${ACOLHIMENTOS_APP}`
    );
}

// ── Balanço da virada (07h/19h) no grupo SAMU-Salvador (pelo Tom) ──

export interface Retida {
    codigo: string;
    tipo: string | null;
    hospital: string;
    minutos: number;
    /** Ainda parada na hora do balanço: o tempo conta até agora. */
    presa: boolean;
    /** USA sem notificação no Acolhimentos. */
    semRegistro: boolean;
    medico: string | null;
}

/** 95 → "1h35"; 50 → "50 min". */
export function duracaoTexto(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** O plantão que acabou de virar: às 07h o noturno (19h–07h), às 19h o diurno. */
function plantaoQueVirou(agora: Date): string {
    const bahia = new Date(agora.getTime() - 3 * 3_600_000);
    const h = bahia.getUTCHours();
    const diurno = h >= 13;
    // Noturno: começou ontem às 19h.
    const inicio = new Date(bahia.getTime() - (diurno ? 0 : 86_400_000));
    const dia = `${DIA_SEMANA[inicio.getUTCDay()]} ${String(inicio.getUTCDate()).padStart(2, "0")}/${String(inicio.getUTCMonth() + 1).padStart(2, "0")}`;
    return diurno ? `plantão diurno · ${dia}` : `plantão noturno · ${dia}`;
}

/** Hospitais com mais viaturas retidas primeiro; dentro, a maior espera primeiro. */
export function textoBalanco(retidas: Retida[], o: { agora: Date; conferido: boolean; alertaMin: number }): string {
    const titulo = `🏥 *Retenção de ambulâncias · ${plantaoQueVirou(o.agora)}*`;
    if (!retidas.length) {
        return `${titulo}\n\n✅ Nenhuma viatura ficou ${o.alertaMin} min ou mais parada em hospital neste plantão.`;
    }
    const porHospital = new Map<string, Retida[]>();
    for (const r of retidas) porHospital.set(r.hospital, [...(porHospital.get(r.hospital) ?? []), r]);
    const total = (rs: Retida[]) => rs.reduce((s, r) => s + r.minutos, 0);
    const blocos = [...porHospital.entries()]
        .sort((a, b) => b[1].length - a[1].length || total(b[1]) - total(a[1]))
        .map(([hospital, rs]) => {
            const linhas = [...rs]
                .sort((a, b) => b.minutos - a.minutos)
                .map((r) => `• ${r.codigo}${r.tipo ? ` (${r.tipo})` : ""} · *${duracaoTexto(r.minutos)}*${r.presa ? " ⏳ ainda presa" : ""}`);
            const n = rs.length === 1 ? "1 viatura" : `${rs.length} viaturas`;
            return `*${hospital}* — ${n}\n${linhas.join("\n")}`;
        });
    let texto = `${titulo}\n_viaturas ${o.alertaMin} min ou mais paradas em hospital_\n\n${blocos.join("\n\n")}`;

    const semRegistro = retidas.filter((r) => r.semRegistro);
    if (o.conferido && semRegistro.length) {
        const linhas = semRegistro
            .sort((a, b) => b.minutos - a.minutos)
            .map((r) => {
                const nomes = (r.medico ?? "").split(/\s*\+\s*/).map((n) => n.replace(/[*_~`]/g, "").trim()).filter(Boolean);
                const quem = nomes.length ? ` — ${nomes.map((n) => `Dr(a). *${n}*`).join(" e ")}` : "";
                return `• ${r.codigo} no ${r.hospital} (${duracaoTexto(r.minutos)})${quem}`;
            });
        texto +=
            `\n\n📝 *Ainda sem registro no Acolhimentos:*\n${linhas.join("\n")}\n\n` +
            `Colegas, quando puderem, registrem no app os tempos e os motivos da retenção — ` +
            `é o registro de vocês que vira prova para cobrar a solução. Obrigado! 🙏\n${ACOLHIMENTOS_APP}`;
    } else if (o.conferido && retidas.some((r) => r.tipo === "USA")) {
        texto += `\n\n✅ Todas as USAs retidas registraram no Acolhimentos. Obrigado!`;
    }
    return texto;
}
