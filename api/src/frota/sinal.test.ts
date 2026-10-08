import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO, numeroNoLimite } from "./catalogo.js";
import { lerDispositivos, lerPosicoes } from "./samumais.js";
import { resolverPosicoes, type ViaturaFrota } from "./painel.js";
import {
    avancarQuedas, bateriaBaixa, causa, cortar, duracao, elegivel, instaveisAgora, plantaoDe, ranking,
    resumoDevido, textoFimQueda, textoFrota, textoQueda, textoResumo,
    type Queda, type QuedaRecente,
} from "./sinal.js";

const t = (hhmm: string, dia = "2026-09-29") => new Date(`${dia}T${hhmm}:00-03:00`);
const AGORA = t("16:00");
const antes = (min: number, de = AGORA) => new Date(de.getTime() - min * 60_000);

/** Viatura do painel, transmitindo há `silencio` min (null = nunca apareceu). */
function vt(chave: string, silencio: number | null = 1, extra: Partial<ViaturaFrota> = {}): ViaturaFrota {
    return {
        chave, codigo: chave, nome: chave, nomeSamu: null, nomeDifere: false, tipo: "USB", base: null, turno: "24h",
        situacao: silencio !== null && silencio <= 60 ? "mapa" : "sem-sinal", motivo: null, foraDoCatalogo: false,
        posicao: silencio === null ? null : { lat: -12.9, lng: -38.4, em: antes(silencio).toISOString(), idadeMin: silencio },
        naBase: false, bateria: null, bateriaEm: null, bateriaAntes: null, sinal: null, conexao: null, evento: null,
        velocidade: null, noHospital: null, desativacao: null, ocorrencia: null,
        ...extra,
    };
}

const passo = (abertas: Map<string, Queda>, viaturas: ViaturaFrota[], recentes: QuedaRecente[] = [], agora = AGORA) =>
    avancarQuedas(abertas, recentes, viaturas, new Map(), agora);

test("numeral até 74: o resto é dado lixo, no catálogo e no nome do SAMU+", () => {
    assert.ok(numeroNoLimite("PB 60 [A]"));
    assert.ok(numeroNoLimite("CC74"));
    assert.ok(!numeroNoLimite("MT 76 (SF)"));
    assert.ok(numeroNoLimite("LFEX"));
    assert.ok(!CATALOGO.some((c) => c.codigo === "CD99"));

    const posicoes = lerPosicoes([
        { id_equipe: 1, data_evento: "2026-09-29 15:59:00", latitude: "-12.9", longitude: "-38.4" },
        { id_equipe: 2, data_evento: "2026-09-29 15:59:00", latitude: "-12.9", longitude: "-38.4" },
    ]);
    const dispositivos = [
        { unidadeSamu: 10, equipe: 1, nome: "MT 76 (SF)", bateria: null, sinal: null, velocidade: null },
        { unidadeSamu: 11, equipe: 2, nome: "LF 91", bateria: null, sinal: null, velocidade: null },
    ];
    assert.equal(resolverPosicoes(posicoes, dispositivos, CATALOGO).size, 0);
});

test("página de status: situação, conexão, hora e tendência da bateria, último evento", () => {
    const html = `<script>var devices = {"unidade:1":{"unitId":"226","teamId":"255","unitName":"IT 30 (A)",
"battery":15,"signal":25,"speed":0,"status":"online","connection":"none","history":[
{"source":"Localização","event":"LOCALIZACAO","timestamp":1790706848,"battery":null},
{"source":"Auditoria","event":"OFFLINE","timestamp":1790706000,"battery":15,"connection":"none"},
{"source":"Auditoria","event":"ONLINE","timestamp":1790700000,"battery":15},
{"source":"Auditoria","event":"OFFLINE","timestamp":1790690000,"battery":22}]}};</script>`;
    const [d] = lerDispositivos(html);
    assert.equal(d.status, "online");
    assert.equal(d.conexao, "none");
    assert.equal(d.bateriaEm, new Date(1790706000 * 1000).toISOString());
    assert.equal(d.bateriaAntes, 22);
    assert.deepEqual(d.evento, { tipo: "OFFLINE", em: new Date(1790706000 * 1000).toISOString() });
});

test("queda: abre aos 10 min, não abre velha (30 min+) nem fora do turno ou desativada", () => {
    const r = passo(new Map(), [
        vt("CB27", 12),
        vt("CB25", 35),
        vt("CB26", 5),
        vt("CN12", 12, { motivo: "fora da escala oficial agora" }),
        vt("PB67", 12, { situacao: "desativada" }),
        vt("CN10", null),
    ]);
    assert.deepEqual(r.novas.map((q) => q.chave), ["CB27"]);
    assert.equal(r.novas[0].avisar, true);
    assert.equal(r.novas[0].desde.getTime(), antes(12).getTime());
    assert.equal(r.surto, null);
});

test("queda: fecha quando volta, quando sai do turno e aos 3 h (crônica)", () => {
    const abertas = new Map<string, Queda>([
        ["CB27", { chave: "CB27", desde: antes(30), abertaEm: antes(20), avisar: true, silenciada: null }],
        ["CN12", { chave: "CN12", desde: antes(30), abertaEm: antes(20), avisar: true, silenciada: null }],
        ["PM43", { chave: "PM43", desde: antes(3 * 60), abertaEm: antes(170), avisar: true, silenciada: null }],
        ["PM45", { chave: "PM45", desde: antes(30), abertaEm: antes(20), avisar: true, silenciada: null }],
    ]);
    const r = passo(abertas, [
        vt("CB27", 1),
        vt("CN12", 30, { situacao: "fora-do-turno" }),
        vt("PM43", 3 * 60),
        vt("PM45", 30),
    ]);
    const motivo = Object.fromEntries(r.fechadas.map((f) => [f.queda.chave, f.motivo]));
    assert.deepEqual(motivo, { CB27: "voltou", CN12: "fora-do-turno", PM43: "cronica" });
    assert.equal(r.fechadas.find((f) => f.queda.chave === "CB27")!.volta!.getTime(), antes(1).getTime());
    assert.deepEqual([...r.abertas.keys()], ["PM45"]);
});

test("queda reincidente (até 60 min da volta anterior): silenciada, vai ao grupo se passar de 30 min", () => {
    const recentes = [{ chave: "CB27", desde: antes(80), volta: antes(50), fechadaEm: antes(48) }];
    const r = passo(new Map(), [vt("CB27", 12)], recentes);
    assert.equal(r.novas[0].avisar, false);
    assert.equal(r.novas[0].silenciada, "reincidente");

    // 18 min depois, ainda sem posição nova: 30 min mudo.
    const depois = passo(r.abertas, [vt("CB27", 12)], recentes, new Date(AGORA.getTime() + 18 * 60_000));
    assert.equal(depois.promovidas.length, 1);
    assert.equal(depois.abertas.get("CB27")!.avisar, true);

    // Volta há mais de 60 min: queda nova, avisa.
    const longe = passo(new Map(), [vt("CB27", 12)], [{ chave: "CB27", desde: antes(200), volta: antes(150), fechadaEm: antes(148) }]);
    assert.equal(longe.novas[0].avisar, true);
});

test("sinal instável: 3 quedas em 3 h (a atual conta), um aviso a cada 6 h", () => {
    const recentes: QuedaRecente[] = [
        { chave: "SM18", desde: antes(170), volta: antes(150), fechadaEm: antes(150) },
        { chave: "SM18", desde: antes(100), volta: antes(85), fechadaEm: antes(84) },
    ];
    const r = passo(new Map(), [vt("SM18", 12)], recentes);
    assert.deepEqual(r.instaveis, [{ chave: "SM18", quedas: 3, minutos: 47 }]);
    const jaAvisou = avancarQuedas(new Map(), recentes, [vt("SM18", 12)], new Map([["SM18", antes(60)]]), AGORA);
    assert.equal(jaAvisou.instaveis.length, 0);
    assert.equal(instaveisAgora(recentes, r.abertas, AGORA).get("SM18")!.quedas, 3);
});

test("surto: 8 quedas no mesmo ciclo = SAMU+ parado, nenhum aviso individual", () => {
    const viaturas = ["CB25", "CB26", "CB27", "CB28", "CN10", "CN11", "CN12", "CN13"].map((c) => vt(c, 11));
    const r = passo(new Map(), viaturas);
    assert.equal(r.surto, 8);
    assert.ok(r.novas.every((q) => !q.avisar && q.silenciada === "surto"));
});

test("bateria: abaixo de 20%, lida há até 30 min, transmitindo e sem subir", () => {
    const b = (extra: Partial<ViaturaFrota>, silencio = 1) =>
        bateriaBaixa(vt("IT30", silencio, { tipo: "USA", bateria: 15, bateriaEm: antes(10).toISOString(), bateriaAntes: 22, ...extra }), AGORA);
    assert.ok(b({}));
    assert.ok(b({ bateriaAntes: null }));
    assert.ok(!b({ bateria: 20 }));
    assert.ok(!b({ bateriaAntes: 9 }), "carregando");
    assert.ok(!b({ bateriaEm: antes(45).toISOString() }), "leitura velha");
    assert.ok(!b({}, 15), "muda: a queda avisa");
    assert.ok(!b({ situacao: "desativada" }));
});

test("plantão e resumo: 07–19 é D, 19–07 é N do dia em que começou; resumo 07:30 e 19:30", () => {
    assert.equal(plantaoDe(t("06:59")), "2026-09-28-N");
    assert.equal(plantaoDe(t("07:00")), "2026-09-29-D");
    assert.equal(plantaoDe(t("19:00")), "2026-09-29-N");
    assert.equal(resumoDevido(t("19:29")), null);
    assert.equal(resumoDevido(t("19:30")), "2026-09-29 19:30");
    assert.equal(resumoDevido(t("20:29")), "2026-09-29 19:30");
    assert.equal(resumoDevido(t("20:31")), null);
    assert.equal(resumoDevido(t("07:45")), "2026-09-29 07:30");
});

test("ranking: tempo fora de ação manda, USA pesa 1,5×, crônica fica fora", () => {
    const parada = (min: number) => ({
        id: 1, hospitalId: "hge", hospitalNome: "HGE", entrada: antes(min).toISOString(), ultimaVez: antes(1).toISOString(),
        minutos: min, alerta: true, naBase: false, distanciaM: 20,
    });
    const r = ranking(
        [
            vt("CB27", 50),                                   // sem sinal: 50 + 10 = 60
            vt("CB25", 4 * 60),                               // muda há 4 h: crônica
            vt("PP20", 29, { tipo: "USA" }),                  // (29 + 10) × 1,5 = 58,5
            vt("PM45", 1, { noHospital: parada(70) }),        // parada 70
            vt("IT30", 1, { tipo: "USA", bateria: 5, bateriaEm: antes(20).toISOString() }), // 2 × 15 × 1,5 = 45
            vt("CB28", 1, { noHospital: parada(30) }),        // parada abaixo de 40: nada
            vt("BR05", 30 * 60),                              // crônica
            vt("CN10", null),                                 // nunca apareceu: crônica
            vt("CN12", 30, { situacao: "fora-do-turno" }),    // fora da conta
        ],
        new Map(),
        AGORA,
    );
    assert.deepEqual(r.itens.map((i) => i.chave), ["PM45", "CB27", "PP20", "IT30"]);
    assert.deepEqual(r.cronicas, ["CB25 12:00", "BR05 28/09 10:00", "CN10 nunca"]);
    assert.equal(r.escaladas, 8);
    assert.equal(r.transmitindo, 3);
    const texto = textoFrota(r, AGORA);
    assert.match(texto, /1\. <b>PM45<\/b> \(USB\) — ⏱ <b>1h10<\/b> no HGE/);
    assert.match(texto, /⚫ 3 sem transmitir há 3 h\+ \(fora do ranking\): CB25 12:00, BR05 28\/09 10:00, CN10 nunca/);
});

test("textos: queda com causa do SAMU+, volta responde, crônica só edita", () => {
    const v = vt("CB27", 12, { conexao: "none", evento: { tipo: "OFFLINE", em: antes(11).toISOString() }, bateria: 8, bateriaEm: antes(11).toISOString() });
    const q: Queda = { chave: "CB27", desde: antes(12), abertaEm: antes(2), avisar: true, silenciada: null };
    assert.match(causa(v, q.desde, AGORA)!, /<b>sem internet<\/b> \(app caiu às 15:49\) · bateria <b>8%<\/b>/);
    // Evento velho (de antes da queda) não é causa desta queda.
    assert.equal(causa(vt("CB27", 12, { evento: { tipo: "OFFLINE", em: antes(300).toISOString() } }), q.desde, AGORA), null);
    const texto = textoQueda(v, q, AGORA);
    assert.match(texto, /📵 <b>CB27<\/b> \(USB\) <b>sem sinal<\/b> há <b>12 min<\/b> — última posição 15:48/);
    assert.match(texto, /aviso das 15:58, atualizado às 16:00/);

    const volta = textoFimQueda(v, { queda: q, volta: antes(0), motivo: "voltou" }, AGORA);
    assert.match(volta.resposta!, /voltou a transmitir às 16:00 — 12 min sem sinal/);
    assert.equal(textoFimQueda(v, { queda: q, volta: null, motivo: "cronica" }, AGORA).resposta, null);
    assert.equal(duracao(125), "2h05");
});

test("resumo do plantão: seções só com o que tem, crônicas numa linha", () => {
    const texto = textoResumo([vt("CB27", 40), vt("CB26", 90), vt("BR05", 30 * 60), vt("PM45", 1)], new Map(), AGORA);
    assert.match(texto, /📋 <b>Frota — troca de plantão<\/b> \(16:00\)/);
    assert.match(texto, /1 de 4 escaladas transmitindo/);
    // Mais antiga primeiro.
    assert.match(texto, /📵 <b>Sem sinal<\/b> \(2\)\n• <b>CB26<\/b> \(USB\) desde 14:30\n• <b>CB27<\/b> \(USB\) desde 15:20/);
    assert.match(texto, /⚫ <b>Sem transmitir há 3 h\+<\/b> \(1\): BR05 28\/09 10:00/);
    assert.doesNotMatch(texto, /Bateria|Paradas/);
    assert.ok(elegivel(vt("CB27")));
});

test("cortar: respeita o limite do Telegram inteiro por linha", () => {
    const linhas = Array.from({ length: 100 }, (_, i) => `<b>linha ${i}</b> ${"x".repeat(80)}`);
    const s = cortar(linhas);
    assert.ok(s.length <= 4000);
    assert.ok(s.endsWith("…"));
});

// ── Desativação informada no painel ─────────────────────────────

const DES = {
    id: 7, codigo: "CB27", motivos: ["mecanica" as const], observacao: null, informadoPor: "Ana", posto: "radio" as const,
    origem: "frota" as const, desde: antes(90).toISOString(), reativadaEm: null, reativadaPor: null,
};

test("desativação: esquema exige motivo, nome e posto; \"Outro\" pede observação", async () => {
    const { esquemaDesativar } = await import("./desativacoes.js");
    const ok = { codigo: "CB27", motivos: ["mecanica"], informadoPor: "Ana", posto: "radio" };
    assert.ok(esquemaDesativar.safeParse(ok).success);
    assert.ok(!esquemaDesativar.safeParse({ ...ok, motivos: [] }).success);
    assert.ok(!esquemaDesativar.safeParse({ ...ok, motivos: ["pneu_furado"] }).success, "só os códigos do motivo_baixa do Huddle");
    assert.ok(!esquemaDesativar.safeParse({ ...ok, informadoPor: " " }).success);
    assert.ok(!esquemaDesativar.safeParse({ ...ok, posto: "regulador" }).success);
    assert.ok(!esquemaDesativar.safeParse({ ...ok, motivos: ["outro"] }).success);
    assert.ok(esquemaDesativar.safeParse({ ...ok, motivos: ["outro"], observacao: "batida leve" }).success);
    // origem: opcional (quem já posta sem ela continua valendo, como "frota"); só os três apps.
    assert.equal(esquemaDesativar.parse(ok).origem, "frota");
    assert.equal(esquemaDesativar.parse({ ...ok, origem: "quadro" }).origem, "quadro");
    assert.equal(esquemaDesativar.parse({ ...ok, origem: "huddle" }).origem, "huddle");
    assert.equal(esquemaDesativar.parse({ ...ok, origem: "relatorio" }).origem, "relatorio");
    assert.equal(esquemaDesativar.parse({ ...ok, origem: "mesa" }).origem, "mesa");
    assert.ok(!esquemaDesativar.safeParse({ ...ok, origem: "telegram" }).success);
    // Sem motivo só de fora do painel: lá a chefia desativa num clique e o motivo vem depois.
    assert.ok(esquemaDesativar.safeParse({ ...ok, motivos: [], origem: "relatorio" }).success);
    assert.ok(esquemaDesativar.safeParse({ ...ok, motivos: [], origem: "mesa" }).success);
    assert.ok(!esquemaDesativar.safeParse({ ...ok, motivos: [], origem: "frota" }).success);
});

test("desativação sem motivo: o grupo e o painel cobram, e o motivo chega depois", async () => {
    const { esquemaMotivo, motivoPainel, textoDesativacao, textoMotivo } = await import("./desativacoes.js");
    const sem = { ...DES, motivos: [], posto: "chefe" as const, origem: "mesa" as const };
    assert.match(textoDesativacao(sem, "USA"), /<b>desativada<\/b> na Mesa operacional por Ana \(Chefe\): <b>sem motivo informado<\/b>/);
    assert.match(textoDesativacao(sem, "USA"), /Falta o <b>motivo<\/b>/);
    assert.doesNotMatch(textoDesativacao(DES, "USB"), /Falta o/);
    assert.equal(motivoPainel(sem), "sem motivo informado · Ana (Chefe) na Mesa operacional às 14:30");
    assert.ok(!esquemaMotivo.safeParse({ motivos: [], informadoPor: "Bia" }).success);
    assert.ok(esquemaMotivo.safeParse({ motivos: ["medico"], informadoPor: "Bia" }).success);
    assert.equal(textoMotivo({ ...sem, motivos: ["medico"] }, "Bia"), "📝 <b>CB27</b> desativada: motivo informado por Bia — Médico(a)");
});

test("desativação: textos do grupo ao desativar e ao reativar", async () => {
    const { textoDesativacao, motivoPainel } = await import("./desativacoes.js");
    assert.match(textoDesativacao(DES, "USB"), /⛔ <b>CB27<\/b> \(USB\) <b>desativada<\/b> por Ana \(Rádio-operador\(a\)\): Mecânica ou pneu/);
    const volta = { ...DES, reativadaEm: AGORA.toISOString(), reativadaPor: "Bruno" };
    assert.match(textoDesativacao(volta, "USB"), /✅ <b>CB27<\/b> \(USB\) <b>reativada<\/b> por Bruno às 16:00 — ficou 1h30 desativada/);
    assert.equal(motivoPainel({ ...DES, motivos: ["outro"], observacao: "batida" }), "batida · Ana (Rádio-operador(a)) às 14:30");
    // Informada no Quadro ou no Huddle: o grupo e o painel dizem onde.
    const quadro = { ...DES, origem: "quadro" as const };
    assert.match(textoDesativacao(quadro, "USB"), /<b>desativada<\/b> no Quadro Informativo por Ana \(Rádio-operador\(a\)\)/);
    assert.equal(motivoPainel(quadro), "Mecânica ou pneu · Ana (Rádio-operador(a)) no Quadro Informativo às 14:30");
    assert.equal(motivoPainel({ ...DES, origem: "huddle" }), "Mecânica ou pneu · Ana (Rádio-operador(a)) no Huddle às 14:30");
});

test("desativação: a virada do plantão encerra num aviso só", async () => {
    const { textoVirada } = await import("./desativacoes.js");
    const txt = textoVirada([DES, { ...DES, codigo: "BR05", motivos: ["enfermeiro", "medico"] }]);
    assert.match(txt, /Virada do plantão/);
    assert.match(txt, /• <b>CB27<\/b> — Mecânica ou pneu\n• <b>BR05<\/b> — Enfermeiro\(a\), Médico\(a\)/);
});

test("desativação: some dos avisos — queda fecha como desativada, fora do ranking, lembrada no resumo", () => {
    const v = vt("CB27", 20, { situacao: "desativada", motivo: "Mecânica ou pneu · Ana", desativacao: DES });
    const abertas = new Map<string, Queda>([["CB27", { chave: "CB27", desde: antes(20), abertaEm: antes(10), avisar: true, silenciada: null }]]);
    const r = passo(abertas, [v]);
    assert.equal(r.fechadas[0].motivo, "desativada");
    assert.match(textoFimQueda(v, r.fechadas[0], AGORA).edicao, /<b>desativada<\/b> no painel/);
    assert.equal(passo(new Map(), [v]).novas.length, 0);

    const rk = ranking([v, vt("CB25", 20)], new Map(), AGORA);
    assert.deepEqual(rk.itens.map((i) => i.chave), ["CB25"]);
    assert.deepEqual(rk.desativadas, ["CB27"]);
    assert.match(textoFrota(rk, AGORA), /⛔ 1 desativadas no painel: CB27/);
    assert.match(textoResumo([v], new Map(), AGORA), /⛔ <b>Desativadas no painel<\/b> \(1\)[^\n]*\n• <b>CB27<\/b> \(USB\) desde 14:30 — Mecânica ou pneu \(Ana\)/);
});

test("desativação: no painel vale mesmo transmitindo, com quem e por quê no motivo", async () => {
    const { montarPainel } = await import("./painel.js");
    const { HOSPITAIS_FROTA } = await import("./hospitais.js");
    const posicoes = lerPosicoes([{ id_equipe: 9, data_evento: "2026-09-29 15:59:00", latitude: "-12.9", longitude: "-38.4" }]);
    const dispositivos = [{ unidadeSamu: 1, equipe: 9, nome: "CB 27", bateria: null, sinal: null, velocidade: null }];
    const painel = montarPainel({
        ativo: true, coletadoEm: AGORA, vinculosEm: AGORA, erro: null,
        catalogo: CATALOGO, desativadas: new Set(["CB27"]), desativacoes: new Map([["CB27", DES]]),
        hospitais: HOSPITAIS_FROTA, resolvidas: resolverPosicoes(posicoes, dispositivos, CATALOGO), dispositivos,
        abertas: new Map(), agora: AGORA,
    });
    const v = painel.viaturas.find((x) => x.chave === "CB27")!;
    assert.equal(v.situacao, "desativada");
    assert.equal(v.motivo, "Mecânica ou pneu · Ana (Rádio-operador(a)) às 14:30");
    assert.equal(v.desativacao?.id, 7);
    assert.equal(painel.viaturas.find((x) => x.chave === "CB25")!.desativacao, null);
});

test("aviso de parada: desativada no painel encerra a mensagem", async () => {
    const { textoAviso } = await import("./aviso.js");
    const d = { nome: "CB27", tipo: "USB", hospitalNome: "HGE", entrada: antes(50), ultimaVez: antes(2) };
    assert.match(textoAviso(d, { tipo: "desativada", em: AGORA }), /no <b>HGE<\/b>: <b>desativada<\/b> no painel às 16:00 — aviso encerrado \(entrou 15:10, 48 min/);
});
