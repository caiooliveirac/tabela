// S2OUT-61: 502/503 de deploy viravam "sessão expirou". Roda com `npm test`
// (node --test, tipos removidos pelo próprio node — sem dependência nova).
import { test } from "node:test";
import assert from "node:assert/strict";
import { semSessao, transitorio } from "../src/api/resposta.ts";

const resp = (status: number, url = "https://mnrs.com.br/tabela/api/cases", redirected = false) =>
  ({ status, url, redirected });

test("401 do portão é sessão vencida", () => {
  assert.equal(semSessao(resp(401)), true);
});

test("302 para o portal (fetch seguiu até a página de login) é sessão vencida", () => {
  assert.equal(semSessao(resp(200, "https://mnrs.com.br/?proximo=tabela", true)), true);
});

test("503 com /index.html durante deploy NÃO é sessão, é transitório", () => {
  for (const status of [502, 503, 504]) {
    const r = resp(status);
    assert.equal(semSessao(r), false, `status ${status}`);
    assert.equal(transitorio(r), true, `status ${status}`);
  }
});

test("redirecionamento dentro de /tabela/ e respostas normais não são sessão", () => {
  assert.equal(semSessao(resp(200, "https://mnrs.com.br/tabela/", true)), false);
  assert.equal(semSessao(resp(200)), false);
  assert.equal(semSessao(resp(500)), false);
  assert.equal(transitorio(resp(200)), false);
  assert.equal(transitorio(resp(500)), false);
});
