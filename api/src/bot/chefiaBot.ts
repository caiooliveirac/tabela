// ═══════════════════════════════════════════════════════════════
// Bot de comandos do BOT REGULADOR (Telegram) — roda DENTRO da API.
//
// Comandos do ADMIN, só no privado (TELEGRAM_ADMIN_CHAT_ID):
//   /menu         → botões
//   /resetpin     → cria PIN novo e apaga os antigos; mostra bloqueados
//   /bloqueados   → lista IPs bloqueados com botões numerados p/ desbloquear
//   /destinos     → para onde os pacientes foram regulados, por turno SD/SN
//
// Comando aberto, no grupo dos reguladores (TELEGRAM_REGULADORES_CHAT_ID):
//   /upas         → UPAs restritas agora e até quando
//
// ⚠️ /destinos mostra dado de paciente (quadro clínico) e nome de regulador.
// A checagem `from.id !== admin()` em handle() — depois do desvio do /upas, que
// é o único comando aberto — é o que garante que isso só sai no privado do
// admin. Chat não autorizado é ignorado EM SILÊNCIO: responder "sem permissão"
// já denunciaria a existência do relatório.
//
// ATENÇÃO: este é o ÚNICO consumidor de getUpdates deste token. O
// tabela-notifier só ENVIA, por isso não há conflito — mas qualquer novo
// poller no mesmo token roubaria updates deste aqui. Comando novo do lado
// regulador entra NESTE arquivo. (O bot Plantões SAMU é outro token, outro
// app e usa webhook — ver docs/upa-restricoes.md.)
// ═══════════════════════════════════════════════════════════════
import { resetPin, listBlocks, unblock } from "../lib/chefiaPin.js";
import { buildDestinosReply, destinosHelp } from "../lib/destinosBot.js";
import { parsePeriodo } from "../lib/periodo.js";
import { loadDestinosData } from "../services/metrics.js";
import { listActiveRestrictions } from "../services/upa-restrictions.js";
import { buildUpasCommandReply } from "../lib/upaRestrictionsBot.js";

const token = () => process.env.TELEGRAM_BOT_TOKEN || "";
const admin = () => Number(process.env.TELEGRAM_ADMIN_CHAT_ID || 0);
const reguladores = () => (process.env.TELEGRAM_REGULADORES_CHAT_ID || "").trim();

// A rede do contêiner até a api.telegram.org falha em rajadas (ETIMEDOUT).
// getUpdates é long-poll (timeout: 30s) — teto maior e sem retry aqui, o loop
// já reitera; envios ganham retry com backoff pra não perder aviso/comando.
async function tg(method: string, body: unknown): Promise<any> {
    const isPoll = method === "getUpdates";
    const attempts = isPoll ? 1 : 3;
    for (let i = 1; ; i++) {
        try {
            const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(isPoll ? 45_000 : 15_000),
            });
            return await r.json().catch(() => ({}));
        } catch (e) {
            if (i >= attempts) throw e;
            await new Promise((res) => setTimeout(res, 1_000 * 4 ** (i - 1)));
        }
    }
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
        [{ text: "🏥 UPAs restritas", callback_data: "upas" }],
        [
            { text: "🚑 Destinos hoje", callback_data: "dest:hoje" },
            { text: "📆 Ontem", callback_data: "dest:ontem" },
            { text: "🗓 7 dias", callback_data: "dest:7d" },
        ],
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

/**
 * Normaliza o comando: no grupo o Telegram entrega "/upas@nome_do_bot".
 * Devolve só o verbo, em minúsculas, sem argumentos.
 */
function commandOf(text: string): string {
    const first = String(text || "").trim().split(/\s+/)[0] ?? "";
    return first.split("@")[0]!.toLowerCase();
}

/** Argumentos do comando: "/destinos@ReguladorSAMU_bot 7d" → ["7d"]. */
function argsOf(text: string): string[] {
    return String(text || "").trim().toLowerCase().split(/\s+/).slice(1);
}

/** /upas — aberto a qualquer um no grupo dos reguladores e ao admin no privado. */
async function replyUpas(chatId: number | string, replyTo?: number): Promise<void> {
    const now = new Date();
    const rows = await listActiveRestrictions(now);
    await tg("sendMessage", {
        chat_id: chatId,
        text: buildUpasCommandReply(rows, now),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });
}

/** /destinos [hoje|ontem|7d] — quem foi regulado para onde, por turno. */
async function showDestinos(arg: string | undefined, quemPediu: unknown): Promise<void> {
    const periodo = parsePeriodo(arg, new Date());
    if (!periodo) {
        await sendAdmin(destinosHelp());
        return;
    }
    // Auditoria mínima: permite responder "quem tirou esse relatório" se um
    // print aparecer onde não devia. Fica no docker logs.
    console.log(`[destinos] período=${periodo.key} por chat_id=${String(quemPediu)}`);
    const { envios, intel } = await loadDestinosData(periodo.start, periodo.end);
    const partes = buildDestinosReply({ periodo, envios, intel });
    for (const p of partes) await sendAdmin(p);
}

async function handle(u: any): Promise<void> {
    if (u.message) {
        const chatId = String(u.message.chat?.id ?? "");
        const cmd = commandOf(u.message.text || "");

        // /upas é o único comando aberto — e só no grupo configurado.
        if (cmd === "/upas" && reguladores() && chatId === reguladores()) {
            await replyUpas(u.message.chat.id, u.message.message_id);
            return;
        }

        if (Number(u.message.from?.id) !== admin()) return; // resto: só o admin
        const t = String(u.message.text || "").trim().toLowerCase();
        const args = argsOf(u.message.text || "");
        if (cmd === "/upas") {
            await replyUpas(admin());
        } else if (["/start", "/menu", "/pin", "/chefia"].includes(t)) {
            await sendAdmin("🔧 <b>Gestão da chefia</b>", { reply_markup: menuKeyboard });
        } else if (["/resetpin", "/reset"].includes(t)) {
            await doReset();
        } else if (["/bloqueados", "/blocks"].includes(t)) {
            await showBlocks();
        } else if (["/destinos", "/destino"].includes(cmd)) {
            await showDestinos(args[0], u.message.from?.id);
        } else {
            await sendAdmin("Comandos: /resetpin · /bloqueados · /upas · /destinos · /menu", {
                reply_markup: menuKeyboard,
            });
        }
    } else if (u.callback_query) {
        const cq = u.callback_query;
        await tg("answerCallbackQuery", { callback_query_id: cq.id });
        if (Number(cq.from?.id) !== admin()) return; // só o admin
        const data = String(cq.data || "");
        if (data === "reset") await doReset();
        else if (data === "blocks") await showBlocks();
        else if (data === "upas") await replyUpas(admin());
        else if (data.startsWith("dest:")) await showDestinos(data.slice(5), cq.from?.id);
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
    let failures = 0;
    for (;;) {
        try {
            const r = await tg("getUpdates", { timeout: 30, offset });
            failures = 0;
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
            failures++;
            const wait = Math.min(3_000 * 2 ** (failures - 1), 60_000);
            console.error(`[bot] loop (falha ${failures}, aguardando ${wait / 1000}s):`, e);
            await new Promise((res) => setTimeout(res, wait));
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
