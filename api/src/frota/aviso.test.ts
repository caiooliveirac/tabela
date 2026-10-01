import { test } from "node:test";
import assert from "node:assert/strict";
import { textoCobranca, type DadosAviso } from "./aviso.js";

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00-03:00`);
const d: DadosAviso = { nome: "SM01", tipo: "USA", hospitalNome: "HGE", entrada: t("14:00"), ultimaVez: t("14:44") };

test("cobrança chama o médico pelo nome, com link do Acolhimentos", () => {
    const s = textoCobranca(d, "Fulano", "aberta", t("14:45"));
    assert.match(s, /<b>SM01<\/b> presa no <b>HGE<\/b> há <b>45 min<\/b> \(entrou 14:00\)/);
    assert.match(s, /Dr\(a\)\. <b>Fulano<\/b>, por favor abra o aplicativo/);
    assert.match(s, /acolhimentos\.mnrs\.com\.br/);
});

test("dupla do Plantões vira dois nomes; sem nome, chama o médico da viatura", () => {
    assert.match(textoCobranca(d, "Fulano + Beltrano", "aberta", t("14:45")), /Dr\(a\)\. <b>Fulano<\/b> e Dr\(a\)\. <b>Beltrano<\/b>/);
    assert.match(textoCobranca(d, null, "aberta", t("14:45")), /Médico\(a\) da <b>SM01<\/b>/);
});

test("nome com HTML é escapado", () => {
    assert.match(textoCobranca(d, "<x>", "aberta", t("14:45")), /&lt;x&gt;/);
});

test("registrada e saída sem registro", () => {
    assert.match(textoCobranca(d, null, "registrada", t("15:00")), /✅ .*registrada no Acolhimentos/);
    assert.match(textoCobranca({ ...d, hospitalNome: "UPA Barris" }, null, "saiu-sem-registro", t("15:10")), /saiu da <b>UPA Barris<\/b> às 15:10 .*\(70 min\)/);
});
