import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOSPITALS } from "./score.js";
import {
    PERFIS,
    HOSPITAIS_NA_FEATURE,
    encaminhar,
    nomeHospital,
    COORDENADAS_HOSPITAIS,
    PerfilDesconhecido,
} from "./encaminhamento.js";

const ids = (r: { hospitalId: string }[]) => r.map((x) => x.hospitalId).sort();
const naFeature = new Set<string>(HOSPITAIS_NA_FEATURE);

describe("encaminhamento — integridade da config", () => {
    it("todo destino é um hospital que existe no painel", () => {
        const conhecidos = new Set(HOSPITALS.map((h) => h.id));
        for (const p of PERFIS)
            for (const d of p.destinos)
                assert.ok(conhecidos.has(d), `${p.id} aponta para hospital inexistente: ${d}`);
    });

    it("nenhum perfil aponta para hospital fora da feature", () => {
        for (const p of PERFIS)
            for (const d of p.destinos)
                assert.ok(naFeature.has(d), `${p.id} aponta para ${d}, que não participa`);
    });

    it("ressalva só existe para hospital que é destino do perfil", () => {
        for (const p of PERFIS)
            for (const h of Object.keys(p.ressalvas ?? {}))
                assert.ok(p.destinos.includes(h), `${p.id}: ressalva de ${h}, que não é destino`);
    });

    it("nenhum perfil fica sem destino", () => {
        for (const p of PERFIS) assert.ok(p.destinos.length > 0, `${p.id} sem destino`);
    });

    it("id de perfil não se repete", () => {
        assert.equal(new Set(PERFIS.map((p) => p.id)).size, PERFIS.length);
    });

    it("todo hospital da feature serve de destino a pelo menos um perfil", () => {
        for (const id of HOSPITAIS_NA_FEATURE)
            assert.ok(
                PERFIS.some((p) => p.destinos.includes(id)),
                `${id} está na feature mas não é destino de nada`,
            );
    });
});

describe("encaminhamento — universo de 7 hospitais", () => {
    it("Menandro, psiquiátricos e Couto Maia não participam", () => {
        for (const fora of ["menandro", "juliano_moreira", "mario_leal", "couto_maia"])
            assert.ok(!naFeature.has(fora), `${fora} deveria estar fora da feature`);
    });

    it("os que ficaram de fora continuam existindo no painel", () => {
        const painel = new Set(HOSPITALS.map((h) => h.id));
        for (const fora of ["menandro", "juliano_moreira", "mario_leal", "couto_maia"])
            assert.ok(painel.has(fora));
    });

    it("cada perfil parte os 7 em elegíveis e excluídos, sem sobra nem repetição", () => {
        for (const p of PERFIS) {
            const { elegiveis, excluidos } = encaminhar(p.id);
            assert.equal(
                elegiveis.length + excluidos.length,
                HOSPITAIS_NA_FEATURE.length,
                `${p.id} não cobre todos os hospitais da feature`,
            );
            assert.equal(
                new Set([...ids(elegiveis), ...ids(excluidos)]).size,
                HOSPITAIS_NA_FEATURE.length,
                `${p.id} repetiu hospital`,
            );
        }
    });

    it("quem não participa nunca aparece no resultado, nem como excluído", () => {
        for (const p of PERFIS) {
            const { elegiveis, excluidos } = encaminhar(p.id);
            for (const h of [...ids(elegiveis), ...ids(excluidos)])
                assert.ok(naFeature.has(h), `${p.id} devolveu ${h}, que não participa`);
        }
    });

    it("todo excluído sai com motivo preenchido", () => {
        for (const p of PERFIS)
            for (const e of encaminhar(p.id).excluidos)
                assert.ok(e.motivo.length > 0, `${p.id}/${e.hospitalId} sem motivo`);
    });

    it("o motivo preserva as siglas clínicas do rótulo", () => {
        const e = encaminhar("iam_com_supra").excluidos[0];
        assert.match(e.motivo, /IAM com supra/);
    });

    it("perfil inexistente é erro, não lista vazia", () => {
        assert.throws(() => encaminhar("nao_existe"), PerfilDesconhecido);
    });
});

describe("encaminhamento — vetos que a regulação ditou", () => {
    it("trauma: HGE, Subúrbio, Municipal e Metropolitano", () => {
        assert.deepEqual(ids(encaminhar("trauma").elegiveis), [
            "hge",
            "metropolitano",
            "municipal",
            "suburbio",
        ]);
    });

    it("Roberto Santos nunca recebe trauma, em nenhuma forma", () => {
        for (const p of PERFIS.filter((p) => p.id.startsWith("trauma") || p.id.startsWith("fratura")))
            assert.ok(!p.destinos.includes("hgrs"), `hgrs entrou em ${p.id}`);
    });

    it("Ernesto não recebe trauma, mas faz vascular fora de trauma", () => {
        assert.ok(!encaminhar("trauma").elegiveis.some((e) => e.hospitalId === "hgesf"));
        assert.ok(!encaminhar("trauma_vascular").elegiveis.some((e) => e.hospitalId === "hgesf"));
        assert.ok(encaminhar("cirurgico_vascular").elegiveis.some((e) => e.hospitalId === "hgesf"));
    });

    it("Municipal é bloqueado em todo perfil cardiológico", () => {
        for (const p of ["iam_com_supra", "iam_sem_supra", "cardiologico"])
            assert.ok(!encaminhar(p).elegiveis.some((e) => e.hospitalId === "municipal"), p);
    });

    it("Metropolitano fica no IAM sem supra e sai do com supra — não tem hemodinâmica", () => {
        assert.ok(encaminhar("iam_sem_supra").elegiveis.some((e) => e.hospitalId === "metropolitano"));
        assert.ok(!encaminhar("iam_com_supra").elegiveis.some((e) => e.hospitalId === "metropolitano"));
    });

    it("Metropolitano sai de todo perfil vascular e de fratura exposta", () => {
        for (const p of ["trauma_vascular", "cirurgico_vascular", "fratura_exposta"])
            assert.ok(!encaminhar(p).elegiveis.some((e) => e.hospitalId === "metropolitano"), p);
    });

    it("Metropolitano fica fora dos dois perfis pediátricos", () => {
        for (const p of ["trauma_pediatrico", "clinica_pediatrica"])
            assert.ok(!encaminhar(p).elegiveis.some((e) => e.hospitalId === "metropolitano"), p);
    });

    it("HGE só aparece em trauma e queimado", () => {
        const com = PERFIS.filter((p) => p.destinos.includes("hge")).map((p) => p.id).sort();
        assert.deepEqual(com, [
            "fratura_exposta",
            "queimado",
            "trauma",
            "trauma_pediatrico",
            "trauma_vascular",
        ]);
    });

    it("IAM com supra é só o Roberto — exige hemodinâmica", () => {
        assert.deepEqual(ids(encaminhar("iam_com_supra").elegiveis), ["hgrs"]);
    });

    it("fratura cirúrgica pediátrica é só o Subúrbio", () => {
        assert.deepEqual(ids(encaminhar("fratura_cirurgica_pediatrica").elegiveis), ["suburbio"]);
    });

    it("trauma vascular é Subúrbio e HGE", () => {
        assert.deepEqual(ids(encaminhar("trauma_vascular").elegiveis), ["hge", "suburbio"]);
    });

    it("queimado é sempre HGE", () => {
        assert.deepEqual(ids(encaminhar("queimado").elegiveis), ["hge"]);
    });

    it("AVC exclui HGE e Ernesto (sem neurocirurgia)", () => {
        const fora = encaminhar("avc").excluidos.map((e) => e.hospitalId);
        assert.ok(fora.includes("hge") && fora.includes("hgesf"));
    });

    it("Municipal em trauma vem com a ressalva de ortopedia", () => {
        const m = encaminhar("trauma").elegiveis.find((e) => e.hospitalId === "municipal");
        assert.match(m!.ressalva!, /ortopédico/);
    });

    it("Metropolitano em trauma avisa o que não faz", () => {
        const m = encaminhar("trauma").elegiveis.find((e) => e.hospitalId === "metropolitano");
        assert.match(m!.ressalva!, /fratura exposta/);
    });

    it("urgência dialítica: Metropolitano, Ernesto, Subúrbio e Roberto", () => {
        assert.deepEqual(ids(encaminhar("urgencia_dialitica").elegiveis), [
            "hgesf",
            "hgrs",
            "metropolitano",
            "suburbio",
        ]);
    });

    it("Eládio faz cirúrgico não-trauma, mas segue fora de todo trauma", () => {
        assert.ok(encaminhar("cirurgico_nao_trauma").elegiveis.some((e) => e.hospitalId === "eladio"));
        assert.ok(!encaminhar("trauma").elegiveis.some((e) => e.hospitalId === "eladio"));
    });

    it("Roberto entra em clínico de alta complexidade", () => {
        assert.ok(encaminhar("clinico_alta_complexidade").elegiveis.some((e) => e.hospitalId === "hgrs"));
    });

    it("Ernesto entra em crônico, sepse ou paliação", () => {
        assert.ok(encaminhar("cronico_sepse_paliacao").elegiveis.some((e) => e.hospitalId === "hgesf"));
    });

    it("nomeHospital devolve o nome do painel", () => {
        assert.equal(nomeHospital("hgrs"), "HGRS");
    });
});

describe("encaminhamento — coordenadas", () => {
    it("todo hospital da feature tem coordenada", () => {
        for (const id of HOSPITAIS_NA_FEATURE)
            assert.ok(COORDENADAS_HOSPITAIS[id], `${id} sem coordenada`);
    });

    it("não sobra coordenada de hospital fora da feature", () => {
        for (const id of Object.keys(COORDENADAS_HOSPITAIS))
            assert.ok(naFeature.has(id), `${id} tem coordenada mas não participa`);
    });

    it("toda coordenada cai na região de Salvador", () => {
        // Caixa generosa em volta da RMS. Pega dígito trocado ou sinal perdido,
        // que jogaria o hospital no hemisfério norte ou no meio do Atlântico.
        for (const [id, c] of Object.entries(COORDENADAS_HOSPITAIS)) {
            assert.ok(c.lat > -13.2 && c.lat < -12.6, `${id}: latitude fora da RMS (${c.lat})`);
            assert.ok(c.lng > -38.7 && c.lng < -38.2, `${id}: longitude fora da RMS (${c.lng})`);
        }
    });

    it("nenhuma coordenada se repete", () => {
        const chaves = Object.values(COORDENADAS_HOSPITAIS).map((c) => `${c.lat},${c.lng}`);
        assert.equal(new Set(chaves).size, chaves.length, "dois hospitais no mesmo ponto");
    });

    it("toda coordenada registra o endereço conferido", () => {
        for (const [id, c] of Object.entries(COORDENADAS_HOSPITAIS))
            assert.ok(c.endereco.length > 10, `${id} sem endereço`);
    });
});
