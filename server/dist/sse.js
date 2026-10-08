"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sseClients = void 0;
exports.broadcastSSE = broadcastSSE;
exports.setupSSERoutes = setupSSERoutes;
// SSE Clients Registry
exports.sseClients = new Set();
function broadcastSSE(type, data) {
    if (exports.sseClients.size === 0)
        return;
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    exports.sseClients.forEach((client) => {
        try {
            client.write(payload);
        }
        catch {
            exports.sseClients.delete(client);
        }
    });
}
function setupSSERoutes(app) {
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
        exports.sseClients.add(res);
        // Immediate Welcome Packet
        const initMsg = {
            type: "INIT",
            serverTickRate: 60,
            timestamp: Date.now(),
            message: "SSE telemetry stream active",
        };
        res.write(`event: init\ndata: ${JSON.stringify(initMsg)}\n\n`);
        req.on("close", () => {
            exports.sseClients.delete(res);
        });
    });
    // Periodic SSE Telemetry heartbeat (every 1s)
    setInterval(() => {
        if (exports.sseClients.size === 0)
            return;
        broadcastSSE("telemetry", {
            timestamp: Date.now(),
            tickRate: 60,
            clientsConnected: exports.sseClients.size,
            fps: 60,
            memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
    }, 1000);
}
