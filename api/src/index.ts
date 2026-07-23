import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { setupWebSocket } from "./ws/handler.js";
import casesRouter from "./routes/cases.js";
import intelRouter from "./routes/intel.js";
import hospitalsRouter from "./routes/hospitals.js";
import chefiaRouter from "./routes/chefia.js";
import reportsRouter from "./routes/reports.js";
import { initChefiaSecurity } from "./lib/chefiaPin.js";
import { startChefiaBot } from "./bot/chefiaBot.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://tabela:tabela@localhost:5432/tabela";

// Database
const sql = postgres(DATABASE_URL);
export const db = drizzle(sql);

// Express
const app = express();
// Atrás do nginx: confia no X-Forwarded-For para que req.ip seja o IP real
// (necessário para o rate limit do PIN funcionar por cliente).
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());

// Health check
app.get("/tabela/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/tabela/api/cases", casesRouter);
app.use("/tabela/api/intel", intelRouter);
app.use("/tabela/api/hospitals", hospitalsRouter);
app.use("/tabela/api/chefia", chefiaRouter);
app.use("/tabela/api/reports", reportsRouter);

// HTTP + WebSocket server
const server = createServer(app);
setupWebSocket(server);

// Segurança do PIN: cria tabelas, semeia PINs e sobe o bot de comandos.
initChefiaSecurity()
  .then(() => startChefiaBot())
  .catch((e) => console.error("initChefiaSecurity:", e));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API running on http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket on ws://0.0.0.0:${PORT}/tabela/ws`);
});
