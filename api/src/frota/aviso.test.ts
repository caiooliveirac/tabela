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
