// Como ler uma resposta que passou pelo portão (nginx-host.conf + porteiro).
// Sem dependência do navegador, para o teste rodar no node.

type Resp = Pick<Response, "status" | "redirected" | "url">;

// Sessão vencida, pelo critério que o nginx realmente usa quando o porteiro
// responde 401:
// - API e WebSocket: 401 '{"erro":"login"}' (@tabela_sem_sessao);
// - tela: 302 para https://mnrs.com.br/?proximo=tabela (@tabela_entrar) — o
//   fetch segue o 302 e termina fora de /tabela/, na página de login.
// Página HTML sozinha NÃO é sessão: em deploy o nginx devolve 503 com
// /index.html (S2OUT-61) — ver `transitorio`.
export function semSessao(res: Resp): boolean {
  if (res.status === 401) return true;
  if (!res.redirected) return false;
  try {
    return !new URL(res.url).pathname.startsWith("/tabela/");
  } catch {
    return false;
  }
}

// App fora do ar por instantes (deploy, restart do container): o nginx troca
// 502/503/504 por 503 com a página /index.html. Passa sozinho.
export function transitorio(res: Pick<Response, "status">): boolean {
  return res.status === 502 || res.status === 503 || res.status === 504;
}
