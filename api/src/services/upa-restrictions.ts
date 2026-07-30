// ═══════════════════════════════════════════════════════════════
// Restrição de UPA — regra de negócio.
//
// A chefia (autorizada por PIN) marca uma UPA como RESTRITA até um prazo.
// Enquanto vigente, a restrição:
//   • pinta a célula da UPA de vermelho no painel (/tabela, aba UPAs);
//   • é repetida periodicamente no grupo dos reguladores pelo bot regulador;
//   • entra na confirmação de chegada do regulador no bot Plantões SAMU
//     (que lê /tabela/api/upas/restrictions).
//
// Vigência: `ativo = true` E `restricted_until > agora`. O prazo é a única
// informação além da unidade — restrição vencida sai sozinha do painel e dos
// avisos, sem depender de alguém lembrar de liberar.
// ═══════════════════════════════════════════════════════════════
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "../index.js";
import { upaRestrictions } from "../db/schema.js";

export type UpaRestriction = typeof upaRestrictions.$inferSelect;

const TZ = "America/Sao_Paulo";
// Teto de sanidade: o fluxo previsto é "até 07:00/19:00 de hoje ou de amanhã".
// Qualquer prazo além de 8 dias é engano de digitação, não decisão da chefia.
const MAX_RESTRICTION_DAYS = 8;

/**
 * Cria a tabela se ainda não existir — mesmo padrão de initChefiaSecurity.
 * O deploy do tabela (labctl promote) não roda migrations; garantir aqui evita
 * que a feature suba com a página quebrada esperando um passo manual.
 */
export async function initUpaRestrictions(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS upa_restrictions (
            id serial PRIMARY KEY,
            unit_key varchar(120) NOT NULL,
            unit_name varchar(160) NOT NULL,
            restricted_until timestamptz NOT NULL,
            autor varchar(100) NOT NULL,
            "timestamp" timestamptz NOT NULL DEFAULT now(),
            ativo boolean NOT NULL DEFAULT true,
            removido_por varchar(100),
            removido_em timestamptz
        )
    `);
    // Leitura quente: lista de vigentes a cada poll do painel e do bot.
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS upa_restrictions_ativo_until_idx
            ON upa_restrictions (ativo, restricted_until)
    `);
}

/** Restrições vigentes agora, da que vence primeiro para a que vence por último. */
export async function listActiveRestrictions(now: Date = new Date()): Promise<UpaRestriction[]> {
    return db
        .select()
        .from(upaRestrictions)
        .where(and(eq(upaRestrictions.ativo, true), gt(upaRestrictions.restrictedUntil, now)))
        .orderBy(asc(upaRestrictions.restrictedUntil), asc(upaRestrictions.unitName));
}

/** Restrição vigente de uma unidade específica (null se livre). */
export async function findActiveRestriction(
    unitKey: string,
    now: Date = new Date()
): Promise<UpaRestriction | null> {
    const [row] = await db
        .select()
        .from(upaRestrictions)
        .where(
            and(
                eq(upaRestrictions.unitKey, unitKey),
                eq(upaRestrictions.ativo, true),
                gt(upaRestrictions.restrictedUntil, now)
            )
        )
        .limit(1);
    return row ?? null;
}

export class InvalidRestrictionDeadline extends Error {}

/**
 * Valida o prazo recebido do cliente. Precisa ser um instante futuro e dentro
 * do teto de sanidade — o resto (07:00/19:00 de hoje ou amanhã) é conveniência
 * da UI, não regra do servidor.
 */
export function parseRestrictionDeadline(raw: string, now: Date = new Date()): Date {
    const until = new Date(raw);
    if (Number.isNaN(until.getTime())) {
        throw new InvalidRestrictionDeadline("Prazo inválido.");
    }
    if (until.getTime() <= now.getTime()) {
        throw new InvalidRestrictionDeadline("O prazo precisa ser no futuro.");
    }
    if (until.getTime() - now.getTime() > MAX_RESTRICTION_DAYS * 24 * 60 * 60 * 1000) {
        throw new InvalidRestrictionDeadline(
            `Prazo longo demais (máximo ${MAX_RESTRICTION_DAYS} dias).`
        );
    }
    return until;
}

/**
 * Restringe uma UPA até o prazo. Se já houver restrição vigente para a unidade,
 * ESTENDE/ENCURTA a existente em vez de empilhar uma segunda — o painel e o bot
 * falam sempre de uma restrição por UPA.
 */
export async function restrictUnit(params: {
    unitKey: string;
    unitName: string;
    until: Date;
    autor: string;
    now?: Date;
}): Promise<{ row: UpaRestriction; renewed: boolean }> {
    const now = params.now ?? new Date();
    const existing = await findActiveRestriction(params.unitKey, now);

    if (existing) {
        const [row] = await db
            .update(upaRestrictions)
            .set({
                unitName: params.unitName,
                restrictedUntil: params.until,
                autor: params.autor,
                timestamp: now,
            })
            .where(eq(upaRestrictions.id, existing.id))
            .returning();
        return { row: row as UpaRestriction, renewed: true };
    }

    const [row] = await db
        .insert(upaRestrictions)
        .values({
            unitKey: params.unitKey,
            unitName: params.unitName,
            restrictedUntil: params.until,
            autor: params.autor,
        })
        .returning();
    return { row: row as UpaRestriction, renewed: false };
}

/** Liberação manual antes do prazo (também exige PIN na camada de rota). */
export async function liberateRestriction(
    id: number,
    removidoPor: string
): Promise<UpaRestriction | null> {
    const [row] = await db
        .update(upaRestrictions)
        .set({ ativo: false, removidoPor, removidoEm: new Date() })
        .where(and(eq(upaRestrictions.id, id), eq(upaRestrictions.ativo, true)))
        .returning();
    return row ?? null;
}

/**
 * Fecha as restrições cujo prazo passou. Devolve as que acabaram de vencer —
 * é o gatilho do aviso "voltou a receber" no grupo dos reguladores.
 */
export async function expireDueRestrictions(now: Date = new Date()): Promise<UpaRestriction[]> {
    const rows = await db
        .update(upaRestrictions)
        .set({ ativo: false, removidoPor: "prazo vencido", removidoEm: now })
        // lte() e não um fragmento sql cru: o operador tipado leva o mapper da
        // coluna timestamptz junto. Com `sql` a Date chegava sem tipo no
        // postgres.js e o tick quebrava a cada minuto (ERR_INVALID_ARG_TYPE).
        .where(and(eq(upaRestrictions.ativo, true), lte(upaRestrictions.restrictedUntil, now)))
        .returning();
    return rows;
}

// ── Formatação (usada nas mensagens do Telegram) ───────────────────────────

function dayKey(value: Date): string {
    return value.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

function hourLabel(value: Date): string {
    return value.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: TZ,
    });
}

/**
 * "hoje 19:00" / "amanhã 07:00" / "01/08 07:00" — sempre no fuso de Salvador,
 * nunca no fuso do servidor (o container roda em UTC).
 */
export function formatDeadline(until: Date, now: Date = new Date()): string {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const key = dayKey(until);
    const hour = hourLabel(until);

    if (key === dayKey(now)) return `hoje ${hour}`;
    if (key === dayKey(tomorrow)) return `amanhã ${hour}`;

    const day = until.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: TZ,
    });
    return `${day} ${hour}`;
}
