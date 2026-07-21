import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/tabela/",
  server: {
    port: 5173,
    proxy: {
      // docker-compose.dev.yml expõe a API em 3001
      "/tabela/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/tabela/ws": {
        target: "ws://localhost:3001",
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
