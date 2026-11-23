import { test } from "node:test";
import assert from "node:assert/strict";
import { categoriaDoPapel, codigoDoPosto, equipeDe, responsavelDe, type Informado } from "./equipe.js";

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

test("equipe: médico da Mesa no lugar do escalado, depois enfermagem e condutor; sem fonte, vazia", () => {
    const escala = new Map([["SM01", [
        { nome: "Condutor Exemplo", categoria: "CONDUTOR" },
        { nome: "Médica Escalada", categoria: "MEDICO" },
        { nome: "Técnica Exemplo", nomeCurto: "Técnica", categoria: "TECNICO_ENFERMAGEM" },
    ]]]);
    assert.deepEqual(equipeDe("USA", "SM01", new Map([["SM01", "Médico Mesa"]]), escala).map((m) => [m.nome, m.funcao, m.fonte]), [
        ["Médico Mesa", "Médico(a)", "mesa"],
        ["Técnica", "Técnico(a) de enfermagem", "escala"],
        ["Condutor Exemplo", "Condutor(a)", "escala"],
    ]);
    assert.equal(equipeDe("USA", "SM01", new Map(), escala)[0].nome, "Médica Escalada");
    assert.deepEqual(equipeDe("USB", "SM02", new Map(), escala), []);
    assert.deepEqual(equipeDe("USA", null, new Map(), escala), []);
});

test("informado vence a escala (regra 7): Relatório > Mesa > Quadro > escala; falta informada é falta", () => {
    const escala = new Map([["SM01", [
        { nome: "Médica Escalada", categoria: "MEDICO" },
        { nome: "Enfermeira Escalada", categoria: "ENFERMEIRO" },
        { nome: "Condutor Escalado", categoria: "CONDUTOR" },
    ]], ["SM02", [{ nome: "Técnica Escalada", categoria: "TECNICO_ENFERMAGEM" }]]]);
    const info = new Map<string, Informado[]>([
        ["SM01", [
            { categoria: "MEDICO", nome: "Médico Quadro", fonte: "quadro" },
            { categoria: "ENFERMEIRO", nome: "Enfermeiro Quadro", fonte: "quadro" },
            { categoria: "ENFERMEIRO", nome: "Enfermeira Chefia", fonte: "relatorio" },
            { categoria: "CONDUTOR", nome: null, fonte: "relatorio" },
        ]],
        ["SM02", [{ categoria: "TECNICO_ENFERMAGEM", nome: "Técnico Quadro", fonte: "quadro" }]],
    ]);
    const mesa = new Map([["SM01", "Médico Mesa"]]);
    const eq = (m: Map<string, string>) => equipeDe("USA", "SM01", m, escala, info).map((x) => [x.categoria, x.nome, x.fonte]);
    assert.deepEqual(eq(mesa), [
        ["MEDICO", "Médico Mesa", "mesa"],
        ["ENFERMEIRO", "Enfermeira Chefia", "relatorio"],
        ["CONDUTOR", null, "relatorio"],
    ]);
    // Sem chegada na Mesa: o Quadro vence a escala.
    assert.deepEqual(eq(new Map())[0], ["MEDICO", "Médico Quadro", "quadro"]);
    // Relatório com o médico confirmado vence a Mesa.
    const comRel = new Map(info);
    comRel.set("SM01", [...info.get("SM01")!, { categoria: "MEDICO", nome: "Médico Relatório", fonte: "relatorio" }]);
    assert.deepEqual(equipeDe("USA", "SM01", mesa, escala, comRel)[0].nome, "Médico Relatório");
    // Responsável da USB: o técnico informado no Quadro, não o da escala.
    assert.deepEqual(responsavelDe("USB", "SM02", new Map(), escala, info), { nome: "Técnico Quadro", funcao: "técnico", fonte: "quadro" });
    // Sem informado, a escala segue marcada como escala.
    assert.equal(responsavelDe("USB", "SM02", new Map(), escala)?.fonte, "escala");
});

test("papel do Quadro vira categoria", () => {
    assert.deepEqual(["Médico(a)", "Enfermeiro(a)", "TE", "Téc. enf.", "Condutor(a)", "Motorista", "Rádio"].map(categoriaDoPapel),
        ["MEDICO", "ENFERMEIRO", "TECNICO_ENFERMAGEM", "TECNICO_ENFERMAGEM", "CONDUTOR", "CONDUTOR", null]);
});
