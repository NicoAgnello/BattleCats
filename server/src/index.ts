import http from "http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "colyseus";
import { JungleRoom } from "./rooms/JungleRoom";
import { setupSSERoutes, sseClients } from "./sse";
import { perfSnapshot } from "./perf";

const PORT = Number(process.env.PORT || 2567);

const app = express();
app.use(cors());
app.use(express.json());

// Setup SSE routes & telemetry stream
setupSSERoutes(app);

const server = http.createServer(app);

const gameServer = new Server({
  server,
});

// Register JungleRoom (Standard match with bots)
gameServer.define("jungle_room", JungleRoom);

// Register CustomRoom (Custom match without bots, 20 players max, filtered by 4-digit roomCode)
gameServer.define("custom_room", JungleRoom).filterBy(["roomCode"]);

app.get("/health", (req, res) => {
  res.json({ status: "OK", room: "jungle_room", sseClients: sseClients.size });
});

// Métricas de rendimiento acumuladas desde la consulta anterior
app.get("/api/perf", (req, res) => {
  res.json(perfSnapshot());
});

// Endpoint para validar si una sala personalizada con código de 4 dígitos existe
app.get("/api/room/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const rooms = await matchMaker.query({ name: "custom_room" });
    const match = rooms.find((r: any) => r.metadata?.roomCode === code);
    if (match) {
      res.json({
        exists: true,
        roomId: match.roomId,
        clients: match.clients,
        maxClients: match.maxClients,
        status: match.metadata?.status || "WAITING",
      });
    } else {
      res.json({ exists: false });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`🎮 Colyseus + SSE Server listening on http://localhost:${PORT}`);
});


