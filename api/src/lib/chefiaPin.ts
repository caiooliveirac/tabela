// ═══════════════════════════════════════════════════════════════
// PIN da chefia — autorização para apagar/editar alertas de chefia
//
// PINs válidos vivem no BANCO (tabela chefia_pins) — fonte única, lida ao
// vivo. Assim o bot do Telegram e o script podem resetar/rotacionar o PIN
// sem reiniciar a API. Na primeira subida a tabela é semeada a partir do
// .env (CHEFIA_PIN / CHEFIA_PIN_PREV), migrando do modelo antigo.
//
// Segurança: 5 PINs errados em pouco tempo => IP BLOQUEADO PERMANENTEMENTE
// (chefia_pin_blocks, lido ao vivo) e o admin é avisado no Telegram.
// ═══════════════════════════════════════════════════════════════
import { timingSafeEqual, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { notifyAdmin } from "./telegram.js";

type Row = Record<string, unknown>;
async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await db.execute(query)) as unknown as Row[];
}

// Cria as tabelas (idempotente) e semeia os PINs a partir do .env se vazio.
export async function initChefiaSecurity(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS chefia_pins (
            id serial PRIMARY KEY,
            pin text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS chefia_pin_blocks (
            ip text PRIMARY KEY,
            blocked_at timestamptz NOT NULL DEFAULT now(),
            attempts integer NOT NULL DEFAULT 0
        )
    `);

    const [{ n: nPins }] = (await rows(sql`SELECT count(*)::int AS n FROM chefia_pins`)) as Array<{ n: number }>;
    if (nPins === 0) {
        const seed = [process.env.CHEFIA_PIN, process.env.CHEFIA_PIN_PREV]
            .map((p) => (p ?? "").trim())
            .filter((p) => p.length > 0);
        for (const p of seed) await db.execute(sql`INSERT INTO chefia_pins (pin) VALUES (${p})`);
        if (seed.length) console.log(`🔑 chefia_pins semeado do .env (${seed.length} PIN)`);
    }

    const [{ n: pins }] = (await rows(sql`SELECT count(*)::int AS n FROM chefia_pins`)) as Array<{ n: number }>;
    const [{ n: blocks }] = (await rows(sql`SELECT count(*)::int AS n FROM chefia_pin_blocks`)) as Array<{ n: number }>;
    console.log(`🔒 Segurança do PIN pronta — ${pins} PIN(s) válido(s), ${blocks} IP(s) bloqueado(s)`);
}

async function validPins(): Promise<string[]> {
    return (await rows(sql`SELECT pin FROM chefia_pins`)).map((r) => String(r.pin));
}

export async function chefiaPinConfigured(): Promise<boolean> {
    return (await validPins()).length > 0;
}

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

export async function verifyChefiaPin(pin: string): Promise<boolean> {
    const candidate = (pin ?? "").trim();
    if (!candidate) return false;
    let ok = false; // sem short-circuit
    for (const valid of await validPins()) {
        if (safeEqual(candidate, valid)) ok = true;
    }
    return ok;
}

// Reset "duro": apaga TODOS os PINs e cria um novo de 6 dígitos. Retorna o novo.
export async function resetPin(): Promise<string> {
    const novo = String(randomInt(100000, 1000000));
    await db.execute(sql`DELETE FROM chefia_pins`);
    await db.execute(sql`INSERT INTO chefia_pins (pin) VALUES (${novo})`);
    return novo;
}

// Rotação "suave": cria um novo e mantém apenas os 2 mais recentes (janela de 1 troca).
export async function rotatePin(): Promise<{ novo: string; anteriores: string[] }> {
    const anteriores = await validPins();
    const novo = String(randomInt(100000, 1000000));
    await db.execute(sql`INSERT INTO chefia_pins (pin) VALUES (${novo})`);
    await db.execute(sql`
        DELETE FROM chefia_pins
        WHERE id NOT IN (SELECT id FROM chefia_pins ORDER BY created_at DESC, id DESC LIMIT 2)
    `);
    return { novo, anteriores };
}

// ── Bloqueio de IP (permanente) ──
const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60_000;
type Counter = { fails: number; first: number };
const counters = new Map<string, Counter>();

export async function isBlocked(ip: string): Promise<boolean> {
    return (await rows(sql`SELECT 1 FROM chefia_pin_blocks WHERE ip = ${ip} LIMIT 1`)).length > 0;
}

export async function listBlocks(): Promise<Array<{ ip: string; blocked_at: string; attempts: number }>> {
    return (await rows(
        sql`SELECT ip, blocked_at, attempts FROM chefia_pin_blocks ORDER BY blocked_at DESC`
    )) as Array<{ ip: string; blocked_at: string; attempts: number }>;
}

export async function unblock(ip: string): Promise<void> {
    await db.execute(sql`DELETE FROM chefia_pin_blocks WHERE ip = ${ip}`);
}

// Registra um PIN errado; ao atingir o limite, bloqueia o IP e avisa o admin.
export async function registerPinFailure(ip: string): Promise<void> {
    if (await isBlocked(ip)) return;
    const now = Date.now();
    let c = counters.get(ip);
    if (!c || now - c.first > WINDOW_MS) c = { fails: 0, first: now };
    c.fails += 1;
    counters.set(ip, c);

    if (c.fails >= MAX_FAILURES) {
        counters.delete(ip);
        try {
            await db.execute(sql`
                INSERT INTO chefia_pin_blocks (ip, attempts) VALUES (${ip}, ${MAX_FAILURES})
                ON CONFLICT (ip) DO NOTHING
            `);
        } catch (e) {
            console.error("[chefiaPin] falha ao persistir bloqueio:", e);
        }
        await notifyAdmin(
            `🚫 <b>IP BLOQUEADO — PIN da chefia</b>\n\n` +
                `Um computador errou o PIN <b>${MAX_FAILURES}x</b> em poucos minutos e foi <b>bloqueado permanentemente</b>.\n\n` +
                `🖥️ IP: <code>${ip}</code>\n` +
                `🕒 ${new Date().toISOString()}\n\n` +
                `Desbloqueie pelo bot: /bloqueados`
        );
    }
}

export function registerPinSuccess(ip: string): void {
    counters.delete(ip);
}
