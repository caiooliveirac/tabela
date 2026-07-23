// ═══════════════════════════════════════════════════════════════
// Bot de comandos da chefia (Telegram) — roda DENTRO da API.
// Responde SOMENTE ao ADMIN (TELEGRAM_ADMIN_CHAT_ID). Comandos:
//   /menu         → botões
//   /resetpin     → cria PIN novo e apaga os antigos; mostra bloqueados
//   /bloqueados   → lista IPs bloqueados com botões numerados p/ desbloquear
// Usa long-polling (getUpdates). O notifier só ENVIA, então não há conflito.
// ═══════════════════════════════════════════════════════════════
import { resetPin, listBlocks, unblock } from "../lib/chefiaPin.js";

const token = () => process.env.TELEGRAM_BOT_TOKEN || "";
const admin = () => Number(process.env.TELEGRAM_ADMIN_CHAT_ID || 0);

async function tg(method: string, body: unknown): Promise<any> {
    const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return r.json().catch(() => ({}));
}

async function sendAdmin(text: string, extra: Record<string, unknown> = {}): Promise<void> {
    await tg("sendMessage", {
        chat_id: admin(),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
    });
}

const menuKeyboard = {
    inline_keyboard: [
        [{ text: "🔄 Resetar PIN", callback_data: "reset" }],
        [{ text: "🚫 Ver bloqueados", callback_data: "blocks" }],
    ],
};

async function showBlocks(): Promise<void> {
    const list = await listBlocks();
    if (!list.length) {
        await sendAdmin("✅ Nenhum IP bloqueado no momento.");
        return;
    }
    const lines = list.map((b, i) => {
        const quando = new Date(b.blocked_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        return `${i + 1}. <code>${b.ip}</code> — ${quando} (${b.attempts} erros)`;
    });
    const buttons = list.map((b, i) => ({ text: String(i + 1), callback_data: `ub:${b.ip}` }));
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
    await sendAdmin(
        "🚫 <b>IPs bloqueados</b>\n" + lines.join("\n") + "\n\nToque no número para desbloquear:",
        { reply_markup: { inline_keyboard: rows } }
    );
}

async function doReset(): Promise<void> {
    const novo = await resetPin();
    await sendAdmin(
        `🔐 <b>PIN resetado</b>\n\n` +
            `Novo PIN (único válido agora): <b>${novo}</b>\n` +
            `Todos os PINs anteriores foram <b>invalidados</b>.\n\n` +
            `Repasse ao grupo da chefia.`
    );
    await showBlocks();
}

async function handle(u: any): Promise<void> {
    if (u.message) {
        if (Number(u.message.from?.id) !== admin()) return; // só o admin
        const t = String(u.message.text || "").trim().toLowerCase();
        if (["/start", "/menu", "/pin", "/chefia"].includes(t)) {
            await sendAdmin("🔧 <b>Gestão do PIN da chefia</b>", { reply_markup: menuKeyboard });
        } else if (["/resetpin", "/reset"].includes(t)) {
            await doReset();
        } else if (["/bloqueados", "/blocks"].includes(t)) {
            await showBlocks();
        } else {
            await sendAdmin("Comandos: /resetpin · /bloqueados · /menu", { reply_markup: menuKeyboard });
        }
    } else if (u.callback_query) {
        const cq = u.callback_query;
        await tg("answerCallbackQuery", { callback_query_id: cq.id });
        if (Number(cq.from?.id) !== admin()) return; // só o admin
        const data = String(cq.data || "");
        if (data === "reset") await doReset();
        else if (data === "blocks") await showBlocks();
        else if (data.startsWith("ub:")) {
            const ip = data.slice(3);
            await unblock(ip);
            await sendAdmin(`✅ IP <code>${ip}</code> desbloqueado.`);
            await showBlocks();
        }
    }
}

let offset = 0;

async function loop(): Promise<void> {
    for (;;) {
        try {
            const r = await tg("getUpdates", { timeout: 30, offset });
            if (r.ok && Array.isArray(r.result)) {
                for (const u of r.result) {
                    offset = u.update_id + 1;
                    await handle(u).catch((e) => console.error("[bot] handle:", e));
                }
            } else if (r.description) {
                console.error("[bot] getUpdates:", r.description);
                await new Promise((res) => setTimeout(res, 3000));
            }
        } catch (e) {
            console.error("[bot] loop:", e);
            await new Promise((res) => setTimeout(res, 3000));
        }
    }
}

export function startChefiaBot(): void {
    if (!token() || !admin()) {
        console.warn("[bot] TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID ausente — bot de comandos não iniciado");
        return;
    }
    (async () => {
        // Garante que não há webhook e descarta backlog de updates antigos.
        await tg("deleteWebhook", { drop_pending_updates: true });
        const first = await tg("getUpdates", { timeout: 0, offset: -1 });
        if (first.ok && first.result?.length) offset = first.result[first.result.length - 1].update_id + 1;
        console.log("🤖 Bot da chefia ativo (Telegram) — /menu no privado");
        loop();
    })();
}
