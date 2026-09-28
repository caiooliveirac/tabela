import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer;

/* O portão (nginx auth_request → porteiro → plantoes) só confere o login no
   handshake. Para uma conta que saiu do plantão, teve a senha trocada ou foi
   suspensa não seguir recebendo casos por um WebSocket antigo, cada conexão é
   fechada a cada 5 min com o código 4000: o client reconecta na hora e o
   portão confere de novo. */
export const WS_VIDA_MAXIMA_MS = 5 * 60_000;
export const WS_RECONFERIR = 4000;

export type WsEvent =
  | { type: "case:created"; payload: unknown }
  | { type: "case:updated"; payload: unknown }
  | { type: "case:removed"; payload: unknown }
  | { type: "intel:created"; payload: unknown }
  | { type: "intel:removed"; payload: unknown }
  | { type: "chefia:created"; payload: unknown }
  | { type: "chefia:updated"; payload: unknown }
  | { type: "chefia:removed"; payload: unknown }
  | { type: "upa-restriction:changed"; payload: unknown }
  | { type: "refresh" };

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/tabela/ws" });

  wss.on("connection", (ws) => {
    console.log(`🔌 WS client connected (total: ${wss.clients.size})`);
    const reconferir = setTimeout(() => ws.close(WS_RECONFERIR, "reconferir"), WS_VIDA_MAXIMA_MS);

    ws.on("close", () => {
      clearTimeout(reconferir);
      console.log(`🔌 WS client disconnected (total: ${wss.clients.size})`);
    });

    ws.on("error", (err) => {
      console.error("WS error:", err.message);
    });

    // Confirm connection
    ws.send(JSON.stringify({ type: "connected", clients: wss.clients.size }));
  });

  console.log("🔌 WebSocket server ready on /tabela/ws");
  return wss;
}

/** Broadcast event to all connected clients */
export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const data = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}
