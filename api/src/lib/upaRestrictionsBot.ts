// ═══════════════════════════════════════════════════════════════
// Restrição de UPA no grupo dos reguladores (BOT REGULADOR).
//
// Três gatilhos:
//   1. imediato   — a chefia restringiu/renovou/liberou pelo painel;
//   2. periódico  — a cada 2h alinhado à virada de turno (07:00 e 19:00), só
//                   quando existe restrição vigente. Nada a restringir = grupo
//                   em silêncio;
//   3. vencimento — o prazo passou: a UPA volta a receber e o grupo é avisado.
//
// Idempotência do periódico: uma linha por slot em upa_restriction_notices.
// Sem isso, cada restart da API repetiria o aviso do slot corrente.
// ═══════════════════════════════════════════════════════════════
import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { escapeHtml, notifyReguladores, reguladoresChatId } from "./telegram.js";
import {
    expireDueRestrictions,
    formatDeadline,
    listActiveRestrictions,
    type UpaRestriction,
} from "../services/upa-restrictions.js";

const TZ = "America/Sao_Paulo";
// Slots do lembrete: 2 em 2 horas ancorados na virada de turno da regulação.
const DIGEST_HOURS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
const TICK_MS = 60_000;
// Tolerância do slot: se a API estava fora às 19:00 e subiu 19:07, o aviso da
// virada ainda sai. Depois disso o slot é considerado perdido.
const SLOT_GRACE_MINUTES = 15;

export async function initUpaRestrictionNotices(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS upa_restriction_notices (
            notice_key text PRIMARY KEY,
            sent_at timestamptz NOT NULL DEFAULT now()
        )
    `);
}

/** Marca o slot como enviado. false = outro processo/tick já mandou. */
async function claimNotice(noticeKey: string): Promise<boolean> {
    const rows = (await db.execute(sql`
        INSERT INTO upa_restriction_notices (notice_key) VALUES (${noticeKey})
        ON CONFLICT (notice_key) DO NOTHING
        RETURNING notice_key
    `)) as unknown as Array<{ notice_key: string }>;
    return rows.length > 0;
}

async function releaseNotice(noticeKey: string): Promise<void> {
    await db.execute(sql`DELETE FROM upa_restriction_notices WHERE notice_key = ${noticeKey}`);
}

// ── Partes no fuso de Salvador (o container roda em UTC) ───────────────────

function saoPauloParts(value: Date): { date: string; hour: number; minute: number } {
    const date = value.toLocaleDateString("en-CA", { timeZone: TZ });
    const [hour, minute] = value
        .toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" })
        .split(":")
        .map((part) => parseInt(part, 10));
    return { date, hour: hour ?? 0, minute: minute ?? 0 };
}

/**
 * Slot do lembrete que este instante deve disparar, ou null se estamos fora da
 * janela de tolerância. Determinístico: mesma hora → mesma chave.
 */
export function resolveDigestSlot(now: Date): { noticeKey: string; hour: number } | null {
    const parts = saoPauloParts(now);
    if (!DIGEST_HOURS.includes(parts.hour)) return null;
    if (parts.minute > SLOT_GRACE_MINUTES) return null;
    return {
        noticeKey: `upa-restrictions:${parts.date}T${String(parts.hour).padStart(2, "0")}`,
        hour: parts.hour,
    };
}

// ── Textos ─────────────────────────────────────────────────────────────────

function restrictionLine(row: UpaRestriction, now: Date): string {
    return `🚫 <b>${escapeHtml(row.unitName)}</b> — restrita até <b>${escapeHtml(formatDeadline(row.restrictedUntil, now))}</b>`;
}

/** Lembrete periódico. Vazio (string vazia) quando não há restrição vigente. */
export function buildRestrictionsDigest(rows: UpaRestriction[], now: Date): string {
    if (rows.length === 0) return "";
    const isShiftTurn = [7, 19].includes(saoPauloParts(now).hour);
    const header = isShiftTurn
        ? "🚫 <b>UPAs restritas neste turno</b>"
        : "🚫 <b>UPAs restritas agora</b>";
    return [
        header,
        ...rows.map((row) => restrictionLine(row, now)),
        "",
        "<i>Restrição da chefia — não encaminhe para estas unidades até o prazo.</i>",
    ].join("\n");
}

/** Resposta do /upas — fala explicitamente quando não há restrição. */
export function buildUpasCommandReply(rows: UpaRestriction[], now: Date): string {
    if (rows.length === 0) {
        return "✅ <b>Nenhuma UPA restrita agora.</b>\nA chefia restringe pelo painel: mnrs.com.br/tabela (aba UPAs).";
    }
    return [
        `🚫 <b>${rows.length} UPA${rows.length === 1 ? "" : "s"} restrita${rows.length === 1 ? "" : "s"}</b>`,
        ...rows.map((row) => `${restrictionLine(row, now)} · <i>${escapeHtml(row.autor)}</i>`),
    ].join("\n");
}

export function buildRestrictionChangeText(params: {
    row: UpaRestriction;
    kind: "created" | "renewed" | "liberated" | "expired";
    now: Date;
}): string {
    const name = escapeHtml(params.row.unitName);
    const prazo = escapeHtml(formatDeadline(params.row.restrictedUntil, params.now));
    const autor = escapeHtml(params.row.autor);

    switch (params.kind) {
        case "created":
            return `🚫 <b>${name} RESTRITA</b> até <b>${prazo}</b>.\nNão encaminhe para esta unidade até o prazo.\n<i>chefia: ${autor}</i>`;
        case "renewed":
            return `🚫 <b>${name}</b> — restrição atualizada: agora vale até <b>${prazo}</b>.\n<i>chefia: ${autor}</i>`;
        case "liberated":
            return `✅ <b>${name} LIBERADA</b> pela chefia — voltou a receber.\n<i>liberada por ${escapeHtml(params.row.removidoPor)}</i>`;
        case "expired":
            return `✅ <b>${name} LIBERADA</b> — o prazo da restrição venceu (${prazo}). Voltou a receber.`;
    }
}

/** Aviso imediato de mudança. Fail-soft: nunca derruba a rota que a chamou. */
export async function announceRestrictionChange(params: {
    row: UpaRestriction;
    kind: "created" | "renewed" | "liberated" | "expired";
    now?: Date;
}): Promise<void> {
    try {
        if (!reguladoresChatId()) return;
        await notifyReguladores(buildRestrictionChangeText({ ...params, now: params.now ?? new Date() }));
    } catch (e) {
        console.error("[upa-restrictions] aviso de mudança falhou:", e);
    }
}

// ── Loop ───────────────────────────────────────────────────────────────────

async function tick(now: Date = new Date()): Promise<void> {
    // 1. Prazos vencidos: fecham e viram aviso de liberação.
    const expired = await expireDueRestrictions(now);
    for (const row of expired) {
        await announceRestrictionChange({ row, kind: "expired", now });
    }

    // 2. Lembrete do slot.
    const slot = resolveDigestSlot(now);
    if (!slot) return;

    const active = await listActiveRestrictions(now);
    if (active.length === 0) return;

    if (!(await claimNotice(slot.noticeKey))) return;

    const sent = await notifyReguladores(buildRestrictionsDigest(active, now));
    if (!sent) {
        // Telegram fora do ar: devolve o slot para tentar no próximo tick,
        // ainda dentro da janela de tolerância.
        await releaseNotice(slot.noticeKey);
    }
}

export function startUpaRestrictionsBroadcast(): void {
    if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !reguladoresChatId()) {
        console.warn(
            "[upa-restrictions] TELEGRAM_BOT_TOKEN/TELEGRAM_REGULADORES_CHAT_ID ausente — avisos no grupo desligados"
        );
        return;
    }

    console.log("🚫 Avisos de UPA restrita ativos — grupo dos reguladores, a cada 2h (ancorado em 07:00/19:00)");
    const run = () => {
        tick().catch((e) => console.error("[upa-restrictions] tick:", e));
    };
    run();
    setInterval(run, TICK_MS);
}
