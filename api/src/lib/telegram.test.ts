import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { editarChat, enviarChat } from "./telegram.js";

const fetchOriginal = globalThis.fetch;
let chamadas = 0;

function falhaDeRede(code: string): TypeError {
    return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
}

function stub(respostas: Array<Error | object>) {
    chamadas = 0;
    globalThis.fetch = (async () => {
        const r = respostas[chamadas++];
        if (r instanceof Error) throw r;
        return new Response(JSON.stringify(r));
    }) as typeof fetch;
}

beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "teste";
});
afterEach(() => {
    globalThis.fetch = fetchOriginal;
});

test("conexão que não abriu: tenta de novo e entrega", async () => {
    stub([falhaDeRede("ETIMEDOUT"), { ok: true, result: { message_id: 42 } }]);
    assert.equal(await enviarChat("-1", "oi"), 42);
    assert.equal(chamadas, 2);
});

test("edição também tenta de novo", async () => {
    stub([falhaDeRede("ECONNREFUSED"), { ok: true }]);
    assert.equal(await editarChat("-1", 7, "oi"), true);
    assert.equal(chamadas, 2);
});

test("erro depois de conectar não repete (o envio pode ter saído)", async () => {
    stub([falhaDeRede("ECONNRESET"), { ok: true, result: { message_id: 42 } }]);
    assert.equal(await enviarChat("-1", "oi"), null);
    assert.equal(chamadas, 1);
});

test("só uma nova tentativa", async () => {
    stub([falhaDeRede("ETIMEDOUT"), falhaDeRede("ETIMEDOUT"), { ok: true, result: { message_id: 42 } }]);
    assert.equal(await enviarChat("-1", "oi"), null);
    assert.equal(chamadas, 2);
});

test("recusa do Telegram (ok: false) não repete", async () => {
    stub([{ ok: false, description: "Bad Request: chat not found" }]);
    assert.equal(await enviarChat("-1", "oi"), null);
    assert.equal(chamadas, 1);
});
