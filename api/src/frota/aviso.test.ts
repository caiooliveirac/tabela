import { test } from "node:test";
import assert from "node:assert/strict";
import { textoCobranca } from "./aviso.js";

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00-03:00`);
const d = { nome: "SM01", hospitalNome: "HGE", entrada: t("14:00") };

test("cobrança chama o médico pelo nome, com link do Acolhimentos (formatação do WhatsApp)", () => {
    const s = textoCobranca(d, "Fulano", t("14:45"));
    assert.match(s, /\*SM01\* presa no \*HGE\* há \*45 min\* \(chegou 14:00\)/);
    assert.match(s, /Dr\(a\)\. \*Fulano\*, por favor abra o aplicativo/);
    assert.match(s, /https:\/\/acolhimentos\.mnrs\.com\.br\//);
    assert.doesNotMatch(s, /<b>/);
    assert.match(s, /registre a demora para acolher o paciente/);
    assert.doesNotMatch(s, /maca/i);
});

test("dupla do Plantões vira dois nomes; sem nome, chama o médico da viatura", () => {
    assert.match(textoCobranca(d, "Fulano + Beltrano", t("14:45")), /Dr\(a\)\. \*Fulano\* e Dr\(a\)\. \*Beltrano\*/);
    assert.match(textoCobranca(d, null, t("14:45")), /Médico\(a\) da \*SM01\*/);
    assert.match(textoCobranca(d, "  ", t("14:45")), /Médico\(a\) da \*SM01\*/);
});

test("UPA leva artigo feminino; asterisco no nome não quebra o negrito", () => {
    const s = textoCobranca({ ...d, hospitalNome: "UPA Barris" }, "Ana *Maria*", t("14:50"));
    assert.match(s, /presa na \*UPA Barris\* há \*50 min\*/);
    assert.match(s, /Dr\(a\)\. \*Ana Maria\*/);
});

test("balanço agrupa por hospital, pior primeiro, e convida quem não registrou", async () => {
    const { textoBalanco } = await import("./aviso.js");
    const r = (codigo: string, hospital: string, minutos: number, extra = {}) => ({
        codigo, tipo: "USA", hospital, minutos, presa: false, semRegistro: false, medico: null, ...extra,
    });
    const s = textoBalanco(
        [
            r("SM01", "HGE", 130, { semRegistro: true, medico: "Fulano + Beltrano" }),
            r("CB02", "HGE", 95, { presa: true }),
            r("PR03", "Roberto Santos", 300),
            r("IT30", "HGE", 50, { tipo: "USB" }),
        ],
        { agora: t("07:00"), conferido: true, alertaMin: 40 },
    );
    assert.match(s, /plantão noturno · qua 30\/09/);
    assert.ok(s.indexOf("*HGE* — 3 viaturas") < s.indexOf("*Roberto Santos* — 1 viatura"));
    assert.match(s, /• SM01 \(USA\) · \*2h10\*\n• CB02 \(USA\) · \*1h35\* ⏳ ainda presa\n• IT30 \(USB\) · \*50 min\*/);
    assert.match(s, /• SM01 no HGE \(2h10\) — Dr\(a\)\. \*Fulano\* e Dr\(a\)\. \*Beltrano\*/);
    assert.match(s, /acolhimentos\.mnrs\.com\.br/);
});

test("balanço: diurno às 19h, plantão limpo, e sem convite quando o Acolhimentos não respondeu", async () => {
    const { textoBalanco } = await import("./aviso.js");
    assert.match(textoBalanco([], { agora: t("19:00"), conferido: true, alertaMin: 40 }), /plantão diurno · qui 01\/10[\s\S]*Nenhuma viatura/);
    const s = textoBalanco(
        [{ codigo: "SM01", tipo: "USA", hospital: "HGE", minutos: 60, presa: false, semRegistro: true, medico: null }],
        { agora: t("19:00"), conferido: false, alertaMin: 40 },
    );
    assert.doesNotMatch(s, /Acolhimentos/);
});
