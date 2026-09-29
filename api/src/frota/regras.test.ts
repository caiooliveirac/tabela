import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO, DESATIVADAS_ATE_SEGUNDA_ORDEM } from "./catalogo.js";
import { HOSPITAIS_FROTA } from "./hospitais.js";
import {
    avancarPermanencias, distanciaM, duracaoMin, hospitalNoRaio, instanteSamu,
    situacao, vincular, type Permanencia,
} from "./regras.js";
import { lerDispositivos, lerPosicoes } from "./samumais.js";
import { leiturasParaPermanencia, montarPainel, resolverPosicoes } from "./painel.js";

const HGE = HOSPITAIS_FROTA.find((h) => h.id === "hge")!;
/** Ponto a `m` metros ao norte do HGE. */
const aoNorte = (m: number) => ({ lat: HGE.lat + m / 111_195, lng: HGE.lng });
const t = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00-03:00`);

test("catálogo: 82 viaturas, código e número únicos, desativadas existem", () => {
    assert.equal(CATALOGO.length, 82);
    assert.equal(new Set(CATALOGO.map((c) => c.codigo)).size, 82);
    const numeros = CATALOGO.map((c) => c.codigo.replace(/\D/g, "")).filter(Boolean);
    assert.equal(new Set(numeros).size, numeros.length);
    for (const c of DESATIVADAS_ATE_SEGUNDA_ORDEM) assert.ok(CATALOGO.some((v) => v.codigo === c), c);
});

test("hospitais: os 11 do painel, todos na RMS", () => {
    assert.equal(HOSPITAIS_FROTA.length, 11);
    for (const h of HOSPITAIS_FROTA) {
        assert.ok(h.lat > -13.1 && h.lat < -12.7 && h.lng > -38.6 && h.lng < -38.2, h.id);
    }
});

test("data_evento do SAMU+ é hora de Salvador", () => {
    assert.equal(instanteSamu("2026-09-29 12:55:16")?.toISOString(), "2026-09-29T15:55:16.000Z");
    assert.equal(instanteSamu("lixo"), null);
});

test("raio: 150 m entra, 160 m não; raios cruzados ficam com o mais perto", () => {
    assert.equal(hospitalNoRaio(aoNorte(140), HOSPITAIS_FROTA)?.id, "hge");
    assert.equal(hospitalNoRaio(aoNorte(160), HOSPITAIS_FROTA), null);
    const hgesf = HOSPITAIS_FROTA.find((h) => h.id === "hgesf")!;
    const mario = HOSPITAIS_FROTA.find((h) => h.id === "mario_leal")!;
    assert.ok(distanciaM(hgesf, mario) < 300, "HGESF e Mário Leal têm raios que se cruzam");
    assert.equal(hospitalNoRaio({ lat: hgesf.lat, lng: hgesf.lng }, HOSPITAIS_FROTA)?.id, "hgesf");
});

test("vínculo: exato primeiro; número só para quem sobrou; moto e evento de fora", () => {
    const v = vincular(
        [
            { unidadeSamu: 1, nome: "CB 02 (A)" },
            { unidadeSamu: 2, nome: "FV 02" },          // Festival da Virada: 02 já é da CB02
            { unidadeSamu: 3, nome: "PB 60 [A]" },      // remanejada: número 60 é a BR60
            { unidadeSamu: 4, nome: "LFEX 01 (A)" },    // código sem número no catálogo
            { unidadeSamu: 5, nome: "MT 07" },
            { unidadeSamu: 6, nome: "PR 03 (A)" },
            { unidadeSamu: 7, nome: "FV 03" },
        ],
        CATALOGO,
    );
    assert.deepEqual(v.get(1), { codigo: "CB02", nomeDifere: false });
    assert.equal(v.get(2), undefined);
    assert.deepEqual(v.get(3), { codigo: "BR60", nomeDifere: true });
    assert.deepEqual(v.get(4), { codigo: "LFEX", nomeDifere: false });
    assert.equal(v.get(5), undefined);
    assert.deepEqual(v.get(6), { codigo: "PR03", nomeDifere: false });
    assert.equal(v.get(7), undefined);
});

test("permanência: abre no raio, segura até 200 m, fecha ao sair", () => {
    let abertas = new Map<string, Permanencia>();
    const passo = (hhmm: string, m: number) => {
        const r = avancarPermanencias(abertas, [{ chave: "CB02", em: t(hhmm), ...aoNorte(m) }], HOSPITAIS_FROTA, t(hhmm));
        abertas = r.abertas;
        return r;
    };
    assert.equal(passo("10:00", 500).novas.length, 0);
    assert.equal(passo("10:02", 100).novas[0].hospitalId, "hge");
    assert.equal(passo("10:10", 180).fechadas.length, 0, "GPS oscilou na borda: segue dentro");
    const saiu = passo("10:20", 400);
    assert.equal(saiu.fechadas[0].motivo, "saiu");
    assert.equal(saiu.fechadas[0].saida?.toISOString(), t("10:20").toISOString());
    assert.equal(abertas.size, 0);
});

test("alerta aos 40 min, marcado uma vez", () => {
    let abertas = new Map<string, Permanencia>();
    let alertas = 0;
    for (const hhmm of ["10:00", "10:20", "10:39", "10:40", "10:44"]) {
        const r = avancarPermanencias(abertas, [{ chave: "SM17", em: t(hhmm), ...aoNorte(20) }], HOSPITAIS_FROTA, t(hhmm));
        abertas = r.abertas;
        if (r.alteradas.some((p) => p.alertaEm?.getTime() === t(hhmm).getTime())) alertas++;
    }
    assert.equal(alertas, 1);
    assert.equal(abertas.get("SM17")?.alertaEm?.toISOString(), t("10:40").toISOString());
});

test("sem sinal: relógio congela aos 15 min e fecha após 1 h", () => {
    const p = { entrada: t("10:00"), ultimaVez: t("10:30") };
    assert.equal(duracaoMin(p, t("10:40")), 40, "posição fresca: conta até agora");
    assert.equal(duracaoMin(p, t("11:00")), 30, "sem confirmar há 30 min: para na última vista");
    const abertas = new Map([["CN10", { chave: "CN10", hospitalId: "hge", ...p, alertaEm: null }]]);
    const r = avancarPermanencias(abertas, [], HOSPITAIS_FROTA, t("11:31"));
    assert.equal(r.fechadas[0].motivo, "sem-sinal");
    assert.equal(r.fechadas[0].saida, null);
});

test("na própria base não conta como hospital; viatura de outra base conta", () => {
    const mario = HOSPITAIS_FROTA.find((h) => h.id === "mario_leal")!;
    const basePM = { lat: -12.959059, lng: -38.487838 };
    const ponto = { lat: (mario.lat + basePM.lat) / 2, lng: (mario.lng + basePM.lng) / 2 };
    const r = avancarPermanencias(
        new Map(),
        [
            { chave: "PM45", em: t("10:00"), ...ponto, base: basePM },
            { chave: "CB26", em: t("10:00"), ...ponto, base: { lat: -12.935104, lng: -38.506528 } },
        ],
        HOSPITAIS_FROTA,
        t("10:00"),
    );
    assert.deepEqual(r.novas.map((p) => p.chave), ["CB26"]);
});

test("posição velha não abre permanência", () => {
    const r = avancarPermanencias(new Map(), [{ chave: "CN10", em: t("08:00"), ...aoNorte(10) }], HOSPITAIS_FROTA, t("10:00"));
    assert.equal(r.novas.length, 0);
});

test("situação: desativada vence; transmitindo aparece; SD/10h de noite é fora do turno", () => {
    const d = DESATIVADAS_ATE_SEGUNDA_ORDEM;
    const dia = t("12:00");
    const noite = new Date("2026-09-29T22:00:00-03:00");
    assert.equal(situacao({ codigo: "PB67", turno: "24h", status: "ATIVA" }, 2, d, dia).situacao, "desativada");
    assert.equal(situacao({ codigo: "PM42", turno: "24h", status: "DESATIVADA 24H" }, 5, d, dia).situacao, "mapa");
    assert.equal(situacao({ codigo: "PM42", turno: "24h", status: "DESATIVADA 24H" }, null, d, dia).situacao, "desativada");
    assert.equal(situacao({ codigo: "CN12", turno: "10h", status: "ATIVA" }, null, d, noite).situacao, "fora-do-turno");
    assert.equal(situacao({ codigo: "CN12", turno: "10h", status: "ATIVA" }, null, d, dia).situacao, "sem-sinal");
    assert.equal(situacao({ codigo: "CN10", turno: "24h", status: "ATIVA" }, 90, d, noite).situacao, "sem-sinal");
});

test("página de status: acha o objeto devices mesmo com chave e texto no meio", () => {
    const html = `<script>const devices = {"unidade:1":{"unitId":"1","teamId":"9","unitName":"CB 02 (A)","battery":73,"signal":100,"speed":11,"x":"a}b"}};
const config = {"a":1};</script>`;
    assert.deepEqual(lerDispositivos(html), [
        { unidadeSamu: 1, equipe: 9, nome: "CB 02 (A)", bateria: 73, sinal: 100, velocidade: 11 },
    ]);
    assert.throws(() => lerDispositivos("<html></html>"));
});

test("painel: equipe → viatura, desativada fora da permanência, extra fora do catálogo", () => {
    const agora = t("12:00");
    const posicoes = lerPosicoes([
        { id: 1, id_equipe: 9, data_evento: "2026-09-29 11:58:00", latitude: String(HGE.lat), longitude: String(HGE.lng) },
        { id: 2, id_equipe: 10, data_evento: "2026-09-29 11:59:00", latitude: String(HGE.lat), longitude: String(HGE.lng) },
        { id: 3, id_equipe: 11, data_evento: "2026-09-29 11:59:00", latitude: "-12.9", longitude: "-38.4" },
        { id: 4, id_equipe: 12, data_evento: "2026-09-29 11:59:00", latitude: "-12.9", longitude: "-38.4" },
    ]);
    const dispositivos = [
        { unidadeSamu: 1, equipe: 9, nome: "CB 02 (A)", bateria: 50, sinal: 100, velocidade: 0 },
        { unidadeSamu: 2, equipe: 10, nome: "PB 67 Pituba", bateria: null, sinal: null, velocidade: null },
        { unidadeSamu: 3, equipe: 11, nome: "MT 07", bateria: null, sinal: null, velocidade: null },
    ];
    const resolvidas = resolverPosicoes(posicoes, dispositivos, CATALOGO);
    const leituras = leiturasParaPermanencia(resolvidas, DESATIVADAS_ATE_SEGUNDA_ORDEM, CATALOGO);
    assert.deepEqual(leituras.map((l) => l.chave).sort(), ["CB02", "equipe:12"]);

    const { abertas } = avancarPermanencias(new Map(), leituras, HOSPITAIS_FROTA, agora);
    const painel = montarPainel({
        ativo: true, coletadoEm: agora, vinculosEm: agora, erro: null,
        catalogo: CATALOGO, desativadas: DESATIVADAS_ATE_SEGUNDA_ORDEM, hospitais: HOSPITAIS_FROTA,
        resolvidas, dispositivos, abertas, agora,
    });
    const por = (chave: string) => painel.viaturas.find((v) => v.chave === chave)!;
    assert.equal(por("CB02").situacao, "mapa");
    assert.equal(por("CB02").noHospital?.hospitalNome, "HGE");
    assert.equal(por("PB67").situacao, "desativada");
    assert.equal(por("PB67").noHospital, null);
    assert.equal(por("samu:3").tipo, "MOTO");
    assert.equal(por("equipe:12").nome, "Equipe 12");
    assert.equal(por("CN10").motivo, "não aparece no SAMU+");
});

test("aviso aos reguladores: parada, saída e sem sinal, com hora de Salvador e HTML escapado", async () => {
    const { textoAviso } = await import("./aviso.js");
    const d = { nome: "CB26", tipo: "USB", hospitalNome: "HGESF", entrada: t("13:38"), ultimaVez: t("14:20") };
    const parada = textoAviso(d, { tipo: "parada", minutos: 43 });
    assert.match(parada, /<b>CB26<\/b> \(USB\) parada há <b>43 min<\/b> no <b>HGESF<\/b>/);
    assert.match(parada, /entrou 13:38 · posição confirmada 14:20/);
    assert.match(textoAviso(d, { tipo: "saiu", saida: t("14:40") }), /saiu do <b>HGESF<\/b> às 14:40 — <b>62 min<\/b>/);
    assert.match(textoAviso(d, { tipo: "sem-sinal" }), /sem sinal desde 14:20 — pelo menos <b>42 min<\/b>/);
    assert.match(textoAviso({ ...d, nome: "A<B" }, { tipo: "parada", minutos: 40 }), /A&lt;B/);
});

test("acolhimentos: casa por viatura + hospital + sobreposição; sobra vira solta", async () => {
    const { cruzar } = await import("./acolhimentos.js");
    const iso = (hhmm: string) => t(hhmm).toISOString();
    const paradas = [
        { id: 1, chave: "CB02", hospitalId: "hge", entrada: iso("10:00"), fim: iso("10:50") },
        { id: 2, chave: "CB02", hospitalId: "hge", entrada: iso("15:00"), fim: iso("15:20") },
        { id: 3, chave: "SM01", hospitalId: "hgrs", entrada: iso("10:00"), fim: iso("10:30") },
    ];
    const base = { status: "completed", vagaZero: false, totalS: null, motivos: [], retencoes: [], passagem: null };
    const a = [
        { ...base, id: "a", unidade: "CB02", hospital: "hge", chegada: iso("10:05"), liberada: iso("10:45") },
        { ...base, id: "b", unidade: "SM01", hospital: "hge", chegada: iso("10:05"), liberada: iso("10:25") }, // outro hospital
        { ...base, id: "c", unidade: "CN10", hospital: "hge", chegada: null, liberada: null },                // sem hora
    ];
    const { casadas, soltas } = cruzar(paradas, a, t("16:00").getTime());
    assert.equal(casadas.get(1)?.id, "a");
    assert.equal(casadas.has(2), false, "a notificação das 10h não casa com a parada das 15h");
    assert.equal(casadas.has(3), false);
    assert.deepEqual(soltas.map((x) => x.id), ["b"]);
});
