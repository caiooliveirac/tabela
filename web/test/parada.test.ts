// NOVO-10: a tabela pinta a parada pelo alerta da api, não só pelos minutos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COR, corDaParada } from "../src/components/frota/formato.ts";

test("parada: vermelho só com alerta; livre passada do limite não pinta de vermelho", () => {
  assert.equal(corDaParada({ minutos: 70, alerta: true }, 40), COR.alerta);
  assert.equal(corDaParada({ minutos: 70, alerta: false }, 40), COR.livre);
  assert.equal(corDaParada({ minutos: 35, alerta: false }, 40), COR.atrasada);
  assert.equal(corDaParada({ minutos: 10, alerta: false }, 40), COR.hospital);
});
