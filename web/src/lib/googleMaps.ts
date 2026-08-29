// ═══════════════════════════════════════════════════════════════
// Carregador do Google Maps JS.
//
// A chave vem do servidor (/encaminhamento/config) em vez de entrar no build:
// o Dockerfile do web não recebe build-arg, e LAB e LIVE usam a mesma imagem —
// mudar a chave é mexer no .env do compose, não rebuildar.
//
// Singleton porque o script do Google só pode ser injetado uma vez por página;
// mapa e autocomplete chamam isto sem coordenar entre si.
// ═══════════════════════════════════════════════════════════════

let promessa: Promise<void> | null = null;

/** Injeta o script do Google Maps e resolve quando `google.maps` existe. */
export function garantirGoogleMaps(key: string): Promise<void> {
  if (promessa) return promessa;
  promessa = new Promise((resolve, reject) => {
    const cb = "__tabelaGoogleMapsPronto";
    (window as unknown as Record<string, unknown>)[cb] = () => resolve();
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      language: "pt-BR",
      region: "BR",
      callback: cb,
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      // Permite tentar de novo (rede oscilou) em vez de travar no rejeitado.
      promessa = null;
      reject(new Error("Google Maps não carregou"));
    };
    document.head.append(s);
  });
  return promessa;
}
