import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAIS_FROTA } from "./hospitais.js";
import type { Ocorrencia } from "./ocorrencias.js";
import {
    FORA_CERCA_MIN, JANELA_MAX_H, fimForaDaCerca, foraDaCerca, inicioJanela, montarDetalhe,
    type ParadaDetalhe, type SaidaCerca, type ViaturaAgora,
} from "./detalhe.js";

const t = (hhmm: string) => new Date(`2026-11-22T${hhmm}:00-03:00`);
const H = LOCAIS_FROTA.find((h) => h.tipo === "hospital")!;
/** ~10 km ao norte do hospital. */
const LONGE = { lat: H.lat + 0.09, lng: H.lng };

const oc = (status: string, statusEm: Date, extra: Partial<Ocorrencia> = {}): Ocorrencia => ({
    protocolo: "202611220119", medico: "FULANO EXEMPLO", status, statusEm: statusEm.toISOString(),
    abertura: t("02:39").toISOString(), risco: "Vermelho", regulacaoSecundaria: false,
    endereco: null, bairro: "Bairro Exemplo", queixa: "suspeita de avc", hma: null, ...extra,
});
const saida: SaidaCerca = { id: 7, hospitalId: H.id, entrada: t("04:10"), saida: t("04:52") };

test("fora da cerca: status de hospital, parada fechou por saída depois dele", () => {
    const f = foraDaCerca(oc("CHEGADA AO HOSPITAL", t("04:13")), false, saida, LOCAIS_FROTA, t("06:47"));
    assert.ok(f);
    assert.equal(f.hospitalNome, H.nome);
    assert.equal(f.saiuEm, t("04:52").toISOString());
    assert.equal(f.minutos, 115);
});

test("fora da cerca: não vale em outro hospital, com outro status, sem hora ou com parada de antes do status", () => {
    const agora = t("06:47");
    assert.equal(foraDaCerca(oc("CHEGADA AO HOSPITAL", t("04:13")), true, saida, LOCAIS_FROTA, agora), null);
    assert.equal(foraDaCerca(oc("DISPONÍVEL / RETORNO À BASE", t("05:00")), false, saida, LOCAIS_FROTA, agora), null);
    assert.equal(foraDaCerca(oc("CHEGADA AO HOSPITAL", t("04:13"), { statusEm: null }), false, saida, LOCAIS_FROTA, agora), null);
    assert.equal(foraDaCerca(null, false, saida, LOCAIS_FROTA, agora), null);
    // Parada de um caso anterior: saiu 03:00, chegada registrada 05:00 (o GPS nunca entrou em hospital).
    const velha = { ...saida, entrada: t("02:30"), saida: t("03:00") };
    assert.equal(foraDaCerca(oc("CHEGADA AO HOSPITAL", t("05:00")), false, velha, LOCAIS_FROTA, agora), null);
});

const parada = (p: Partial<ParadaDetalhe>): ParadaDetalhe => ({
    id: 7, hospitalId: H.id, entrada: t("04:10"), ultimaVez: t("04:50"), saida: t("04:52"),
    motivoFim: "saiu", alertaEm: null, naBase: false, ...p,
});
const viatura = (v: Partial<ViaturaAgora>): ViaturaAgora => ({
    chave: "SM01", nome: "SM01", naBase: false, noHospital: null, foraDaCerca: null,
    posicao: { ...LONGE, em: t("06:47").toISOString(), idadeMin: 0 }, ...v,
});

test("detalhe fora da cerca: aviso crítico com a mensagem, saída marcada na linha do tempo, rastro dentro/fora", () => {
    const agora = t("06:47");
    const o = oc("CHEGADA AO HOSPITAL", t("04:13"));
    const f = foraDaCerca(o, false, saida, LOCAIS_FROTA, agora)!;
    const status = [
        { status: "DESIGNADA", em: t("03:08") },
        { status: "CHEGADA AO HOSPITAL", em: t("04:13") },
    ];
    const desde = inicioJanela(o, status, null, agora);
    const d = montarDetalhe({
        viatura: viatura({ foraDaCerca: f }),
        ocorrencia: { ...o, ativa: true },
        status,
        paradas: [parada({})],
        posicoes: [
            { em: t("04:20"), lat: H.lat, lng: H.lng },
            { em: t("06:47"), ...LONGE },
        ],
        locais: LOCAIS_FROTA,
        desde,
        agora,
    });
    assert.equal(d.localizacao.estado, "fora-da-cerca");
    assert.equal(d.localizacao.saiuEm, t("04:52").toISOString());
    assert.ok(d.localizacao.distanciaM! > 9000);
    assert.equal(d.destino?.id, H.id);
    assert.equal(d.destino?.papel, "ultima");
    assert.equal(d.permanencia?.minutos, 42);
    assert.equal(d.aviso?.nivel, "critico");
    assert.match(d.aviso!.titulo, /04:52/);
    assert.match(d.aviso!.mensagem!, /SM01 saiu .* às 04:52 .*202611220119/);
    const tipos = d.linha.map((x) => x.tipo);
    assert.deepEqual(tipos, ["abertura", "status", "entrou", "status", "saiu", "posicao"]);
    assert.equal(d.linha.find((x) => x.tipo === "saiu")!.tom, "critico");
    assert.deepEqual(d.rastro.map((p) => p.local), [H.id, null]);
});

test("fora da cerca recente é atenção, não crítico", () => {
    const agora = new Date(t("04:52").getTime() + (FORA_CERCA_MIN - 1) * 60_000);
    const o = oc("CHEGADA AO HOSPITAL", t("04:13"));
    const f = foraDaCerca(o, false, saida, LOCAIS_FROTA, agora)!;
    const d = montarDetalhe({
        viatura: viatura({ foraDaCerca: f }), ocorrencia: { ...o, ativa: true }, status: [], paradas: [parada({})],
        posicoes: [], locais: LOCAIS_FROTA, desde: t("02:29"), agora,
    });
    assert.equal(d.aviso?.nivel, "atencao");
});

test("detalhe dentro da cerca com 40+ min: parada atual e aviso de retenção", () => {
    const agora = t("05:00");
    const p = parada({ saida: null, motivoFim: null, ultimaVez: t("05:00"), alertaEm: t("04:50") });
    const d = montarDetalhe({
        viatura: viatura({
            posicao: { lat: H.lat, lng: H.lng, em: agora.toISOString(), idadeMin: 0 },
            noHospital: { id: 7, hospitalId: H.id, entrada: t("04:10").toISOString(), minutos: 50, alerta: true, naBase: false },
        }),
        ocorrencia: { ...oc("CHEGADA AO HOSPITAL", t("04:13")), ativa: true },
        status: [], paradas: [p], posicoes: [], locais: LOCAIS_FROTA, desde: t("02:29"), agora,
    });
    assert.equal(d.localizacao.estado, "na-cerca");
    assert.equal(d.destino?.papel, "atual");
    assert.deepEqual([d.permanencia?.aberta, d.permanencia?.minutos, d.permanencia?.alerta], [true, 50, true]);
    assert.equal(d.aviso?.titulo, "Parada de 40 min ou mais");
    assert.ok(d.linha.some((x) => x.tipo === "alerta"));
});

test("chegada registrada sem o GPS ter passado por hospital: aviso de atenção", () => {
    const agora = t("05:00");
    const d = montarDetalhe({
        viatura: viatura({}),
        ocorrencia: { ...oc("CHEGADA AO HOSPITAL", t("04:30")), ativa: true },
        status: [{ status: "CHEGADA AO HOSPITAL", em: t("04:30") }],
        paradas: [], posicoes: [], locais: LOCAIS_FROTA, desde: t("02:29"), agora,
    });
    assert.equal(d.destino, null);
    assert.equal(d.localizacao.estado, "a-caminho");
    assert.equal(d.aviso?.nivel, "atencao");
    assert.match(d.aviso!.titulo, /GPS não passou/);
});

test("chegada registrada na própria base que fica na UPA: sem aviso de GPS", () => {
    const agora = t("05:00");
    const d = montarDetalhe({
        viatura: viatura({
            posicao: { lat: H.lat, lng: H.lng, em: agora.toISOString(), idadeMin: 0 },
            noHospital: { id: 9, hospitalId: H.id, entrada: t("04:31").toISOString(), minutos: 29, alerta: false, naBase: true },
        }),
        ocorrencia: { ...oc("CHEGADA AO HOSPITAL", t("04:30")), ativa: true },
        status: [{ status: "CHEGADA AO HOSPITAL", em: t("04:30") }],
        paradas: [parada({ id: 9, naBase: true, entrada: t("04:31"), saida: null, motivoFim: null })],
        posicoes: [], locais: LOCAIS_FROTA, desde: t("02:29"), agora,
    });
    assert.equal(d.localizacao.estado, "na-base");
    assert.equal(d.aviso, null);
});

test("janela: abertura menos 10 min, a parada aberta entra, nunca mais que 12 h", () => {
    const agora = t("06:47");
    assert.equal(inicioJanela({ abertura: t("02:39").toISOString() }, [], null, agora).getTime(), t("02:29").getTime());
    assert.equal(inicioJanela(null, [], t("02:00"), agora).getTime(), t("02:00").getTime());
    assert.equal(inicioJanela(null, [], null, agora).getTime(), t("03:47").getTime());
    const antiga = new Date(agora.getTime() - 20 * 3_600_000).toISOString();
    assert.equal(inicioJanela({ abertura: antiga }, [], null, agora).getTime(), agora.getTime() - JANELA_MAX_H * 3_600_000);
});

test("fim do aviso fora da cerca: status novo, liberada, voltou; mapa mudo segue aberto; sem sinal fecha calado", () => {
    const f = foraDaCerca(oc("CHEGADA AO HOSPITAL", t("04:13")), false, saida, LOCAIS_FROTA, t("05:10"))!;
    const base = { situacao: "mapa", foraDaCerca: null, noHospital: null };
    assert.equal(fimForaDaCerca({ ...base, foraDaCerca: f, ocorrencia: { ocorrencia: oc("CHEGADA AO HOSPITAL", t("04:13")) } }, 7), null);
    assert.equal(fimForaDaCerca({ ...base, ocorrencia: null }, 7), null);
    assert.deepEqual(fimForaDaCerca({ ...base, ocorrencia: { ocorrencia: null } }, 7), { tipo: "livre" });
    const disp = oc("DISPONÍVEL / RETORNO À BASE", t("05:20"));
    assert.deepEqual(fimForaDaCerca({ ...base, ocorrencia: { ocorrencia: disp } }, 7), { tipo: "status", status: disp.status, em: disp.statusEm });
    const dentro = { naBase: false, hospitalNome: "Hospital Exemplo", entrada: t("05:30").toISOString() };
    assert.deepEqual(fimForaDaCerca({ ...base, noHospital: dentro, ocorrencia: null }, 7), { tipo: "voltou", hospitalNome: "Hospital Exemplo", em: dentro.entrada });
    assert.deepEqual(fimForaDaCerca({ ...base, situacao: "sem-sinal", ocorrencia: null }, 7), { tipo: "encerrado" });
    assert.deepEqual(fimForaDaCerca(undefined, 7), { tipo: "encerrado" });
});
