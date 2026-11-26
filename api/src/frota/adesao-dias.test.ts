import assert from "node:assert/strict";
import { test } from "node:test";
import { diasDaAdesao } from "./periodo.js";

test("adesão: dias de 1 a 184, padrão 14", () => {
    assert.equal(diasDaAdesao(undefined), 14);
    assert.equal(diasDaAdesao("abc"), 14);
    assert.equal(diasDaAdesao("0"), 14);
    assert.equal(diasDaAdesao("-3"), 1);
    assert.equal(diasDaAdesao("31"), 31);
    assert.equal(diasDaAdesao("90"), 90);
    assert.equal(diasDaAdesao("999"), 184);
    assert.equal(diasDaAdesao("7.9"), 7);
});
