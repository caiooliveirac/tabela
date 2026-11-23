import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParadaDetalhe, PosicaoDetalhe } from "./detalhe.js";
import { faseEm, fasesDaOcorrencia, paradasDeRua } from "./fases.js";

const t = (hhmm: string) => new Date(`2026-11-23T${hhmm}:00-03:00`);
const BASE = { lat: -12.97, lng: -38.5 };
const LOCAL = { lat: -12.97, lng: -38.47 }; // ~3,3 km a leste
const HOSP = { lat: -12.97, lng: -38.45 };
const UPA = { lat: -12.96, lng: -38.47 };

/** Uma posição por minuto de `de` até `ate`, andando em linha reta de `a` até `b` (o último ponto já é `b`). */
function trecho(de: string, ate: string, a: { lat: number; lng: number }, b = a): PosicaoDetalhe[] {
    const ini = t(de).getTime(), fim = t(ate).getTime(), n = Math.round((fim - ini) / 60_000);
    return Array.from({ length: n + 1 }, (_, i) => {
        const f = n ? i / n : 0;
        // parado: um tremor de ~5 m, como o GPS de verdade
        const tremor = a === b ? ((i % 3) - 1) * 0.00004 : 0;
        return { em: new Date(ini + i * 60_000), lat: a.lat + (b.lat - a.lat) * f + tremor, lng: a.lng + (b.lng - a.lng) * f };
    });
}

function parada(o: Partial<ParadaDetalhe> & { entrada: Date }): ParadaDetalhe {
    return { id: 1, hospitalId: "hge", ultimaVez: o.saida ?? o.entrada, saida: null, motivoFim: "saiu", alertaEm: null, naBase: false, ...o };
}

const completo = () => [
    ...trecho("09:55", "10:04", BASE),
    ...trecho("10:05", "10:14", { lat: -12.97, lng: -38.497 }, LOCAL),
    ...trecho("10:15", "10:35", LOCAL),
    ...trecho("10:36", "10:45", LOCAL, HOSP),
    ...trecho("10:46", "11:30", HOSP),
    ...trecho("11:31", "11:50", HOSP, BASE),
    ...trecho("11:51", "12:00", BASE),
];
const hosp = parada({ id: 7, hospitalId: "hge", entrada: t("10:46"), saida: t("11:30"), ultimaVez: t("11:30") });

test("fases: base → local → unidade → base, com os tempos de cada trecho", () => {
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: false, posicoes: completo(), paradas: [hosp], base: BASE, agora: t("12:00") });
    assert.equal(f.naBase, true);
    assert.equal(f.partida?.getTime(), t("10:05").getTime());
    // chega no último ponto do trecho andando (10:14) e sai no primeiro do seguinte (10:36)
    assert.equal(f.local?.inicio.getTime(), t("10:14").getTime());
    assert.equal(f.local?.fim.getTime(), t("10:36").getTime());
    assert.equal(f.unidade?.hospitalId, "hge");
    assert.equal(f.chegadaBase?.getTime(), t("11:50").getTime());
    assert.deepEqual(
        Object.fromEntries(Object.entries(f.tempos).map(([k, v]) => [k, v?.minutos ?? null])),
        { saida: 5, resposta: 14, noLocal: 22, transporte: 10, naUnidade: 44, retorno: 20 },
    );
    assert.equal(f.intermediarias.length, 0);
    assert.deepEqual(
        ["09:58", "10:10", "10:20", "10:40", "11:00", "11:40", "11:55"].map((h) => faseEm(f, t(h))),
        ["antes", "resposta", "local", "transporte", "unidade", "retorno", "depois"],
    );
});

test("fases: parada curta no caminho fica como intermediária; a mais longa é o local", () => {
    const meio = { lat: -12.97, lng: -38.485 };
    const pos = [
        ...trecho("09:55", "10:00", BASE),
        ...trecho("10:01", "10:04", BASE, meio),
        ...trecho("10:05", "10:12", meio), // 7 min no engarrafamento
        ...trecho("10:13", "10:18", meio, LOCAL),
        ...trecho("10:19", "10:45", LOCAL),
        ...trecho("10:46", "10:55", LOCAL, HOSP),
    ];
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: true, posicoes: pos, paradas: [parada({ entrada: t("10:56") })], base: BASE, agora: t("11:10") });
    assert.equal(f.local?.inicio.getTime(), t("10:18").getTime());
    assert.equal(f.intermediarias.length, 1);
    assert.equal(f.intermediarias[0].minutos, 9); // 10:04–10:13
});

test("fases: parada partida por falha de sinal vira uma só", () => {
    const pos = [
        ...trecho("09:55", "10:00", BASE),
        ...trecho("10:01", "10:09", BASE, LOCAL),
        ...trecho("10:10", "10:16", LOCAL),
        ...trecho("10:17", "10:23", { lat: LOCAL.lat + 0.0004, lng: LOCAL.lng }), // 45 m dali, o GPS pulou
        ...trecho("10:24", "10:33", LOCAL, HOSP),
    ];
    const ruas = paradasDeRua(pos.filter((p) => p.em >= t("10:10") && p.em <= t("10:23")), null);
    assert.equal(ruas.length, 1);
    assert.equal(ruas[0].minutos, 13);
});

test("fases: vinculada na rua — a partida é quando começa a andar; sem saída da base", () => {
    const pos = [...trecho("09:50", "10:03", HOSP), ...trecho("10:04", "10:13", HOSP, LOCAL), ...trecho("10:14", "10:30", LOCAL)];
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: true, posicoes: pos, paradas: [], base: BASE, agora: t("10:30") });
    assert.equal(f.naBase, false);
    assert.equal(f.tempos.saida, null);
    assert.equal(f.partida?.getTime(), t("10:05").getTime());
    // ainda no local: o tempo lá está correndo
    assert.equal(f.local?.aberta, true);
    assert.deepEqual(f.tempos.noLocal, { minutos: 17, aberto: true });
    assert.equal(faseEm(f, t("10:30")), "local");
});

test("fases: transferência — sem parada de rua, a primeira unidade foi o local", () => {
    const pos = [
        ...trecho("09:55", "10:00", BASE),
        ...trecho("10:01", "10:09", BASE, UPA),
        ...trecho("10:10", "10:40", UPA),
        ...trecho("10:41", "10:50", UPA, HOSP),
        ...trecho("10:51", "11:20", HOSP),
    ];
    const paradas = [
        parada({ id: 1, hospitalId: "upa_x", entrada: t("10:10"), saida: t("10:40"), ultimaVez: t("10:40") }),
        parada({ id: 2, hospitalId: "hge", entrada: t("10:51") }),
    ];
    paradas[1].motivoFim = null;
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: true, posicoes: pos, paradas, base: BASE, agora: t("11:20") });
    assert.equal(f.local?.hospitalId, "upa_x");
    assert.equal(f.unidade?.hospitalId, "hge");
    assert.deepEqual(f.tempos.naUnidade, { minutos: 29, aberto: true });
});

test("fases: ainda na base — o tempo de saída está correndo", () => {
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: true, posicoes: trecho("09:50", "10:07", BASE), paradas: [], base: BASE, agora: t("10:07") });
    assert.equal(f.partida, null);
    assert.deepEqual(f.tempos.saida, { minutos: 7, aberto: true });
    assert.equal(faseEm(f, t("10:05")), "resposta");
});

test("fases: voltou à base sem unidade (atendimento sem remoção)", () => {
    const pos = [
        ...trecho("09:55", "10:00", BASE),
        ...trecho("10:01", "10:09", BASE, LOCAL),
        ...trecho("10:10", "10:40", LOCAL),
        ...trecho("10:41", "10:50", LOCAL, BASE),
        ...trecho("10:51", "11:00", BASE),
    ];
    const f = fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: false, posicoes: pos, paradas: [], base: BASE, agora: t("11:00") });
    assert.equal(f.unidade, null);
    assert.equal(f.local?.minutos, 32); // 10:09–10:41
    assert.equal(f.tempos.retorno?.minutos, 9);
    assert.equal(faseEm(f, t("10:45")), "retorno");
});

test("fases: unidade curta conta (3+ min ou com o botão da equipe); passar pela cerca, não", () => {
    const pos = [
        ...trecho("09:55", "10:00", BASE),
        ...trecho("10:01", "10:09", BASE, LOCAL),
        ...trecho("10:10", "10:30", LOCAL),
        ...trecho("10:31", "10:40", LOCAL, HOSP),
        ...trecho("10:41", "10:44", HOSP),
        ...trecho("10:45", "10:59", HOSP, BASE),
    ];
    const curta = (min: number) => parada({ entrada: t("10:41"), saida: new Date(t("10:41").getTime() + min * 60_000) });
    const f = (min: number, botao: Date | null = null) =>
        fasesDaOcorrencia({ vinculacao: t("10:00"), ativa: false, posicoes: pos, paradas: [curta(min)], base: BASE, chegadaUnidadeRegistrada: botao, agora: t("11:00") });
    assert.equal(f(4).unidade?.hospitalId, "hge");
    assert.equal(f(2).unidade, null);
    assert.equal(f(2, t("10:43")).unidade?.hospitalId, "hge");
});
