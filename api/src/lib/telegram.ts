// ═══════════════════════════════════════════════════════════════
// Alertas via Telegram para o ADMIN (privado).
// Usa o mesmo bot do notificador (TELEGRAM_BOT_TOKEN) e envia para o
// chat privado do admin (TELEGRAM_ADMIN_CHAT_ID) — NÃO para o grupo.
// ═══════════════════════════════════════════════════════════════

export async function notifyAdmin(html: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chat) {
        console.warn("[telegram] TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID ausente — alerta não enviado");
        return;
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
        if (!d.ok) console.error("[telegram] sendMessage falhou:", d.description);
    } catch (e) {
        console.error("[telegram] erro ao enviar alerta:", e);
    }
}
