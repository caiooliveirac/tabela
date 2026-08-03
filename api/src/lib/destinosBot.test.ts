import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    CHUNK_LIMIT,
    agregarDestinos,
    autorDaRegulacao,
    buildDestinosReply,
    buildDestinosText,
    chunkBlocks,
} from "./destinosBot.js";
import { fromWall, parsePeriodo } from "./periodo.js";
import type { EnvioRow, IntelRow } from "../services/metrics.js";

const AGORA = fromWall(2026, 7, 28, 20, 0);
const PERIODO = parsePeriodo("hoje", AGORA)!;

function envio(p: Partial<EnvioRow> & { hora: [number, number] }): EnvioRow {
    const [h, m] = p.hora;
    const dia = h < 7 ? 29 : 28; // depois da meia-noite ainda é o mesmo plantão
    return {
        hospitalId: p.hospitalId ?? "hge",
        timestamp: p.timestamp ?? fromWall(2026, 7, dia, h, m),
        situacao: p.situacao ?? "ACEITO",
        caso: p.caso ?? "TCE LEVE",
        mr: p.mr ?? "ANA",
        criadoPor: p.criadoPor ?? "ANA",
    };
}

function render(envios: EnvioRow[], intel: IntelRow[] = []): string {
    return buildDestinosText({ periodo: PERIODO, envios, intel });
}

describe("autorDaRegulacao", () => {
    it("usa mr quando preenchido", () => {
        assert.equal(autorDaRegulacao({ mr: "RAFAELA", criadoPor: "ANA" }), "RAFAELA");
    });

    it("cai para criadoPor quando mr está vazio", () => {
        assert.equal(autorDaRegulacao({ mr: "   ", criadoPor: "PAULO" }), "PAULO");
        assert.equal(autorDaRegulacao({ mr: null, criadoPor: "PAULO" }), "PAULO");
    });

    it("nunca fica sem autor", () => {
        assert.equal(autorDaRegulacao({ mr: null, criadoPor: "" }), "não informado");
    });
});

describe("agregarDestinos", () => {
    it("ordena do que mais recebeu para o que menos recebeu", () => {
        const blocks = agregarDestinos([
            envio({ hospitalId: "suburbio", hora: [8, 0] }),
            envio({ hospitalId: "hge", hora: [9, 0] }),
            envio({ hospitalId: "hge", hora: [10, 0] }),
            envio({ hospitalId: "hge", hora: [11, 0] }),
            envio({ hospitalId: "hgrs", hora: [12, 0] }),
            envio({ hospitalId: "hgrs", hora: [13, 0] }),
        ]);
        assert.deepEqual(
            blocks.map((b) => [b.hospitalId, b.total]),
            [
                ["hge", 3],
                ["hgrs", 2],
                ["suburbio", 1],
            ]
        );
    });

    it("separa SD (07–19h) de SN (19–07h)", () => {
        const [hge] = agregarDestinos([
            envio({ hora: [8, 0] }),
            envio({ hora: [18, 59] }),
            envio({ hora: [19, 0] }),
            envio({ hora: [2, 30] }),
        ]);
        const sd = hge.turnos.find((t) => t.turno === "SD")!;
        const sn = hge.turnos.find((t) => t.turno === "SN")!;
        assert.equal(sd.envios.length, 2);
        assert.equal(sn.envios.length, 2);
    });

    it("conta vaga zero à parte do total", () => {
        const [hge] = agregarDestinos([
            envio({ hora: [8, 0], situacao: "ZERO" }),
            envio({ hora: [9, 0], situacao: "ACEITO" }),
        ]);
        assert.deepEqual([hge.total, hge.zeros, hge.aceitos], [2, 1, 1]);
    });
});

describe("buildDestinosText", () => {
    it("período vazio responde sem inventar nada", () => {
        const out = render([]);
        assert.match(out, /Nenhum paciente regulado no período/);
    });

    it("lista o envio com horário, perfil e o nome de quem regulou em itálico", () => {
        const out = render([envio({ hora: [11, 40], caso: "CHOQUE ELETRICO", mr: "ANA" })]);
        assert.match(out, /11:40 · CHOQUE ELETRICO — <i>ANA<\/i>/);
    });

    it("marca vaga zero e mostra o cabeçalho de cada turno", () => {
        const out = render([envio({ hora: [20, 10], situacao: "ZERO" })]);
        assert.match(out, /🚫 20:10/);
        assert.match(out, /<b>SD<\/b> 07–19h · 0/);
        assert.match(out, /<b>SN<\/b> 19–07h · 1/);
    });

    it("escapa HTML vindo do banco (nome e quadro clínico são texto livre)", () => {
        const out = render([envio({ hora: [10, 0], caso: "TCE <grave> & choque", mr: "A<B>" })]);
        assert.match(out, /TCE &lt;grave&gt; &amp; choque/);
        assert.match(out, /<i>A&lt;B&gt;<\/i>/);
        // nenhuma tag inventada escapou para fora das que o formatador cria
        assert.equal(out.includes("<grave>"), false);
    });

    it("declara a lacuna de capacidade em vez de fingir que tem o dado", () => {
        const out = render([envio({ hora: [10, 0] })]);
        assert.match(out, /não registra leitos, capacidade nem motivo da vaga zero/);
        assert.match(out, /não há idade, sexo nem gravidade estruturados/);
    });

    it("não alerta com denominador pequeno demais (1 de 2 é ruído)", () => {
        const out = render([
            envio({ hospitalId: "suburbio", hora: [8, 0], situacao: "ZERO" }),
            envio({ hospitalId: "suburbio", hora: [9, 0], situacao: "ACEITO" }),
        ]);
        assert.match(out, /Nenhum indicador de lotação no período/);
    });

    it("alerta com 2 de 2 em vaga zero", () => {
        const out = render([
            envio({ hospitalId: "hgrs", hora: [8, 0], situacao: "ZERO" }),
            envio({ hospitalId: "hgrs", hora: [9, 0], situacao: "ZERO" }),
        ]);
        assert.match(out, /2 de 2 em vaga zero \(100%\)/);
    });

    it("alerta quando a taxa de vaga zero é alta", () => {
        const out = render([
            envio({ hospitalId: "suburbio", hora: [8, 0], situacao: "ZERO" }),
            envio({ hospitalId: "suburbio", hora: [9, 0], situacao: "ZERO" }),
            envio({ hospitalId: "suburbio", hora: [10, 0], situacao: "ACEITO" }),
        ]);
        assert.match(out, /ALERTAS DE LOTAÇÃO/);
        assert.match(out, /2 de 3 em vaga zero \(67%\)/);
        assert.match(out, /última vaga zero: 09:00/);
    });

    it("traz a intel de lotação com autor e nota escapados", () => {
        const out = render(
            [envio({ hospitalId: "hgrs", hora: [10, 0] })],
            [
                {
                    hospitalId: "hgrs",
                    tipo: "lotado",
                    nota: "SEM O2 & SEM MONITOR",
                    autor: "DR DJARIO",
                    timestamp: fromWall(2026, 7, 28, 14, 2),
                },
            ]
        );
        assert.match(out, /🔴 lotado — 14:02 por <i>DR DJARIO<\/i>/);
        assert.match(out, /SEM O2 &amp; SEM MONITOR/);
    });

    it("ignora intel que não é sinal de lotação", () => {
        const out = render(
            [envio({ hospitalId: "hgrs", hora: [10, 0] })],
            [
                {
                    hospitalId: "hgrs",
                    tipo: "pretendo_enviar",
                    nota: null,
                    autor: "X",
                    timestamp: fromWall(2026, 7, 28, 14, 2),
                },
            ]
        );
        assert.match(out, /Nenhum indicador de lotação no período/);
    });
});

describe("chunkBlocks", () => {
    it("mensagem curta sai inteira e sem numeração", () => {
        const partes = chunkBlocks(["linha 1", "linha 2"]);
        assert.deepEqual(partes, ["linha 1\n\nlinha 2"]);
    });

    it("respeita o limite e numera as partes", () => {
        const units = Array.from({ length: 400 }, (_, i) => `bloco ${i} com algum texto`);
        const partes = chunkBlocks(units);
        assert.ok(partes.length > 1);
        for (const p of partes) assert.ok(p.length <= CHUNK_LIMIT, `parte com ${p.length} chars`);
        assert.match(partes[0], /parte 1\/\d+/);
    });

    it("não corta um bloco ao meio", () => {
        const grande = "x".repeat(3000);
        const grupo = "<b>Eládio</b>\n  🚫 4 de 6 em vaga zero\n  ↳ última: 06:45";
        const partes = chunkBlocks([grande, grupo]);
        const comGrupo = partes.filter((p) => p.includes("Eládio"));
        assert.equal(comGrupo.length, 1);
        assert.match(comGrupo[0], /última: 06:45/);
    });

    it("quebra em linhas o bloco que sozinho estoura o limite", () => {
        const gigante = Array.from({ length: 300 }, (_, i) => `linha ${i} de um bloco enorme`).join("\n");
        const partes = chunkBlocks([gigante]);
        assert.ok(partes.length > 1);
        for (const p of partes) assert.ok(p.length <= CHUNK_LIMIT);
    });

    it("um relatório real de vários hospitais cabe nas partes", () => {
        const envios: EnvioRow[] = [];
        for (const h of ["hge", "hgrs", "suburbio", "municipal", "hgesf"]) {
            for (let i = 0; i < 20; i++) {
                envios.push(
                    envio({
                        hospitalId: h,
                        hora: [8 + (i % 10), i % 60],
                        caso: "POLITRAUMA COM INSTABILIDADE HEMODINÂMICA E SUSPEITA DE HIC",
                        mr: "REGULADOR DE NOME COMPRIDO",
                    })
                );
            }
        }
        const partes = buildDestinosReply({ periodo: PERIODO, envios, intel: [] });
        assert.ok(partes.length > 1);
        for (const p of partes) assert.ok(p.length <= CHUNK_LIMIT);
    });
});

describe("privacidade — o que nunca pode entrar no relatório", () => {
    it("services/metrics.ts não lê `oc` nem `medico`", () => {
        const src = readFileSync(new URL("../services/metrics.ts", import.meta.url), "utf8");
        const codigo = src
            .split("\n")
            .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
            .join("\n");
        assert.equal(codigo.includes("cases.oc"), false, "nº da ocorrência reidentifica o paciente");
        assert.equal(
            codigo.includes("cases.medico"),
            false,
            "`medico` é o médico que recebeu — não é o autor da regulação"
        );
    });

    it("o tipo EnvioRow não carrega oc nem medico", () => {
        const e = envio({ hora: [10, 0] });
        assert.equal("oc" in e, false);
        assert.equal("medico" in e, false);
    });
});
