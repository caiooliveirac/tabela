import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BAIRROS, normalizar, acharBairro } from "./bairros.js";
import { HOSPITAIS_NA_FEATURE } from "./encaminhamento.js";

const naFeature = new Set<string>(HOSPITAIS_NA_FEATURE);

describe("bairros — integridade do seed", () => {
    it("tem os 183 bairros de Salvador", () => {
        assert.equal(BAIRROS.length, 183);
    });

    it("nenhuma chave se repete", () => {
        assert.equal(new Set(BAIRROS.map((b) => b.key)).size, BAIRROS.length);
    });

    it("a chave de cada bairro é o próprio nome normalizado", () => {
        for (const b of BAIRROS)
            assert.equal(b.key, normalizar(b.nome), `${b.nome} com chave divergente`);
    });

    it("todo bairro tem rota para os 7 hospitais, ou é ilha declarada", () => {
        for (const b of BAIRROS) {
            if (b.semRotaRodoviaria) {
                assert.equal(b.rotas, undefined, `${b.nome}: ilha não pode ter rota`);
                continue;
            }
            assert.equal(
                Object.keys(b.rotas ?? {}).length,
                HOSPITAIS_NA_FEATURE.length,
                `${b.nome} com rotas incompletas`,
            );
        }
    });

    it("as rotas só apontam para hospitais da feature", () => {
        for (const b of BAIRROS)
            for (const h of Object.keys(b.rotas ?? {}))
                assert.ok(naFeature.has(h), `${b.nome} tem rota para ${h}, fora da feature`);
    });

    it("as três ilhas da baía estão marcadas sem rota rodoviária", () => {
        const ilhas = BAIRROS.filter((b) => b.semRotaRodoviaria).map((b) => b.nome).sort();
        assert.deepEqual(ilhas, [
            "Ilha de Bom Jesus dos Passos",
            "Ilha de Maré",
            "Ilha dos Frades / Ilha de Santo Antônio",
        ]);
    });

    it("nenhum tempo é zero, negativo ou absurdo", () => {
        // Teto de 2h: dentro da RMS, qualquer coisa acima disso é dado corrompido.
        for (const b of BAIRROS)
            for (const [h, [s, m]] of Object.entries(b.rotas ?? {})) {
                assert.ok(s > 0 && s < 7200, `${b.nome}→${h}: ${s}s fora de faixa`);
                assert.ok(m > 0, `${b.nome}→${h}: ${m}m inválido`);
            }
    });

    it("toda coordenada cai na região de Salvador", () => {
        for (const b of BAIRROS) {
            assert.ok(b.lat > -13.2 && b.lat < -12.6, `${b.nome}: latitude ${b.lat}`);
            assert.ok(b.lng > -38.8 && b.lng < -38.2, `${b.nome}: longitude ${b.lng}`);
        }
    });
});

describe("bairros — normalização", () => {
    it("tira acento, caixa e pontuação", () => {
        assert.equal(normalizar("São Caetano"), "sao caetano");
        assert.equal(normalizar("SÃO CAETANO"), "sao caetano");
        assert.equal(normalizar("  sao   caetano.  "), "sao caetano");
        assert.equal(normalizar("Águas Claras"), "aguas claras");
        assert.equal(normalizar("Nordeste de Amaralina"), "nordeste de amaralina");
    });

    it("texto vazio ou só pontuação vira string vazia", () => {
        assert.equal(normalizar(""), "");
        assert.equal(normalizar("  ---  "), "");
    });
});

describe("bairros — busca do que o regulador digita", () => {
    it("acha por nome exato, com ou sem acento", () => {
        assert.equal(acharBairro("Pituba")[0]?.nome, "Pituba");
        assert.equal(acharBairro("pituba")[0]?.nome, "Pituba");
        assert.equal(acharBairro("BROTAS")[0]?.nome, "Brotas");
    });

    it("acha o bairro dentro de um endereço completo", () => {
        const r = acharBairro("Rua Rio Grande do Sul, 200, Pituba");
        assert.equal(r.length, 1);
        assert.equal(r[0].nome, "Pituba");
    });

    it("acha por prefixo, para quem ainda está digitando", () => {
        const r = acharBairro("pitub");
        assert.ok(r.some((b) => b.nome === "Pituba"));
    });

    it("texto vazio não devolve nada", () => {
        assert.deepEqual(acharBairro("   "), []);
    });

    it("texto sem bairro nenhum não devolve nada", () => {
        assert.deepEqual(acharBairro("zzzzqqqq"), []);
    });

    it("ilha é encontrada pelo nome, para o módulo poder explicar", () => {
        const r = acharBairro("Ilha de Maré");
        assert.equal(r[0]?.nome, "Ilha de Maré");
        assert.equal(r[0]?.semRotaRodoviaria, true);
    });
});
