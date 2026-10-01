// ═══════════════════════════════════════════════════════════════
// Telegram do BOT REGULADOR (mesmo token do tabela-notifier).
//
// Dois destinos, propósitos diferentes:
//   • notifyAdmin      → privado do admin (TELEGRAM_ADMIN_CHAT_ID): PIN
//                        rotacionado, IP bloqueado. Nunca vai para o grupo.
//   • notifyReguladores→ grupo dos reguladores (TELEGRAM_REGULADORES_CHAT_ID):
//                        restrições de UPA. É o mesmo grupo onde o
//                        tabela-notifier despeja os casos aceitos/vaga zero.
//   • enviarChat/editarChat → avisos da frota, no grupo TELEGRAM_FROTA_CHAT_ID
//                        (api/src/frota/README.md).
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

/** Grupo dos avisos da frota (parada 40 min, sem sinal, bateria, resumo do plantão). */
export function frotaChatId(): string {
    return (process.env.TELEGRAM_FROTA_CHAT_ID || "").trim();
}

/** Grupo SAMU - Salvador (médicos das viaturas): cobrança da denúncia de USA presa. Vazio = não cobra. */
export function salvadorChatId(): string {
    return (process.env.TELEGRAM_SALVADOR_CHAT_ID || "").trim();
}

/**
 * Mensagem que depois pode ser EDITADA ou respondida (avisos da frota: uma
 * mensagem por parada ou queda de sinal). Com `respondeA`, sai como resposta
 * — a edição não notifica ninguém, a resposta sim. Retorna o message_id, ou
 * null se não enviou.
 */
export async function enviarChat(chat: string, html: string, respondeA?: number | null): Promise<number | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chat) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chat,
                text: html,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...(respondeA ? { reply_parameters: { message_id: respondeA, allow_sending_without_reply: true } } : {}),
            }),
            signal: AbortSignal.timeout(15_000),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
        if (!d.ok || !d.result?.message_id) {
            console.error(`[telegram] envio ao chat ${chat} falhou:`, d.description);
            return null;
        }
        return d.result.message_id;
    } catch (e) {
        console.error(`[telegram] erro ao enviar ao chat ${chat}:`, e);
        return null;
    }
}

export async function editarChat(chat: string, messageId: number, html: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chat) return false;
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chat, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
            signal: AbortSignal.timeout(15_000),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        // "message is not modified" não é erro: o texto já estava assim.
        if (!d.ok && !/not modified/i.test(d.description ?? "")) {
            console.error(`[telegram] edição no chat ${chat} falhou:`, d.description);
            return false;
        }
        return true;
    } catch (e) {
        console.error("[telegram] erro ao editar aviso:", e);
        return false;
    }
}
