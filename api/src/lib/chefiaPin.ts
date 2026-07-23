// ═══════════════════════════════════════════════════════════════
// PIN da chefia — autorização para apagar/editar alertas de chefia
//
// O PIN é validado SEMPRE no servidor (client-side é contornável).
// Suporta janela de rotação: `CHEFIA_PIN` (atual) e `CHEFIA_PIN_PREV`
// (anterior, opcional) ficam válidos ao mesmo tempo.
//
// Segurança: 5 PINs errados em pouco tempo (WINDOW_MS) => o IP é
// BLOQUEADO PERMANENTEMENTE (persistido em `chefia_pin_blocks`, sobrevive
// a restart) e o admin é avisado no Telegram. Desbloqueio manual via
// scripts/chefia-pin.sh.
// ═══════════════════════════════════════════════════════════════
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../index.js";
import { notifyAdmin } from "./telegram.js";

// ── Validação do PIN ──
function validPins(): string[] {
    return [process.env.CHEFIA_PIN, process.env.CHEFIA_PIN_PREV]
        .map((p) => (p ?? "").trim())
        .filter((p) => p.length > 0);
}

export function chefiaPinConfigured(): boolean {
    return validPins().length > 0;
}

// Comparação em tempo constante (evita timing side-channel).
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

export function verifyChefiaPin(pin: string): boolean {
    const candidate = (pin ?? "").trim();
    if (!candidate) return false;
    let ok = false; // sem short-circuit
    for (const valid of validPins()) {
        if (safeEqual(candidate, valid)) ok = true;
    }
    return ok;
}

// ── Bloqueio de IP (permanente, anti brute-force) ──
const MAX_FAILURES = 5; // erros em curto espaço antes de bloquear
const WINDOW_MS = 5 * 60_000; // "curto espaço" = 5 min

type Counter = { fails: number; first: number };
const counters = new Map<string, Counter>(); // contagem efêmera em memória
const blocked = new Set<string>(); // espelho em memória dos IPs bloqueados

// Cria a tabela (idempotente) e carrega os IPs já bloqueados. Chamar no boot.
export async function initChefiaSecurity(): Promise<void> {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS chefia_pin_blocks (
            ip text PRIMARY KEY,
            blocked_at timestamptz NOT NULL DEFAULT now(),
            attempts integer NOT NULL DEFAULT 0
        )
    `);
    const rows = (await db.execute(sql`SELECT ip FROM chefia_pin_blocks`)) as unknown as Array<{ ip: string }>;
    blocked.clear();
    for (const r of rows) blocked.add(r.ip);
    console.log(`🔒 Segurança do PIN pronta — ${blocked.size} IP(s) bloqueado(s) carregado(s)`);
}

export function isBlocked(ip: string): boolean {
    return blocked.has(ip);
}

// Registra um PIN errado. Ao atingir o limite, bloqueia o IP de vez e avisa o admin.
export async function registerPinFailure(ip: string): Promise<void> {
    if (blocked.has(ip)) return;
    const now = Date.now();
    let c = counters.get(ip);
    if (!c || now - c.first > WINDOW_MS) c = { fails: 0, first: now };
    c.fails += 1;
    counters.set(ip, c);

    if (c.fails >= MAX_FAILURES) {
        blocked.add(ip);
        counters.delete(ip);
        try {
            await db.execute(sql`
                INSERT INTO chefia_pin_blocks (ip, attempts) VALUES (${ip}, ${c.fails})
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
                `Para desbloquear no servidor:\n<code>cd ~/tabela &amp;&amp; ./scripts/chefia-pin.sh unblock ${ip}</code>`
        );
    }
}

export function registerPinSuccess(ip: string): void {
    counters.delete(ip);
}
