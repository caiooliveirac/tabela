import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAIS_FROTA } from "./hospitais.js";
import type { Ocorrencia } from "./ocorrencias.js";
import {
    FORA_CERCA_MIN, JANELA_LIVRE_MIN, RASTRO_DIAS, fimForaDaCerca, foraDaCerca, janelaDoRastro, montarDetalhe, type Janela,
    type ParadaDetalhe, type SaidaCerca, type ViaturaAgora,
} from "./detalhe.js";
import type { Fases } from "./fases.js";

const t = (hhmm: string) => new Date(`2026-11-22T${hhmm}:00-03:00`);
const jan = (desde: Date): Janela => ({ desde, padrao: desde, motivo: "vinculacao", horas: null });
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
    const janela = janelaDoRastro({ ...o, ativa: true }, status, agora);
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
        janela,
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
        posicoes: [], locais: LOCAIS_FROTA, janela: jan(t("02:29")), agora,
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
        status: [], paradas: [p], posicoes: [], locais: LOCAIS_FROTA, janela: jan(t("02:29")), agora,
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
        paradas: [], posicoes: [], locais: LOCAIS_FROTA, janela: jan(t("02:29")), agora,
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
        posicoes: [], locais: LOCAIS_FROTA, janela: jan(t("02:29")), agora,
    });
    assert.equal(d.localizacao.estado, "na-base");
    assert.equal(d.aviso, null);
});

test("janela: em ocorrência, desde a vinculação; fora dela, a última hora", () => {
    const agora = t("06:47");
    const o = { abertura: t("02:39").toISOString(), ativa: true };
    const status = [
        { status: "DESIGNADA", em: t("03:08") },
        { status: "CHEGADA AO HOSPITAL", em: t("04:13") },
    ];
    const j = janelaDoRastro(o, status, agora);
    assert.equal(j.motivo, "vinculacao");
    assert.equal(j.desde.getTime(), t("03:08").getTime());
    assert.equal(j.padrao.getTime(), t("03:08").getTime());
    // encerrada ou sem ocorrência: a última hora
    for (const oc of [{ ...o, ativa: false }, null]) {
        const l = janelaDoRastro(oc, status, agora);
        assert.equal(l.motivo, "ultima-hora");
        assert.equal(l.desde.getTime(), agora.getTime() - JANELA_LIVRE_MIN * 60_000);
    }
});

test("janela: protocolo repetido de outro dia não puxa a vinculação para trás", () => {
    const agora = t("06:47");
    const ontem = new Date(t("03:00").getTime() - 24 * 3_600_000);
    const status = [
        { status: "DESIGNADA", em: ontem },
        { status: "DESIGNADA", em: t("05:50") },
    ];
    assert.equal(janelaDoRastro({ abertura: t("05:40").toISOString(), ativa: true }, status, agora).desde.getTime(), t("05:50").getTime());
    // sem abertura: só status das últimas 24 h
    assert.equal(janelaDoRastro({ abertura: null, ativa: true }, status, agora).desde.getTime(), t("05:50").getTime());
});

test("janela: o seletor volta horas, nunca menos que o padrão nem mais que a retenção", () => {
    const agora = t("06:47");
    const o = { abertura: t("02:39").toISOString(), ativa: true };
    const status = [{ status: "DESIGNADA", em: t("03:08") }];
    const h = (n: number) => agora.getTime() - n * 3_600_000;
    assert.equal(janelaDoRastro(o, status, agora, 8).desde.getTime(), h(8));
    assert.equal(janelaDoRastro(o, status, agora, 8).horas, 8);
    assert.equal(janelaDoRastro(o, status, agora, 1).desde.getTime(), t("03:08").getTime());
    assert.equal(janelaDoRastro(o, status, agora, 999).desde.getTime(), h(RASTRO_DIAS * 24));
    assert.equal(janelaDoRastro(null, [], agora, 2).desde.getTime(), h(2));
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

test("detalhe: MR de cada status na linha do tempo, MRs em ordem e a notificação do Acolhimentos", () => {
    const agora = t("06:00");
    const o = { ...oc("DISPONÍVEL / RETORNO À BASE", t("05:40")), ativa: true };
    const notificacao = {
        chegada: t("04:15").toISOString(), passagem: t("04:40").toISOString(), liberada: t("05:30").toISOString(),
        minutos: 75, maca: { inicio: t("04:20").toISOString(), fim: t("05:25").toISOString() }, motivos: ["SEM MACA"],
    };
    const d = montarDetalhe({
        viatura: viatura({}), ocorrencia: o,
        status: [
            { status: "DESIGNADA", em: t("03:08"), medico: "FULANO EXEMPLO" },
            { status: "CHEGADA AO HOSPITAL", em: t("04:13"), medico: "FULANO EXEMPLO" },
            { status: "DISPONÍVEL / RETORNO À BASE", em: t("05:40"), medico: "BELTRANA EXEMPLO" },
        ],
        paradas: [parada({ saida: t("05:35"), alertaEm: t("04:50") })], posicoes: [], locais: LOCAIS_FROTA, janela: jan(t("02:29")), agora,
        acolhimentos: { ligado: true, erro: null, porParada: new Map([[7, notificacao]]), cobre: () => true },
    });
    assert.deepEqual(d.medicos, ["Fulano Exemplo", "Beltrana Exemplo"]);
    const st = d.linha.filter((x) => x.tipo === "status").map((x) => x.detalhe);
    assert.deepEqual(st, ["Registrado no mapa de equipes · MR Fulano Exemplo", "Registrado no mapa de equipes", "Registrado no mapa de equipes · MR Beltrana Exemplo"]);
    assert.deepEqual(d.linha.filter((x) => x.tipo === "acolhimento").map((x) => x.titulo), [
        "Chegada notificada no Acolhimentos", "Maca retida", "Paciente passado ao hospital", "Maca devolvida", "Liberação notificada no Acolhimentos",
    ]);
    assert.match(d.linha.find((x) => x.titulo.startsWith("Liberação"))!.detalhe!, /1h15 no total · motivos: sem maca/);
    assert.equal(d.acolhimento.cobre, true);
    assert.equal(d.acolhimento.notificacao, notificacao);
    assert.equal(d.acolhimento.semNotificacao, false);

    const sem = montarDetalhe({
        viatura: viatura({}), ocorrencia: o, status: [], paradas: [parada({ alertaEm: t("04:50") })], posicoes: [], locais: LOCAIS_FROTA,
        janela: jan(t("02:29")), agora, acolhimentos: { ligado: true, erro: null, porParada: new Map(), cobre: () => true },
    });
    assert.equal(sem.acolhimento.semNotificacao, true);
});

test("detalhe com fases: marcos pelo GPS na linha do tempo, com o que a equipe apertou ao lado, e a fase de cada ponto", () => {
    const agora = t("06:47");
    const status = [
        { status: "DESIGNADA", em: t("03:08") },
        { status: "CHEGADA AO LOCAL", em: t("03:41") },
        { status: "CHEGADA AO HOSPITAL", em: t("04:13") },
    ];
    const LOCAL = { lat: LONGE.lat, lng: LONGE.lng + 0.02 };
    const fases: Fases = {
        vinculacao: t("03:08"), naBase: true, partida: t("03:12"),
        local: { inicio: t("03:35"), fim: t("03:58"), ...LOCAL, minutos: 23, aberta: false },
        intermediarias: [{ inicio: t("03:20"), fim: t("03:27"), lat: LOCAL.lat + 0.004, lng: LOCAL.lng, minutos: 7, aberta: false }],
        unidade: { paradaId: 7, hospitalId: H.id, entrada: t("04:10"), saida: t("04:52") },
        chegadaBase: null,
        tempos: { saida: { minutos: 4, aberto: false }, resposta: { minutos: 27, aberto: false }, noLocal: { minutos: 23, aberto: false },
                  transporte: { minutos: 12, aberto: false }, naUnidade: { minutos: 42, aberto: false }, retorno: { minutos: 115, aberto: true } },
    };
    const d = montarDetalhe({
        viatura: viatura({}), ocorrencia: { ...oc("CHEGADA AO HOSPITAL", t("04:13")), ativa: true }, status, paradas: [parada({})],
        posicoes: [{ em: t("03:00"), ...LONGE }, { em: t("03:40"), ...LOCAL }, { em: t("04:05"), ...LONGE }, { em: t("05:30"), ...LONGE }],
        locais: LOCAIS_FROTA, janela: jan(t("03:08")), agora, fases,
    });
    const fase = (titulo: RegExp) => d.linha.find((x) => x.tipo === "fase" && titulo.test(x.titulo));
    assert.equal(fase(/^Saiu da base/)?.detalhe, "pelo GPS");
    assert.match(fase(/^Chegou ao local/)!.detalhe!, /parada de 23 min · equipe registrou 03:41 \(\+6 min\)/);
    assert.match(fase(/^Saiu do local/)!.detalhe!, /23 min no local/);
    // parada de 7 min a ~450 m, antes do local: talvez procurando o endereço
    assert.equal(fase(/^Parada de 7 min a/)?.tom, "atencao");
    // o ponto de antes da vinculação fica fora da janela; os outros têm fase
    assert.deepEqual(d.rastro.map((p) => p.fase), ["local", "transporte", "retorno"]);
    assert.equal(d.fases?.registrado.chegadaLocal, t("03:41").toISOString());
    assert.equal(d.fases?.tempos.resposta?.minutos, 27);
});
