import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/tabela/",
  server: {
    port: 5173,
    proxy: {
      "/tabela/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/tabela/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
