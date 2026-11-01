import { test } from "node:test";
import assert from "node:assert/strict";
import { ateSegundaOrdemAgora, esquemaAtivar } from "./ativacoes.js";

test("ativada neste plantão sai da lista até segunda ordem; as outras ficam", () => {
    const lista = new Set(["PR36", "JA39", "PM48"]);
    assert.deepEqual([...ateSegundaOrdemAgora(lista, ["JA39"])], ["PR36", "PM48"]);
    assert.equal(lista.size, 3, "não mexe na lista do catálogo");
    assert.deepEqual([...ateSegundaOrdemAgora(lista, ["SM01"])], ["PR36", "JA39", "PM48"]);
});

test("ativar pede quem ativa; origem padrão é o Quadro", () => {
    assert.equal(esquemaAtivar.parse({ codigo: "PR36", ativadaPor: "Fulana" }).origem, "quadro");
    assert.throws(() => esquemaAtivar.parse({ codigo: "PR36", ativadaPor: "" }));
});
