import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoDoPosto, responsavelDe } from "./equipe.js";

const escala = new Map([
    ["SM01", [{ nome: "Ana Paula Mendes", nomeCurto: "Ana Mendes", categoria: "MEDICO" }, { nome: "Rui Souza", nomeCurto: "Rui Souza", categoria: "TECNICO_ENFERMAGEM" }]],
    ["BR60", [{ nome: "Carla Lima", nomeCurto: "Carla Lima", categoria: "TECNICO_ENFERMAGEM" }, { nome: "João Dias", nomeCurto: "João Dias", categoria: "CONDUTOR" }]],
]);

test("posto da escala casa com o código do catálogo", () => {
    assert.equal(codigoDoPosto("SM-01"), "SM01");
    assert.equal(codigoDoPosto("cn-10"), "CN10");
});

test("USA: a chegada na Mesa vence a escala", () => {
    assert.deepEqual(responsavelDe("USA", "SM01", new Map([["SM01", "Bento"]]), escala), { nome: "Bento", funcao: "médico", fonte: "mesa" });
    assert.deepEqual(responsavelDe("USA", "SM01", new Map(), escala), { nome: "Ana Mendes", funcao: "médico", fonte: "escala" });
});

test("USB: o técnico da escala, nunca o condutor", () => {
    assert.deepEqual(responsavelDe("USB", "BR60", new Map(), escala), { nome: "Carla Lima", funcao: "técnico", fonte: "escala" });
});

test("sem fonte, sem nome", () => {
    assert.equal(responsavelDe("USB", "CZ53", new Map(), escala), null);
    assert.equal(responsavelDe("MOTO", "MT06", new Map(), escala), null);
    assert.equal(responsavelDe("USA", null, new Map(), escala), null);
});
