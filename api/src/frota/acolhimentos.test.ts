import { test } from "node:test";
import assert from "node:assert/strict";
import { ABERTA_MAX_MS, cruzar, inicioBusca, type Acolhimento } from "./acolhimentos.js";

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00-03:00`);
const agora = t("18:00");
const desde = new Date(agora.getTime() - 3_600_000); // linhaDoTempo(1), a da cobrança

const parada = (entrada: string, aberta = true, naBase = false) => ({
    id: 1, chave: "SM01", hospitalId: "hge", entrada: t(entrada).toISOString(), fim: agora.toISOString(), aberta, naBase,
});
const notificada: Acolhimento = {
    id: "a1", unidade: "SM01", hospital: "hge", status: "open", vagaZero: false,
    chegada: t("14:05").toISOString(), passagem: null, liberada: null, totalS: null, motivos: [], retencoes: [],
};
/** Como o serviço do Acolhimentos responde: só quem tem chegada no período. */
const servico = (todas: Acolhimento[], ini: Date) =>
    todas.filter((a) => Date.parse(a.chegada!) >= ini.getTime() && Date.parse(a.chegada!) < agora.getTime());

test("USA presa há 4 h com notificação feita na chegada não perde o registro (não é cobrada)", () => {
    const paradas = [parada("14:00")];
    // Antes: a busca ia só até desde − 2 h (15:00) e a notificação das 14:05 sumia.
    assert.equal(servico([notificada], new Date(desde.getTime() - ABERTA_MAX_MS)).length, 0);
    const ini = inicioBusca(desde, paradas);
    assert.equal(ini.toISOString(), t("12:00").toISOString());
    const { casadas } = cruzar(paradas, servico([notificada], ini), agora.getTime());
    assert.equal(casadas.get(1)?.id, "a1");
});

test("parada fechada ou na base não puxa a busca para trás; parada recente mantém desde − 2 h", () => {
    const padrao = new Date(desde.getTime() - ABERTA_MAX_MS).toISOString();
    assert.equal(inicioBusca(desde, [parada("08:00", false)]).toISOString(), padrao);
    assert.equal(inicioBusca(desde, [parada("08:00", true, true)]).toISOString(), padrao);
    assert.equal(inicioBusca(desde, [parada("17:30")]).toISOString(), padrao);
    assert.equal(inicioBusca(desde, []).toISOString(), padrao);
});
