import express from "express";
import { roomRates } from "./perf";

/**
 * Clientes SSE. El stream lleva solo la telemetría del HUD (estado del servidor cada
 * 1 s). El juego (estado y eventos) va únicamente por el WebSocket de Colyseus: antes
 * las posiciones y los eventos se mandaban también por acá y llegaban dos veces.
 */
export const sseClients = new Set<express.Response>();

function write(client: express.Response, payload: string) {
  try {
    client.write(payload);
  } catch {
    sseClients.delete(client);
  }
}

/** Evento para todos los clientes conectados (telemetría general). */
export function broadcastSSE(type: string, data: any) {
  if (sseClients.size === 0) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => write(client, payload));
}

export function setupSSERoutes(app: express.Express) {
  // SSE Event Stream Endpoint
  app.get("/api/events", (req, res) => {
    req.socket.setNoDelay(true); // Disable Nagle's algorithm for instant event streaming
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders?.();

    sseClients.add(res);

    // Immediate Welcome Packet (los ritmos medidos llegan con la primera telemetría)
    const initMsg = {
      type: "INIT",
      timestamp: Date.now(),
      message: "SSE telemetry stream active",
    };
    res.write(`event: init\ndata: ${JSON.stringify(initMsg)}\n\n`);

    req.on("close", () => {
      sseClients.delete(res);
    });
  });

  // Telemetría cada 1 s, con valores medidos: ciclos de simulación y envíos de estado
  // por segundo de cada sala (cada cliente muestra los de la suya)
  setInterval(() => {
    const rooms = roomRates();
    if (sseClients.size === 0) return;
    broadcastSSE("telemetry", {
      timestamp: Date.now(),
      rooms,
      clientsConnected: sseClients.size,
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  }, 1000);
}
