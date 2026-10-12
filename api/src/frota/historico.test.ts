import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO } from "./catalogo.js";
import { LOCAIS_FROTA } from "./hospitais.js";
import { agregarHistorico, diaBahia } from "./historico.js";

const t = (dia: string, hhmm: string) => new Date(`2026-10-${dia}T${hhmm}:00-03:00`);
const de = t("09", "00:00");
const ate = t("11", "12:00");
const vazio = { paradas: [], ocorrencias: [], desativacoes: [] };
const parada = (chave: string, hospitalId: string, entrada: Date, min: number, extra: object = {}) => ({
    chave, hospitalId, entrada, fim: new Date(entrada.getTime() + min * 60_000), naBase: false, lat: null, lng: null, ...extra,
});

test("dia de Salvador: 23h59 e 00h01 caem em dias diferentes", () => {
    assert.equal(diaBahia(t("09", "23:59")), "2026-10-09");
    assert.equal(diaBahia(t("10", "00:01")), "2026-10-10");
    assert.deepEqual(agregarHistorico(vazio, LOCAIS_FROTA, CATALOGO, de, ate).dias, ["2026-10-09", "2026-10-10", "2026-10-11"]);
});

test("retenção: visita é 10 min ou mais fora da base; retida, 40 ou mais; excedente é o que passa de 40", () => {
    const h = agregarHistorico(
        {
            ...vazio,
            paradas: [
                parada("CB26", "upa_brotas", t("09", "15:10"), 100),
                parada("CB27", "upa_brotas", t("09", "16:00"), 25),
                parada("CB27", "upa_brotas", t("09", "17:00"), 6),
                parada("SM17", "upa_brotas", t("09", "18:00"), 90, { naBase: true }),
                parada("CB26", "upa_brotas", t("10", "09:00"), 40),
            ],
        },
        LOCAIS_FROTA, CATALOGO, de, ate,
    );
    assert.deepEqual(h.retencao, [
        { dia: "2026-10-09", localId: "upa_brotas", visitas: 2, retidas: 1, minutos: 125, excedenteMin: 60 },
        { dia: "2026-10-10", localId: "upa_brotas", visitas: 1, retidas: 1, minutos: 40, excedenteMin: 0 },
    ]);
    assert.deepEqual(h.faixas, [
        { localId: "upa_brotas", hora: 9, visitas: 1, retidas: 1 },
        { localId: "upa_brotas", hora: 15, visitas: 2, retidas: 1 },
    ]);
});

test("retenção: parada antiga travada na UPA Cabula, estacionada na baia do HGRS, conta no HGRS", () => {
    const baia = LOCAIS_FROTA.find((l) => l.id === "hgrs")!.portas![0];
    const h = agregarHistorico(
        { ...vazio, paradas: [parada("CC70", "upa_cabula", t("09", "10:00"), 80, baia), parada("CC71", "upa_cabula", t("09", "11:00"), 30)] },
        LOCAIS_FROTA, CATALOGO, de, ate,
    );
    assert.deepEqual(h.retencao.map((r) => [r.localId, r.visitas]).sort(), [["hgrs", 1], ["upa_cabula", 1]]);
});

test("uso: ocorrências sobrepostas não contam em dobro e a que vira o dia se reparte", () => {
    const oc = (chave: string, a: Date, b: Date, chegada: Date | null = null) => ({ chave, primeiraVez: a, ultimaVez: b, chegadaDestino: chegada });
    const h = agregarHistorico(
        {
            paradas: [parada("CB26", "hge", t("09", "10:30"), 50)],
            ocorrencias: [
                oc("CB26", t("09", "10:00"), t("09", "11:00"), t("09", "10:30")),
                oc("CB26", t("09", "10:40"), t("09", "11:30")),
                oc("CB26", t("09", "23:30"), t("10", "01:00")),
                oc("equipe:9", t("09", "10:00"), t("09", "12:00")),
            ],
            desativacoes: [
                { codigo: "CB26", desde: t("10", "19:00"), reativadaEm: t("10", "22:00"), motivos: ["medico", "enfermeiro"] },
                { codigo: "CB27", desde: t("11", "10:00"), reativadaEm: null, motivos: [] },
            ],
        },
        LOCAIS_FROTA, CATALOGO, de, ate,
    );
    const cb26 = h.uso.filter((u) => u.codigo === "CB26");
    assert.deepEqual(cb26, [
        { dia: "2026-10-09", codigo: "CB26", ocorrencias: 3, minOcorrencia: 120, minPorta: 50, minRetida: 50, minFora: 0 },
        { dia: "2026-10-10", codigo: "CB26", ocorrencias: 0, minOcorrencia: 60, minPorta: 0, minRetida: 0, minFora: 180 },
    ]);
    assert.ok(!h.uso.some((u) => u.codigo.startsWith("equipe")), "fora do catálogo não entra");
    assert.deepEqual(h.fora, [
        { dia: "2026-10-10", motivo: "medico", viaturas: 1, minutos: 180 },
        { dia: "2026-10-10", motivo: "enfermeiro", viaturas: 1, minutos: 180 },
        { dia: "2026-10-11", motivo: "sem_motivo", viaturas: 1, minutos: 120 },
    ]);
    assert.deepEqual(h.destino, [{ dia: "2026-10-09", n: 1, medianaMin: 30, p90Min: 30 }]);
    assert.deepEqual(h.mapa, [{ dia: "2026-10-09", horas: 3 }, { dia: "2026-10-10", horas: 1 }, { dia: "2026-10-11", horas: 0 }]);
});

test("só agregado: nenhuma chave de paciente, protocolo ou médico na saída", () => {
    const h = agregarHistorico(vazio, LOCAIS_FROTA, CATALOGO, de, ate);
    assert.doesNotMatch(JSON.stringify(Object.keys(h)), /protocolo|medico|paciente|endereco|queixa/i);
});
