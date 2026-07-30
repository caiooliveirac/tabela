// ═══════════════════════════════════════════════════════════════
// Telegram do BOT REGULADOR (mesmo token do tabela-notifier).
//
// Dois destinos, propósitos diferentes:
//   • notifyAdmin      → privado do admin (TELEGRAM_ADMIN_CHAT_ID): PIN
//                        rotacionado, IP bloqueado. Nunca vai para o grupo.
//   • notifyReguladores→ grupo dos reguladores (TELEGRAM_REGULADORES_CHAT_ID):
//                        restrições de UPA. É o mesmo grupo onde o
//                        tabela-notifier despeja os casos aceitos/vaga zero.
//
// Cuidado: este é o bot REGULADOR. O bot Plantões SAMU é outro token, outro
// grupo e outro app (~/plantoes) — ver docs/upa-restricoes.md.
// ═══════════════════════════════════════════════════════════════

export function reguladoresChatId(): string {
    return (process.env.TELEGRAM_REGULADORES_CHAT_ID || "").trim();
}

async function sendHtml(chat: string, html: string, label: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chat) {
        console.warn(`[telegram] token/chat ausente — ${label} não enviado`);
        return false;
    }
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chat,
                text: html,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!d.ok) {
            console.error(`[telegram] sendMessage (${label}) falhou:`, d.description);
            return false;
        }
        return true;
    } catch (e) {
        console.error(`[telegram] erro ao enviar ${label}:`, e);
        return false;
    }
}

export async function notifyAdmin(html: string): Promise<void> {
    await sendHtml((process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim(), html, "alerta do admin");
}

/** Mensagem para o grupo dos reguladores. Retorna false se não conseguiu enviar. */
export async function notifyReguladores(html: string): Promise<boolean> {
    return sendHtml(reguladoresChatId(), html, "aviso aos reguladores");
}

export function escapeHtml(value: string | null | undefined): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
