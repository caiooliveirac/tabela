import { test } from "node:test";
import assert from "node:assert/strict";
import { baseOcupada, textoBaseOcupada, textoCobranca, textoFimForaDaCerca, textoForaDaCerca } from "./aviso.js";

const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00-03:00`);
const d = { nome: "SM01", hospitalNome: "HGE", entrada: t("14:00") };

test("cobrança chama o médico pelo nome, com link do Acolhimentos (formatação do WhatsApp)", () => {
    const s = textoCobranca(d, "Fulano", t("14:45"));
    assert.match(s, /\*SM01\* presa no \*HGE\* há \*45 min\* \(chegou 14:00\)/);
    assert.match(s, /Dr\(a\)\. \*Fulano\*, por favor abra o aplicativo/);
    assert.match(s, /https:\/\/acolhimentos\.mnrs\.com\.br\//);
    assert.doesNotMatch(s, /<b>/);
    assert.match(s, /registre a demora para acolher o paciente/);
    assert.doesNotMatch(s, /maca/i);
});

test("dupla do Plantões vira dois nomes; sem nome, chama o médico da viatura", () => {
    assert.match(textoCobranca(d, "Fulano + Beltrano", t("14:45")), /Dr\(a\)\. \*Fulano\* e Dr\(a\)\. \*Beltrano\*/);
    assert.match(textoCobranca(d, null, t("14:45")), /Médico\(a\) da \*SM01\*/);
    assert.match(textoCobranca(d, "  ", t("14:45")), /Médico\(a\) da \*SM01\*/);
});

test("UPA leva artigo feminino; asterisco no nome não quebra o negrito", () => {
    const s = textoCobranca({ ...d, hospitalNome: "UPA Barris" }, "Ana *Maria*", t("14:50"));
    assert.match(s, /presa na \*UPA Barris\* há \*50 min\*/);
    assert.match(s, /Dr\(a\)\. \*Ana Maria\*/);
});

test("balanço agrupa por hospital, pior primeiro, e convida quem não registrou", async () => {
    const { textoBalanco } = await import("./aviso.js");
    const r = (codigo: string, hospital: string, minutos: number, extra = {}) => ({
        codigo, tipo: "USA", hospital, minutos, presa: false, semRegistro: false, medico: null, ...extra,
    });
    const s = textoBalanco(
        [
            r("SM01", "HGE", 130, { semRegistro: true, medico: "Fulano + Beltrano" }),
            r("CB02", "HGE", 95, { presa: true }),
            r("PR03", "Roberto Santos", 300),
            r("IT30", "HGE", 50, { tipo: "USB" }),
        ],
        { agora: t("07:00"), conferido: true, alertaMin: 40 },
    );
    assert.match(s, /plantão noturno · qua 30\/09/);
    assert.ok(s.indexOf("*HGE* — 3 viaturas") < s.indexOf("*Roberto Santos* — 1 viatura"));
    assert.match(s, /• SM01 \(USA\) · \*2h10\*\n• CB02 \(USA\) · \*1h35\* ⏳ ainda presa\n• IT30 \(USB\) · \*50 min\*/);
    assert.match(s, /• SM01 no HGE \(2h10\) — Dr\(a\)\. \*Fulano\* e Dr\(a\)\. \*Beltrano\*/);
    assert.match(s, /acolhimentos\.mnrs\.com\.br/);
});

test("balanço: diurno às 19h, plantão limpo, e sem convite quando o Acolhimentos não respondeu", async () => {
    const { textoBalanco } = await import("./aviso.js");
    assert.match(textoBalanco([], { agora: t("19:00"), conferido: true, alertaMin: 40 }), /plantão diurno · qui 01\/10[\s\S]*Nenhuma viatura/);
    const s = textoBalanco(
        [{ codigo: "SM01", tipo: "USA", hospital: "HGE", minutos: 60, presa: false, semRegistro: true, medico: null }],
        { agora: t("19:00"), conferido: false, alertaMin: 40 },
    );
    assert.doesNotMatch(s, /Acolhimentos/);
});

test("na base mas em ocorrência: só depois de 40 min, contando da chegada ou da abertura", () => {
    const t = (hhmm: string) => new Date(`2026-10-09T${hhmm}:00-03:00`);
    const o = {
        protocolo: "0617", medico: "FULANA DE TAL", status: "DISPONÍVEL / RETORNO À BASE", statusEm: t("15:58").toISOString(),
        abertura: t("14:07").toISOString(), risco: "Amarelo", regulacaoSecundaria: false,
        endereco: null, bairro: null, queixa: null, hma: null,
    };
    const v = {
        nome: "PP21", base: "PERIPERI", naBase: false,
        noHospital: { naBase: true, hospitalNome: "UPA Adroaldo Albergaria" },
        ocorrencia: { ocorrencia: o },
    };
    assert.equal(baseOcupada(v, t("15:56"), t("16:30"), 40), null); // 34 min
    const b = baseOcupada(v, t("15:56"), t("16:36"), 40)!;
    assert.equal(b.minutos, 40);
    const txt = textoBaseOcupada(b);
    assert.match(txt, /🚨🏠 <b>PP21 está na base, mas ainda EM OCORRÊNCIA!<\/b>/);
    assert.match(txt, /dentro da <b>UPA Adroaldo Albergaria<\/b>/);
    assert.match(txt, /ocorrência <b>0617<\/b> · MR <b>Fulana De Tal<\/b>/);
    assert.match(txt, /↩ Apertou retorno à base: disponível \/ retorno à base às 15:58/);
    assert.match(txt, /dificuldade de acolhimento/);
    // Livre ou fora da base: nada.
    assert.equal(baseOcupada({ ...v, ocorrencia: { ocorrencia: null } }, t("15:00"), t("17:00"), 40), null);
    assert.equal(baseOcupada({ ...v, noHospital: null }, t("15:00"), t("17:00"), 40), null);
    // Estava na base desde cedo e foi despachada às 16:00: conta da abertura.
    const nova = { ...v, ocorrencia: { ocorrencia: { ...o, status: "DESIGNADA", abertura: t("16:00").toISOString() } } };
    assert.equal(baseOcupada(nova, t("10:00"), t("16:30"), 40), null);
    assert.equal(baseOcupada(nova, t("10:00"), t("16:40"), 40)!.minutos, 40);
});

test("saiu da cerca: hospital, hora, status de chegada, ocorrência, distância e a ação", () => {
    const d = (hhmm: string) => new Date(`2026-11-22T${hhmm}:00-03:00`);
    const texto = textoForaDaCerca({
        nome: "SM01", tipo: "USA", hospitalNome: "HGE", saiuEm: d("04:52"), minutos: 15, statusEm: d("04:13"),
        naBase: false, distanciaM: 10429,
        ocorrencia: {
            protocolo: "0119", medico: "FULANO EXEMPLO", status: "CHEGADA AO HOSPITAL", statusEm: d("04:13").toISOString(),
            abertura: null, risco: null, regulacaoSecundaria: false, endereco: null, bairro: null, queixa: null, hma: null,
        },
    });
    assert.match(texto, /<b>SM01<\/b> \(USA\) saiu do <b>HGE<\/b> às 04:52 — há <b>15 min<\/b>/);
    assert.match(texto, /"chegada ao hospital" \(desde 04:13\) · ocorrência <b>0119<\/b> · MR <b>Fulano Exemplo<\/b>/);
    assert.match(texto, /Está a 10,4 km de lá/);
    assert.match(texto, /confirmar com a equipe e atualizar o status/);
    assert.match(textoForaDaCerca({ nome: "SM01", tipo: null, hospitalNome: "UPA Exemplo", saiuEm: d("04:52"), minutos: 20, statusEm: null, naBase: true, distanciaM: 900, ocorrencia: null }), /saiu da <b>UPA Exemplo<\/b>[\s\S]*Já está na própria base/);

    const agora = d("05:30");
    assert.equal(
        textoFimForaDaCerca("SM01", d("04:52"), { tipo: "status", status: "DISPONÍVEL / RETORNO À BASE", em: d("05:20").toISOString() }, agora),
        "✅ <b>SM01</b>: status atualizado — disponível / retorno à base às 05:20 — 28 min depois de sair",
    );
    assert.match(textoFimForaDaCerca("SM01", d("04:52"), { tipo: "livre" }, agora)!, /liberada no mapa de equipes às 05:30 — 38 min/);
    assert.match(textoFimForaDaCerca("SM01", d("04:52"), { tipo: "voltou", hospitalNome: "HGE", em: d("05:10").toISOString() }, agora)!, /entrou no <b>HGE<\/b> às 05:10/);
    assert.equal(textoFimForaDaCerca("SM01", d("04:52"), { tipo: "encerrado" }, agora), null);
});
