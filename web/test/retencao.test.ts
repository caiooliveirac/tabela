// Estatística da tela de retenção (chefia): filtro, percentis, série, calor e CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTRO_INICIAL, calor, csv, diaSemana, expandir, filtrar, histograma, inicioDoDia, ordenar, porGrupo, quantil, resumir,
  segundaDa, serie, type Parada, type RetencaoApi,
} from "../src/components/frota/retencao/estatistica.ts";

const t = (dia: string, hhmm: string) => Date.parse(`2026-11-${dia}T${hhmm}:00-03:00`);
const api: RetencaoApi = {
  ativo: true, de: "", ate: "", geradoEm: "", alertaMin: 40, visitaMin: 10,
  locais: [
    { id: "hge", nome: "HGE", tipo: "hospital", perfil: "geral" },
    { id: "upa_brotas", nome: "UPA Brotas", tipo: "upa", perfil: "upa" },
  ],
  viaturas: [
    { nome: "SM01", tipo: "USA", base: "PAU MIÚDO" },
    { nome: "CB02", tipo: "USB", base: "BROTAS" },
  ],
  paradas: [
    [t("02", "10:00") / 60_000, 30, 0, 0, 0, 0],
    [t("02", "23:30") / 60_000, 90, 0, 1, 0, 0],
    [t("03", "08:00") / 60_000, 45, 1, 1, 1, 0],
    [t("04", "07:00") / 60_000, 15, 1, 0, 2, 2],
  ],
};
const ps = expandir(api);

test("expandir: índices viram nomes, perfil e situação", () => {
  assert.equal(ps[1].local, "HGE");
  assert.equal(ps[1].viatura, "CB02");
  assert.equal(ps[2].situacao, "livre");
  assert.equal(ps[3].fim, "sem-sinal");
  assert.equal(ps[3].perfil, "upa");
});

test("filtro: livre fica fora por padrão; tipo, perfil, local e viatura recortam", () => {
  const de = t("01", "00:00");
  const ate = t("10", "00:00");
  assert.equal(filtrar(ps, FILTRO_INICIAL, de, ate).length, 3);
  assert.equal(filtrar(ps, { ...FILTRO_INICIAL, incluirLivres: true }, de, ate).length, 4);
  assert.deepEqual(filtrar(ps, { ...FILTRO_INICIAL, tipo: "USA" }, de, ate).map((p) => p.min), [30, 15]);
  assert.deepEqual(filtrar(ps, { ...FILTRO_INICIAL, perfis: ["upa"] }, de, ate).map((p) => p.min), [15]);
  assert.deepEqual(filtrar(ps, { ...FILTRO_INICIAL, viatura: "CB02" }, de, ate).map((p) => p.min), [90]);
  assert.equal(filtrar(ps, FILTRO_INICIAL, t("03", "00:00"), ate).length, 1);
});

test("quantil e resumo: mediana, P90, fração retida e horas além do limite", () => {
  assert.equal(quantil([10, 20, 30, 40], 0.5), 25);
  assert.ok(Number.isNaN(quantil([], 0.5)));
  const r = resumir(ps, 40);
  assert.equal(r.n, 4);
  assert.equal(r.mediana, 37.5);
  assert.equal(r.fracAlerta, 0.5);
  assert.equal(r.horasAlem, (50 + 5) / 60);
  assert.equal(r.maior, 90);
  assert.equal(r.semSinal, 1);
});

test("dia da semana e semana de Salvador: 23h30 de segunda ainda é segunda", () => {
  assert.equal(diaSemana(t("02", "23:30")), 0); // 02/11/2026 é segunda
  assert.equal(diaSemana(t("08", "12:00")), 6);
  assert.equal(segundaDa("2026-11-08"), "2026-11-02");
  assert.equal(segundaDa("2026-11-02"), "2026-11-02");
});

test("série por dia inclui dia vazio; por semana junta e conta os dias do balde", () => {
  const de = inicioDoDia("2026-11-01");
  const ate = inicioDoDia("2026-11-05");
  const d = serie(ps, de, ate, "dia", 40);
  assert.deepEqual(d.map((x) => [x.chave, x.resumo.n]), [["2026-11-01", 0], ["2026-11-02", 2], ["2026-11-03", 1], ["2026-11-04", 1]]);
  const s = serie(ps, de, ate, "semana", 40);
  assert.deepEqual(s.map((x) => [x.chave, x.dias, x.resumo.n]), [["2026-10-26", 1, 0], ["2026-11-02", 3, 4]]);
});

test("histograma, calor e grupos", () => {
  assert.deepEqual(histograma(ps).map((f) => f.n), [1, 0, 1, 1, 0, 1, 0, 0]);
  const c = calor(ps, 40);
  assert.equal(c[0][5].n, 1); // segunda 10h
  assert.equal(c[0][11].n, 1); // segunda 23h30
  const g = porGrupo(ps, (p) => p.localId, (p) => p.local, (p) => p.perfil, 40);
  assert.deepEqual(g.map((x) => [x.chave, x.resumo.n]), [["hge", 2], ["upa_brotas", 2]]);
});

test("ordenar: amostra pequena vai para o fim, mesmo com P90 maior", () => {
  const p = (min: number, localId: string): Parada => ({ ...ps[0], min, localId });
  const xs = [...Array(5)].map(() => p(30, "a")).concat([p(200, "b")]);
  const g = porGrupo(xs, (x) => x.localId, (x) => x.localId, () => "", 40);
  assert.deepEqual(ordenar(g, "p90").map((x) => x.chave), ["a", "b"]);
});

test("CSV: cabeçalho e hora de Salvador, sem dado de paciente", () => {
  const linhas = csv(ps.slice(0, 1)).split("\n");
  assert.equal(linhas[0], "data;chegada;viatura;tipo;base;local;perfil;minutos;situacao;fim");
  assert.equal(linhas[1], "2026-11-02;10:00;SM01;USA;PAU MIÚDO;HGE;Hospital geral;30;em ocorrência;saiu");
});
