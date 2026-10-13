import express from "express";

/**
 * Clientes SSE. Cada conexión puede suscribirse a una sala (?roomId=...): los eventos
 * de una sala (tick, disparos, golpes...) solo van a sus suscriptores. Antes iban a
 * todos, y con varias salas cada navegador recibía y descartaba el tráfico de las demás.
 */
export const sseClients = new Set<express.Response>();
const roomSubscribers = new Map<string, Set<express.Response>>();

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

export function hasRoomSubscribers(roomId: string): boolean {
  return (roomSubscribers.get(roomId)?.size ?? 0) > 0;
}

/** Evento de una sala: solo para los clientes suscriptos a ella. */
export function broadcastRoomSSE(roomId: string, type: string, data: any) {
  const subs = roomSubscribers.get(roomId);
  if (!subs || subs.size === 0) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  subs.forEach((client) => write(client, payload));
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
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (roomId) {
      let subs = roomSubscribers.get(roomId);
      if (!subs) roomSubscribers.set(roomId, (subs = new Set()));
      subs.add(res);
    }

    // Immediate Welcome Packet
    const initMsg = {
      type: "INIT",
      serverTickRate: 60,
      timestamp: Date.now(),
      message: "SSE telemetry stream active",
    };
    res.write(`event: init\ndata: ${JSON.stringify(initMsg)}\n\n`);

    req.on("close", () => {
      sseClients.delete(res);
      if (roomId) {
        const subs = roomSubscribers.get(roomId);
        subs?.delete(res);
        if (subs && subs.size === 0) roomSubscribers.delete(roomId);
      }
    });
  });

  // Periodic SSE Telemetry heartbeat (every 1s)
  setInterval(() => {
    if (sseClients.size === 0) return;
    broadcastSSE("telemetry", {
      timestamp: Date.now(),
      tickRate: 60,
      clientsConnected: sseClients.size,
      fps: 60,
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  }, 1000);
}
