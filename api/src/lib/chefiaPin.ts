// ═══════════════════════════════════════════════════════════════
// PIN da chefia — autorização para apagar/editar alertas de chefia
//
// O PIN é validado SEMPRE no servidor (client-side é contornável).
// Suporta janela de rotação: `CHEFIA_PIN` (atual) e `CHEFIA_PIN_PREV`
// (anterior, opcional) ficam válidos ao mesmo tempo, permitindo trocar
// o PIN sem travar quem ainda não recebeu o novo.
// ═══════════════════════════════════════════════════════════════
import { timingSafeEqual } from "node:crypto";

// PINs aceitos no momento (atual + anterior durante a rotação).
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
    // Sem short-circuit: sempre compara contra todos os PINs válidos.
    let ok = false;
    for (const valid of validPins()) {
        if (safeEqual(candidate, valid)) ok = true;
    }
    return ok;
}

// ── Rate limiting em memória por IP (anti brute-force) ──
const MAX_FAILURES = 5; // tentativas erradas antes de travar
const LOCK_MS = 60_000; // duração do bloqueio
const WINDOW_MS = 5 * 60_000; // janela de contagem de falhas

type Bucket = { fails: number; first: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

export function checkPinRateLimit(ip: string): { ok: boolean; retryAfterMs: number } {
    const b = buckets.get(ip);
    const now = Date.now();
    if (b && b.lockedUntil > now) {
        return { ok: false, retryAfterMs: b.lockedUntil - now };
    }
    return { ok: true, retryAfterMs: 0 };
}

export function registerPinFailure(ip: string): void {
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now - b.first > WINDOW_MS) {
        b = { fails: 0, first: now, lockedUntil: 0 };
    }
    b.fails += 1;
    if (b.fails >= MAX_FAILURES) {
        b.lockedUntil = now + LOCK_MS;
        b.fails = 0;
        b.first = now;
    }
    buckets.set(ip, b);
}

export function registerPinSuccess(ip: string): void {
    buckets.delete(ip);
}
