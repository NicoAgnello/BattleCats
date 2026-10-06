"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const colyseus_1 = require("colyseus");
const JungleRoom_1 = require("./rooms/JungleRoom");
const PORT = Number(process.env.PORT || 2567);
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const server = http_1.default.createServer(app);
const gameServer = new colyseus_1.Server({
    server,
});
// Register JungleRoom
gameServer.define("jungle_room", JungleRoom_1.JungleRoom);
app.get("/health", (req, res) => {
    res.json({ status: "OK", room: "jungle_room" });
});
server.listen(PORT, () => {
    console.log(`🎮 Colyseus Multiplayer Server listening on http://localhost:${PORT}`);
});
