import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { JungleRoom } from "./rooms/JungleRoom";
import { setupSSERoutes, sseClients } from "./sse";

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

// Register JungleRoom
gameServer.define("jungle_room", JungleRoom);

app.get("/health", (req, res) => {
  res.json({ status: "OK", room: "jungle_room", sseClients: sseClients.size });
});

server.listen(PORT, () => {
  console.log(`🎮 Colyseus + SSE Server listening on http://localhost:${PORT}`);
});


