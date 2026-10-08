import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO } from "./catalogo.js";
import { instanteMapa, ocorrenciaDe, porCodigo, receberOcorrencias, vigiarMapa } from "./ocorrencias.js";
import { linhaOcorrencia, textoAviso } from "./aviso.js";

const t = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00-03:00`);
const ocorrencia = {
    protocolo: "202610070787", medico: "FULANA DE TAL", status: "CHEGADA AO HOSPITAL",
    statusEm: "07/10/2026 15:59:58", abertura: "07/10/2026 15:39:35", risco: "Vermelho", regulacaoSecundaria: false,
    endereco: "Rua Tal, 10", bairro: "Brotas", queixa: "DOR TORÁCICA", hma: "HISTÓRIA CLÍNICA",
};
const envio = {
    equipes: [
        { equipe: "SM 01 (A)", ocorrencia },
        { equipe: "CZ 53 (8h)", ocorrencia: null },
        { equipe: "MT 07 /MT 07 A", ocorrencia: null },
    ],
};

test("data do mapa é hora da Bahia", () => {
    assert.equal(instanteMapa("07/10/2026 15:59:58"), "2026-10-07T18:59:58.000Z");
    assert.equal(instanteMapa(""), null);
    assert.equal(instanteMapa(null), null);
});

test("nome da equipe no mapa vira código do catálogo; moto fica fora", () => {
    const m = porCodigo(envio, CATALOGO);
    assert.deepEqual([...m.keys()].sort(), ["CZ53", "SM01"]);
    assert.equal(m.get("SM01")?.ocorrencia?.medico, "FULANA DE TAL");
    assert.equal(m.get("SM01")?.ocorrencia?.statusEm, "2026-10-07T18:59:58.000Z");
    assert.equal(m.get("CZ53")?.ocorrencia, null);
});

test("envio velho (coletor parado) não afirma nada; viatura fora do mapa também não", () => {
    receberOcorrencias(envio, CATALOGO, t("16:00"));
    assert.ok(ocorrenciaDe("SM01", t("16:04"))?.ocorrencia);
    assert.deepEqual(ocorrenciaDe("CZ53", t("16:04")), { ocorrencia: null });
    assert.equal(ocorrenciaDe("PM41", t("16:04")), null);
    assert.equal(ocorrenciaDe("SM01", t("16:06")), null);
});

test("aviso dos 40 min diz se está em ocorrência e com qual MR", () => {
    const d = { nome: "SM01", tipo: "USA", hospitalNome: "HGE", entrada: t("15:59"), ultimaVez: t("16:40") };
    const m = porCodigo(envio, CATALOGO);
    const com = textoAviso({ ...d, ocorrencia: m.get("SM01") }, { tipo: "parada", minutos: 41 });
    // Queixa, endereço e HMA ficam no painel; no grupo, não.
    assert.doesNotMatch(com, /DOR TORÁCICA|Rua Tal|Brotas|HISTÓRIA/);
    assert.match(com, /🚑 <b>em ocorrência<\/b> 202610070787 · MR <b>Fulana De Tal<\/b>\nchegada ao hospital às 15:59\n<a /);
    const livre = textoAviso({ ...d, ocorrencia: m.get("CZ53") }, { tipo: "parada", minutos: 41 });
    assert.match(livre, /🟢 <b>sem ocorrência<\/b> no mapa de equipes\n<a /);
    // Sem informação, o aviso é o de sempre.
    assert.equal(linhaOcorrencia(null), "");
    assert.doesNotMatch(textoAviso(d, { tipo: "parada", minutos: 41 }), /ocorrência/);
});

test("ponte muda há 10 min avisa o admin uma vez; na volta, outra", () => {
    receberOcorrencias(envio, CATALOGO, t("17:00"));
    assert.equal(vigiarMapa(t("17:08")), null);
    assert.match(vigiarMapa(t("17:10"))!, /sem dados<\/b> desde 17:00/);
    assert.equal(vigiarMapa(t("17:30")), null);
    receberOcorrencias(envio, CATALOGO, t("17:45"));
    assert.match(vigiarMapa(t("17:46"))!, /voltou<\/b> às 17:45 — 45 min sem dados/);
    assert.equal(vigiarMapa(t("17:48")), null);
});
