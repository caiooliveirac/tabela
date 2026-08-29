import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { consumir, type Janela } from "./limitePorIp.js";

const CURTA: Janela = { limite: 3, ms: 10_000 };
const HORA: Janela = { limite: 5, ms: 100_000 };

const baldes = () => ({
    curta: { contagem: 0, abreEm: 0 },
    hora: { contagem: 0, abreEm: 0 },
});

describe("limite por IP — consumir", () => {
    it("deixa passar até o limite da janela curta e barra a seguinte", () => {
        const b = baldes();
        for (let i = 0; i < 3; i++) assert.equal(consumir(b, 1000, CURTA, HORA), null);
        const aguarde = consumir(b, 1000, CURTA, HORA);
        // A janela curta abriu em t=0 e fecha em t=10000: faltam 9s.
        assert.equal(aguarde, 9);
    });

    it("janela curta zera com o tempo, mas a horária continua contando", () => {
        const b = baldes();
        for (let i = 0; i < 3; i++) consumir(b, 0, CURTA, HORA);
        // Curta renovou; ainda há saldo na horária (3 de 5).
        assert.equal(consumir(b, 10_000, CURTA, HORA), null);
        assert.equal(consumir(b, 10_001, CURTA, HORA), null);
        // 5ª consulta gastou a horária: barra até t=100000.
        const aguarde = consumir(b, 20_000, CURTA, HORA);
        assert.equal(aguarde, 80);
    });

    it("bloqueado não consome saldo: a espera não se alonga sozinha", () => {
        const b = baldes();
        for (let i = 0; i < 3; i++) consumir(b, 0, CURTA, HORA);
        consumir(b, 1, CURTA, HORA);
        consumir(b, 2, CURTA, HORA);
        assert.equal(b.hora.contagem, 3, "tentativa barrada não conta na horária");
    });

    it("depois de tudo expirar, volta ao zero", () => {
        const b = baldes();
        for (let i = 0; i < 5; i++) consumir(b, 0, CURTA, HORA);
        assert.equal(consumir(b, 200_000, CURTA, HORA), null);
    });
});
