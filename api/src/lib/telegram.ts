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

/**
 * Mensagem ao grupo dos reguladores que depois é EDITADA (aviso de viatura
 * parada no hospital: uma mensagem por parada, atualizada até a liberação).
 * Retorna o message_id, ou null se não enviou.
 */
export async function enviarReguladores(html: string): Promise<number | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = reguladoresChatId();
    if (!token || !chat) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
        if (!d.ok || !d.result?.message_id) {
            console.error("[telegram] envio aos reguladores falhou:", d.description);
            return null;
        }
        return d.result.message_id;
    } catch (e) {
        console.error("[telegram] erro ao enviar aos reguladores:", e);
        return null;
    }
}

export async function editarReguladores(messageId: number, html: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = reguladoresChatId();
    if (!token || !chat) return false;
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chat, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        // "message is not modified" não é erro: o texto já estava assim.
        if (!d.ok && !/not modified/i.test(d.description ?? "")) {
            console.error("[telegram] edição aos reguladores falhou:", d.description);
            return false;
        }
        return true;
    } catch (e) {
        console.error("[telegram] erro ao editar aviso:", e);
        return false;
    }
}
