import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/tabela/",
  server: {
    port: 5173,
    // LAB no servidor: aceitar o hostname do túnel Cloudflare
    allowedHosts: ["lab-tabela.mnrs.com.br"],
    proxy: {
      // docker-compose.dev.yml expõe a API em 3001; no LAB do servidor o alvo
      // vem por env (TABELA_API_PROXY_TARGET=http://tabela-api:3000)
      "/tabela/api": {
        target: process.env.TABELA_API_PROXY_TARGET || "http://localhost:3001",
        changeOrigin: true,
      },
      "/tabela/ws": {
        target: (process.env.TABELA_API_PROXY_TARGET || "http://localhost:3001").replace(/^http/, "ws"),
        ws: true,
      },
      // Aba UPAs consome a API pública do giro-de-leitos em produção
      "/tabela/upas/api": {
        target: "https://mnrs.com.br",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
