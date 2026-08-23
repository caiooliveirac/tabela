import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOCAIS, APELIDOS, normalizar, acharLocal } from "./locais.js";
import { HOSPITAIS_NA_FEATURE } from "./encaminhamento.js";

const naFeature = new Set<string>(HOSPITAIS_NA_FEATURE);
const porChave = new Map(LOCAIS.map((l) => [l.key, l]));

describe("locais — integridade do seed", () => {
    it("tem os lugares de Salvador, muito além dos bairros", () => {
        assert.ok(LOCAIS.length > 250, `só ${LOCAIS.length} lugares`);
        const tipos = new Set(LOCAIS.map((l) => l.tipo));
        for (const t of ["bairro", "largo", "estacao", "terminal", "referencia"])
            assert.ok(tipos.has(t as never), `nenhum lugar do tipo ${t}`);
    });

    it("nenhuma chave se repete", () => {
        assert.equal(porChave.size, LOCAIS.length);
    });

    it("a chave de cada lugar é o próprio nome normalizado", () => {
        for (const l of LOCAIS)
            assert.equal(l.key, normalizar(l.nome), `${l.nome} com chave divergente`);
    });

    it("todo lugar tem rota para os 7 hospitais, ou é declarado sem estrada", () => {
        for (const l of LOCAIS) {
            if (l.semRotaRodoviaria) {
                assert.equal(l.rotas, undefined, `${l.nome}: sem estrada não pode ter rota`);
                continue;
            }
            assert.equal(
                Object.keys(l.rotas ?? {}).length,
                HOSPITAIS_NA_FEATURE.length,
                `${l.nome} com rotas incompletas`,
            );
        }
    });

    it("as rotas só apontam para hospitais da feature", () => {
        for (const l of LOCAIS)
            for (const h of Object.keys(l.rotas ?? {}))
                assert.ok(naFeature.has(h), `${l.nome} tem rota para ${h}, fora da feature`);
    });

    it("as ilhas da baía continuam sem rota rodoviária", () => {
        const semEstrada = LOCAIS.filter((l) => l.semRotaRodoviaria).map((l) => l.nome);
        for (const ilha of ["Ilha de Maré", "Ilha de Bom Jesus dos Passos"])
            assert.ok(semEstrada.includes(ilha), `${ilha} deveria estar sem estrada`);
    });

    it("nenhum tempo é zero, negativo ou absurdo", () => {
        // Teto de 2h: dentro da RMS, qualquer coisa acima disso é dado corrompido.
        for (const l of LOCAIS)
            for (const [h, [s, m]] of Object.entries(l.rotas ?? {})) {
                assert.ok(s > 0 && s < 7200, `${l.nome}→${h}: ${s}s fora de faixa`);
                assert.ok(m > 0, `${l.nome}→${h}: ${m}m inválido`);
            }
    });

    it("toda coordenada cai na região de Salvador", () => {
        for (const l of LOCAIS) {
            assert.ok(l.lat > -13.2 && l.lat < -12.6, `${l.nome}: latitude ${l.lat}`);
            assert.ok(l.lng > -38.8 && l.lng < -38.2, `${l.nome}: longitude ${l.lng}`);
        }
    });
});

describe("locais — nomes que engoliriam a busca", () => {
    it("'salvador' não é um lugar buscável", () => {
        // Quase todo endereço digitado termina em "Salvador". Como a busca por
        // conteúdo prefere o termo mais longo, isso venceria a Pituba.
        assert.equal(porChave.has("salvador"), false);
        assert.equal(APELIDOS["salvador"], undefined);
    });

    it("'largo' sozinho não é um lugar buscável", () => {
        assert.equal(porChave.has("largo"), false);
    });

    it("endereço completo com a cidade no fim ainda acha o bairro", () => {
        const r = acharLocal("Rua Rio Grande do Sul, 200, Pituba, Salvador, BA");
        assert.equal(r.length, 1);
        assert.equal(r[0].nome, "Pituba");
    });
});

describe("locais — apelidos", () => {
    it("todo apelido aponta para um lugar que existe", () => {
        for (const [apelido, alvo] of Object.entries(APELIDOS))
            assert.ok(porChave.has(alvo), `apelido ${apelido} aponta para ${alvo}, inexistente`);
    });

    it("nenhum apelido colide com o nome de um lugar real", () => {
        for (const apelido of Object.keys(APELIDOS))
            assert.equal(porChave.has(apelido), false, `${apelido} é apelido e lugar ao mesmo tempo`);
    });

    it("Iguatemi continua achando o Shopping da Bahia", () => {
        assert.equal(acharLocal("Iguatemi")[0]?.nome, "Shopping da Bahia");
    });

    it("apelido funciona dentro de um endereço, não só sozinho", () => {
        assert.equal(acharLocal("em frente ao iguatemi")[0]?.nome, "Shopping da Bahia");
    });

    it("apelido leva o mesmo destino que o nome real", () => {
        assert.equal(acharLocal("CAB")[0]?.key, acharLocal("Centro Administrativo da Bahia")[0]?.key);
    });
});

describe("locais — normalização", () => {
    it("tira acento, caixa e pontuação", () => {
        assert.equal(normalizar("São Caetano"), "sao caetano");
        assert.equal(normalizar("  sao   caetano.  "), "sao caetano");
        assert.equal(normalizar("Águas Claras"), "aguas claras");
    });

    it("texto vazio ou só pontuação vira string vazia", () => {
        assert.equal(normalizar(""), "");
        assert.equal(normalizar("  ---  "), "");
    });
});

describe("locais — busca do que o regulador digita", () => {
    it("acha por nome exato, com ou sem acento", () => {
        assert.equal(acharLocal("Pituba")[0]?.nome, "Pituba");
        assert.equal(acharLocal("itapua")[0]?.nome, "Itapuã");
        assert.equal(acharLocal("BROTAS")[0]?.nome, "Brotas");
    });

    it("o nome mais longo vence o mais curto contido nele", () => {
        const r = acharLocal("Boa Vista de Brotas");
        assert.equal(r.length, 1);
        assert.equal(r[0].nome, "Boa Vista de Brotas");
    });

    it("acha estação e terminal, não só bairro", () => {
        assert.equal(acharLocal("Estação Mussurunga")[0]?.tipo, "terminal");
        assert.ok(["estacao", "terminal"].includes(acharLocal("Acesso Norte")[0]?.tipo));
    });

    it("acha largo", () => {
        assert.equal(acharLocal("Largo da Barroquinha")[0]?.tipo, "largo");
    });

    it("acha por prefixo, para quem ainda está digitando", () => {
        assert.ok(acharLocal("pitub").some((l) => l.nome === "Pituba"));
    });

    it("texto vazio ou desconhecido não devolve nada", () => {
        assert.deepEqual(acharLocal("   "), []);
        assert.deepEqual(acharLocal("zzzzqqqq"), []);
    });

    it("povoado de ilha é encontrado, para o módulo poder explicar", () => {
        const r = acharLocal("Ilha de Maré");
        assert.equal(r[0]?.nome, "Ilha de Maré");
        assert.equal(r[0]?.semRotaRodoviaria, true);
    });
});
