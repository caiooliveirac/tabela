// Filtros da aba Frota: disponível, em ocorrência, só em movimento e os recortes extras.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTRO_VAZIO, atividade, filtroAtivo, onde, passa } from "../src/components/frota/filtro.ts";
import type { ViaturaFrota } from "../src/lib/types.ts";

function vt(p: Partial<ViaturaFrota> = {}): ViaturaFrota {
  return {
    chave: "CB02", codigo: "CB02", nome: "CB02", nomeSamu: "CB 02 (A)", nomeDifere: false, tipo: "USB",
    base: "PAU MIÚDO", turno: "24h", situacao: "mapa", motivo: null, foraDoCatalogo: false,
    posicao: { lat: -12.9, lng: -38.4, em: "2026-10-30T12:00:00Z", idadeMin: 1 },
    naBase: false, bateria: 80, sinal: 100, velocidade: 0, ocorrencia: { ocorrencia: null }, noHospital: null,
    ...p,
  };
}

const oc = (status: string, risco = "Vermelho") => ({
  ocorrencia: {
    protocolo: "0492", medico: null, status, statusEm: null, risco, regulacaoSecundaria: false,
    endereco: null, bairro: "BARRIS", queixa: "DISP", hma: null,
  },
});

test("atividade: livre parada é disponível; andando sem ocorrência é movimento", () => {
  assert.equal(atividade(vt()), "disponivel");
  assert.equal(atividade(vt({ velocidade: 40 })), "movimento");
  assert.equal(atividade(vt({ velocidade: 40, ocorrencia: oc("CHEGADA AO LOCAL") })), "ocorrencia");
  assert.equal(atividade(vt({ ocorrencia: oc("DISPONÍVEL / RETORNO À BASE") })), "retornando");
  // Fora do mapa de equipes: não se afirma que está livre.
  assert.equal(atividade(vt({ ocorrencia: null })), "sem-info");
  assert.equal(atividade(vt({ ocorrencia: null, velocidade: 30 })), "movimento");
});

test("onde: base vence hospital; hospital da própria base conta como base", () => {
  const noHospital = {
    id: 1, hospitalId: "hge", hospitalNome: "HGE", entrada: "", ultimaVez: "", minutos: 12,
    alerta: false, naBase: false, distanciaM: 30,
  };
  assert.equal(onde(vt()), "rua");
  assert.equal(onde(vt({ noHospital })), "hospital");
  assert.equal(onde(vt({ noHospital: { ...noHospital, naBase: true } })), "base");
  assert.equal(onde(vt({ naBase: true })), "base");
});

test("passa: combina filtros e busca sem acento", () => {
  const v = vt({ tipo: "USA", ocorrencia: oc("CHEGADA AO HOSPITAL"), bateria: 10 });
  assert.equal(filtroAtivo(FILTRO_VAZIO), false);
  assert.ok(passa(v, FILTRO_VAZIO, 15));
  assert.ok(passa(v, { ...FILTRO_VAZIO, atividade: "ocorrencia", tipos: ["USA"], risco: "vermelho" }, 15));
  assert.ok(!passa(v, { ...FILTRO_VAZIO, tipos: ["USB"] }, 15));
  assert.ok(!passa(v, { ...FILTRO_VAZIO, fase: "CHEGADA AO LOCAL" }, 15));
  assert.ok(passa(v, { ...FILTRO_VAZIO, bateriaBaixa: true }, 15));
  assert.ok(!passa(v, { ...FILTRO_VAZIO, posicaoVelha: true }, 15));
  assert.ok(passa(v, { ...FILTRO_VAZIO, busca: "pau miudo" }, 15));
  assert.ok(passa(v, { ...FILTRO_VAZIO, busca: "barris" }, 15));
  assert.ok(!passa(v, { ...FILTRO_VAZIO, busca: "cajazeiras" }, 15));
});
