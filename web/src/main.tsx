import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/globals.css";

// Depois de um deploy, a aba aberta ainda pede os chunks do build anterior
// (404, "Failed to fetch dynamically imported module") e o modal da viatura
// não abre. Recarrega uma vez para pegar o build novo; se já recarregou há
// menos de 30 s, deixa o erro seguir (nada de laço).
window.addEventListener("vite:preloadError", (e) => {
  try {
    const ultima = Number(sessionStorage.getItem("tabela:recarga-deploy") ?? 0);
    if (Date.now() - ultima < 30_000) return;
    sessionStorage.setItem("tabela:recarga-deploy", String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
