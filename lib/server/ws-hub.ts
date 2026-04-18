import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { BrowserEvent } from "@/types/realtime";

const globalForWsHub = globalThis as typeof globalThis & {
  __imessageWsClients?: Set<WebSocket>;
};

const clients =
  globalForWsHub.__imessageWsClients ??
  (globalForWsHub.__imessageWsClients = new Set<WebSocket>());

export function broadcast(event: BrowserEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function attachWebSocketHub(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const host = request.headers.host ?? "localhost";
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    const cleanup = () => clients.delete(ws);
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return wss;
}
