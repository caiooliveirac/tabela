import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAIS_FROTA } from "./hospitais.js";
import { montarRetencao, perfilDo, type ParadaRetencaoBruta } from "./retencao.js";

const t = (dia: string, hhmm: string) => new Date(`2026-10-${dia}T${hhmm}:00-03:00`);
const de = t("09", "00:00");
const ate = t("12", "00:00");
const descrever = (chave: string) => ({ nome: chave, tipo: chave.startsWith("SM") ? "USA" : "USB", base: "BASE" });
const parada = (chave: string, hospitalId: string, entrada: Date, min: number, extra: Partial<ParadaRetencaoBruta> = {}): ParadaRetencaoBruta => ({
    chave, hospitalId, entrada, fim: new Date(entrada.getTime() + min * 60_000), naBase: false, motivoFim: "saiu",
    lat: null, lng: null, ocColetas: 5, livreColetas: 0, ...extra,
});
const idx = (id: string) => LOCAIS_FROTA.findIndex((h) => h.id === id);

test("perfil: categoria do painel; privado só na frota; UPA e PA são upa", () => {
    const perfil = (id: string) => perfilDo(LOCAIS_FROTA.find((h) => h.id === id)!);
    assert.equal(perfil("hge"), "geral");
    assert.equal(perfil("juliano_moreira"), "psiq");
    assert.equal(perfil("couto_maia"), "infecto");
    assert.equal(perfil("aristides_maltez"), "privado");
    assert.equal(perfil("upa_brotas"), "upa");
    assert.equal(perfil("cs_imbassahy"), "upa");
});

test("retenção: base, menos de 10 min e fora do período ficam fora; o resto em ordem de entrada", () => {
    const r = montarRetencao(
        [
            parada("CB27", "hge", t("10", "08:00"), 25),
            parada("SM17", "hge", t("09", "15:10"), 100),
            parada("CB27", "hge", t("09", "17:00"), 9),
            parada("SM17", "upa_brotas", t("09", "18:00"), 90, { naBase: true }),
            parada("SM17", "hge", t("12", "00:00"), 50),
            parada("SM17", "mario_leal", t("10", "10:00"), 50),
        ],
        LOCAIS_FROTA, descrever, de, ate,
    );
    const hge = idx("hge");
    assert.deepEqual(r.viaturas, [
        { nome: "CB27", tipo: "USB", base: "BASE" },
        { nome: "SM17", tipo: "USA", base: "BASE" },
    ]);
    assert.deepEqual(r.paradas, [
        [Math.floor(t("09", "15:10").getTime() / 60_000), 100, hge, 1, 0, 0],
        [Math.floor(t("10", "08:00").getTime() / 60_000), 25, hge, 0, 0, 0],
    ]);
    assert.equal(r.alertaMin, 40);
    assert.equal(r.locais[hge].perfil, "geral");
});

test("situação e fim: livre, sem dado do mapa, aberta e sem sinal", () => {
    const r = montarRetencao(
        [
            parada("CB01", "hge", t("09", "10:00"), 30, { ocColetas: 0, livreColetas: 4 }),
            parada("CB01", "hge", t("09", "11:00"), 30, { ocColetas: 0, livreColetas: 0 }),
            parada("CB01", "hge", t("09", "12:00"), 30, { motivoFim: null }),
            parada("CB01", "hge", t("09", "13:00"), 30, { motivoFim: "sem-sinal" }),
        ],
        LOCAIS_FROTA, descrever, de, ate,
    );
    assert.deepEqual(r.paradas.map((p) => [p[4], p[5]]), [[1, 0], [2, 0], [0, 1], [0, 2]]);
});

test("porta declarada: parada travada no vizinho conta no dono da porta", () => {
    const r = montarRetencao(
        [parada("CB01", "upa_cabula", t("09", "10:00"), 45, { lat: -12.95609, lng: -38.45056 })],
        LOCAIS_FROTA, descrever, de, ate,
    );
    assert.equal(r.paradas[0][2], idx("hgrs"));
});
