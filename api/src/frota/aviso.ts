// ═══════════════════════════════════════════════════════════════
// Aviso no grupo REGULADORES - RECADOS (Telegram) quando uma viatura passa
// de 40 min parada num hospital ou UPA. Uma mensagem por parada: sai aos 40 min,
// é editada a cada coleta com o tempo corrente e fecha com a liberação —
// o grupo não recebe uma enxurrada, e quem olha a mensagem vê o estado atual.
// Desligar sem deploy: FROTA_AVISOS_TELEGRAM=0 no .env.
// ═══════════════════════════════════════════════════════════════
import { escapeHtml } from "../lib/telegram.js";
import type { Ocorrencia, SituacaoOcorrencia } from "./ocorrencias.js";

export interface DadosAviso {
    nome: string;
    tipo: string | null;
    hospitalNome: string;
    entrada: Date;
    ultimaVez: Date;
    /** Quando o aviso saiu. O Telegram mostra essa hora no balão, mesmo depois de editado. */
    avisoEm?: Date | null;
    /** Pelo mapa de equipes (ocorrencias.ts). Ausente ou null = não sei: o aviso sai sem a linha. */
    ocorrencia?: SituacaoOcorrencia | null;
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

/** "BRUNA MICHELI ALVES" → "Bruna Micheli Alves". */
const nomeProprio = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

/**
 * A viatura está em ocorrência, e com qual médico regulador (MR)? Parada sem
 * ocorrência é outra conversa — o aviso diz qual das duas.
 */
export function linhaOcorrencia(s: SituacaoOcorrencia | null | undefined): string {
    if (!s) return "";
    const o = s.ocorrencia;
    if (!o) return "\n🟢 <b>sem ocorrência</b> no mapa de equipes";
    const status = o.status
        ? `\n${escapeHtml(o.status.toLowerCase())}${o.statusEm ? ` às ${hhmm(new Date(o.statusEm))}` : ""}`
        : "";
    return (
        `\n🚑 <b>em ocorrência</b>${o.protocolo ? ` ${escapeHtml(o.protocolo)}` : ""}` +
        `${o.medico ? ` · MR <b>${escapeHtml(nomeProprio(o.medico))}</b>` : ""}` +
        `${o.regulacaoSecundaria ? " · regulação secundária" : ""}` +
        status
    );
}

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
            `entrou ${hhmm(d.entrada)} · posição confirmada ${hhmm(d.ultimaVez)}` +
            `${linhaOcorrencia(d.ocorrencia)}\n` +
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

// ── Na própria base, mas ainda em ocorrência ──
// Parada na base não conta para os 40 min do hospital. Mas, se o mapa de
// equipes ainda a dá em ocorrência (ou ela apertou retorno à base) e ela está
// ali há 40 min, ou a ocorrência já acabou e falta fechar, ou — base dentro de
// UPA/hospital — ela está esperando acolhimento ali mesmo. Um aviso por
// viatura e ocorrência.

export interface BaseOcupada {
    nome: string;
    base: string | null;
    /** Base dentro de hospital/UPA: o nome dele (o acolhimento pode ser ali). */
    hospitalNome: string | null;
    minutos: number;
    ocorrencia: Ocorrencia;
}

/** Na área da própria base há `alertaMin`+ e o mapa ainda dá ocorrência (inclui o retorno apertado). */
export function baseOcupada(
    v: {
        nome: string;
        base: string | null;
        naBase: boolean;
        noHospital: { naBase: boolean; hospitalNome: string } | null;
        ocorrencia: SituacaoOcorrencia | null;
    },
    desde: Date,
    agora: Date,
    alertaMin: number,
): BaseOcupada | null {
    if (!(v.naBase || v.noHospital?.naBase)) return null;
    const o = v.ocorrencia?.ocorrencia;
    if (!o) return null;
    // Conta do mais tardio entre chegar na base e abrir a ocorrência: quem
    // estava na base e acabou de ser despachado ainda está se aprontando.
    const abertura = o.abertura ? new Date(o.abertura) : null;
    const inicio = abertura && abertura > desde ? abertura : desde;
    const minutos = min(inicio, agora);
    if (minutos < alertaMin) return null;
    return { nome: v.nome, base: v.base, hospitalNome: v.noHospital?.naBase ? v.noHospital.hospitalNome : null, minutos, ocorrencia: o };
}

export function textoBaseOcupada(d: BaseOcupada): string {
    const o = d.ocorrencia;
    const retorno = /DISPON[IÍ]VEL|RETORNO/i.test(o.status ?? "");
    const onde = d.hospitalNome
        ? `na própria base, dentro d${artigo(d.hospitalNome)} <b>${escapeHtml(d.hospitalNome)}</b>,`
        : `na área da própria base${d.base ? ` (${escapeHtml(d.base)})` : ""}`;
    const status = o.status
        ? `${escapeHtml(o.status.toLowerCase())}${o.statusEm ? ` às ${hhmm(new Date(o.statusEm))}` : ""}`
        : "sem status no mapa";
    return (
        `🚨🏠 <b>${escapeHtml(d.nome)} está na base, mas ainda EM OCORRÊNCIA!</b>\n` +
        `Está ${onde} há <b>${d.minutos} min</b>` +
        `${o.protocolo ? ` · ocorrência <b>${escapeHtml(o.protocolo)}</b>` : ""}` +
        `${o.medico ? ` · MR <b>${escapeHtml(nomeProprio(o.medico))}</b>` : ""}\n` +
        `${retorno ? "↩ Apertou retorno à base" : "📍 Último status"}: ${status}\n` +
        `👉 Já encerrou e falta fechar no sistema${d.hospitalNome ? ", ou está com dificuldade de acolhimento aí" : ""}?\n` +
        `<a href="${PAINEL}">ver no painel</a>`
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
        `${chamada(medico, d.nome)}, por favor abra o aplicativo e registre a demora para acolher o paciente — ` +
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
