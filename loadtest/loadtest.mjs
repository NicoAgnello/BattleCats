#!/usr/bin/env node
/**
 * Test de carga: conecta N jugadores simulados a una sala y mide el costo en el
 * servidor (GET /api/perf) y lo que recibe cada cliente (WebSocket + SSE).
 *
 * Uso (con el server levantado):
 *   node loadtest/loadtest.mjs --clients 20 --mode custom --duration 30
 *   node loadtest/loadtest.mjs --clients 12 --mode classic --rooms 2
 *
 * Opciones:
 *   --clients N    jugadores por sala (default 16)
 *   --rooms R      salas en paralelo (default 1)
 *   --mode M       custom (sala privada, sin bots) | classic (con bots)
 *   --duration S   segundos de medición (default 30)
 *   --host H       host del server (default localhost)
 *   --port P       puerto del server (default 2567)
 *   --spread       repartir los jugadores por el mapa (default: todos peleando en el centro)
 *   --no-sse       no abrir el stream SSE por jugador
 *
 * Los jugadores se llaman TEST_*: el server no les aplica daño, así la partida no termina.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../client/package.json"));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const CLIENTS = Number(opt("clients", 16));
const ROOMS = Number(opt("rooms", 1));
const MODE = opt("mode", "custom");
const DURATION = Number(opt("duration", 30));
const HOST = opt("host", "localhost");
const SPREAD = flag("spread");
const USE_SSE = !flag("no-sse");
const PORT = Number(opt("port", 2567));

// ── Contador de bytes por WebSocket (antes de cargar colyseus.js) ──
const NativeWS = globalThis.WebSocket;
class CountingWS extends NativeWS {
  constructor(url, protocols) {
    super(url, protocols);
    this.stats = { bytes: 0, patches: 0, messages: 0, lastPatch: 0, maxGap: 0 };
    this.addEventListener("message", (ev) => {
      const data = ev.data;
      const len = data.byteLength ?? data.length ?? data.size ?? 0;
      this.stats.bytes += len;
      const code = data instanceof ArrayBuffer ? new Uint8Array(data)[0] : -1;
      if (code === 15) {
        const now = performance.now();
        if (this.stats.lastPatch) this.stats.maxGap = Math.max(this.stats.maxGap, now - this.stats.lastPatch);
        this.stats.lastPatch = now;
        this.stats.patches++;
      } else if (code === 13) {
        this.stats.messages++;
      }
    });
  }
}
globalThis.WebSocket = CountingWS;
const { Client } = require("colyseus.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEAPONS = ["LASER", "SHOTGUN", "SNIPER"];

class Bot {
  constructor(index, roomIdx) {
    this.index = index;
    this.name = `TEST_${roomIdx}_${index}`;
    this.client = new Client(`ws://${HOST}:${PORT}`);
    this.room = null;
    this.sse = { bytes: 0, events: 0, abort: new AbortController() };
    this.dir = Math.random() * Math.PI * 2;
    this.lastDirChange = 0;
    this.lastShoot = 0;
    this.home = SPREAD
      ? { x: 1200 + Math.random() * 5600, y: 1200 + Math.random() * 5600 }
      : { x: 4000 + (Math.random() - 0.5) * 300, y: 4000 + (Math.random() - 0.5) * 300 };
  }

  get ws() {
    return this.room?.connection?.transport?.ws;
  }

  async connect(roomOpts, how) {
    const options = { name: this.name, skin: this.index % 5, ...roomOpts };
    if (how === "create") this.room = await this.client.create(roomOpts.isCustom ? "custom_room" : "jungle_room", options);
    else if (how === "joinById") this.room = await this.client.joinById(roomOpts.roomId, options);
    else if (how === "join") this.room = await this.client.join("custom_room", options);
    else this.room = await this.client.joinOrCreate("jungle_room", options);
    this.room.onMessage("*", () => {});
    this.room.onError((code, msg) => console.error(`[${this.name}] error ${code} ${msg}`));
    if (USE_SSE) this.openSSE();
    return this.room;
  }

  async openSSE() {
    try {
      const url = `http://${HOST}:${PORT}/api/events?roomId=${this.room.roomId}`;
      const res = await fetch(url, { signal: this.sse.abort.signal });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.sse.bytes += value.byteLength;
        // eventos = líneas "event:" en el chunk
        for (let i = 0; i < value.length - 5; i++) {
          if (value[i] === 101 && value[i + 1] === 118 && value[i + 2] === 101 && value[i + 3] === 110 && value[i + 4] === 116 && value[i + 5] === 58) this.sse.events++;
        }
      }
    } catch {}
  }

  me() {
    return this.room?.state?.players?.get(this.room.sessionId);
  }

  /** Se teletransporta sobre un arma del suelo (auto-pickup) y vuelve a su zona. */
  async grabWeapon() {
    const items = [];
    this.room.state.items.forEach((it) => {
      if (it.active && WEAPONS.includes(it.itemType)) items.push(it);
    });
    items.sort((a, b) => a.x - b.x || a.y - b.y);
    if (!items.length) return;
    const it = items[this.index % items.length];
    this.room.send("debugTeleport", { x: it.x, y: it.y });
    await sleep(250);
    this.room.send("debugTeleport", this.home);
    this.pos = { ...this.home };
  }

  step(now, dt) {
    const me = this.me();
    if (!me) return;
    if (!this.pos) this.pos = { x: me.x, y: me.y };
    if (now - this.lastDirChange > 900) {
      // tiende a volver a su zona para que el grupo no se disperse
      const back = Math.atan2(this.home.y - this.pos.y, this.home.x - this.pos.x);
      this.dir = Math.hypot(this.home.y - this.pos.y, this.home.x - this.pos.x) > 350 ? back : Math.random() * Math.PI * 2;
      this.lastDirChange = now;
    }
    const dx = Math.cos(this.dir), dy = Math.sin(this.dir);
    // seguir al server si nos corrigió (choque con obstáculos)
    if (Math.hypot(me.x - this.pos.x, me.y - this.pos.y) > 60) this.pos = { x: me.x, y: me.y };
    this.pos.x += dx * 220 * dt;
    this.pos.y += dy * 220 * dt;
    const rot = Math.sin(now / 400 + this.index) * Math.PI;
    this.room.send("move", { dx, dy, rotation: rot, x: this.pos.x, y: this.pos.y });
    if (now - this.lastShoot > 320) {
      this.room.send("shoot", { angle: rot });
      this.lastShoot = now;
    }
  }

  async leave() {
    this.sse.abort.abort();
    try { await this.room?.leave(); } catch {}
  }
}

async function getPerf() {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/perf`);
    return await r.json();
  } catch {
    return null;
  }
}

async function setupRoom(roomIdx) {
  const bots = Array.from({ length: CLIENTS }, (_, i) => new Bot(i, roomIdx));
  if (MODE === "custom") {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    await bots[0].connect({ isCustom: true, isHost: true, roomCode: code }, "create");
    const roomId = bots[0].room.roomId;
    await Promise.all(bots.slice(1).map((b) => b.connect({ isCustom: true, isHost: false, roomCode: code, roomId }, "join")));
    await sleep(300);
    bots[0].room.send("startMatch");
  } else {
    await bots[0].connect({}, "joinOrCreate");
    const roomId = bots[0].room.roomId;
    await Promise.all(bots.slice(1).map((b) => b.connect({ roomId }, "joinById")));
  }
  await sleep(500);
  return bots;
}

async function main() {
  console.log(`▶ ${ROOMS} sala(s) ${MODE} × ${CLIENTS} jugadores, ${DURATION}s, ${SPREAD ? "repartidos" : "agrupados en el centro"}, SSE ${USE_SSE ? "sí" : "no"}`);
  const rooms = [];
  for (let r = 0; r < ROOMS; r++) rooms.push(await setupRoom(r));
  const bots = rooms.flat();
  console.log(`  conectados: ${bots.filter((b) => b.room).length}/${bots.length}`);

  // de a uno por sala: si dos van a la misma arma, solo la levanta el primero
  for (let round = 0; round < 3; round++) {
    await Promise.all(bots.filter((b) => b.me()?.equippedWeapon === "MELEE").map((b) => b.grabWeapon()));
    await sleep(400);
  }
  console.log(`  armados: ${bots.filter((b) => b.me() && b.me().equippedWeapon !== "MELEE").length}/${bots.length}`);

  // reiniciar contadores y métricas antes de medir
  bots.forEach((b) => {
    const s = b.ws?.stats;
    if (s) Object.assign(s, { bytes: 0, patches: 0, messages: 0, maxGap: 0, lastPatch: 0 });
    b.sse.bytes = 0;
    b.sse.events = 0;
  });
  await getPerf();

  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    bots.forEach((b) => b.step(now, dt));
  }, 16);

  const perfSamples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < DURATION * 1000) {
    await sleep(5000);
    // los que se quedaron sin balas vuelven a buscar arma (si no, la carga de
    // proyectiles cae a mitad de la medición)
    bots.filter((b) => { const m = b.me(); return m && m.ammo === 0 && m.reserveAmmo === 0; }).forEach((b) => b.grabWeapon());
    const p = await getPerf();
    if (p) {
      perfSamples.push(p);
      const rs = p.rooms.filter((r) => r.clients > 0);
      const sim = rs.map((r) => `sim ${r.simMs.avg}/${r.simMs.max}ms patch ${r.patchMs.avg}/${r.patchMs.max}ms proj ${r.projectiles}`).join(" | ");
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] cpu ${p.cpuPercent}% lag p99 ${p.eventLoopLagMs.p99}ms heap ${p.heapMb}MB · ${sim}`);
    }
  }
  clearInterval(timer);
  const secs = (Date.now() - t0) / 1000;

  const withWs = bots.filter((b) => b.ws?.stats);
  const avg = (f) => withWs.reduce((a, b) => a + f(b), 0) / (withWs.length || 1);
  const meanOf = (f) => perfSamples.reduce((a, p) => a + f(p), 0) / (perfSamples.length || 1);
  const roomsOf = (p) => p.rooms.filter((r) => r.clients > 0);
  const summary = {
    mode: MODE,
    rooms: ROOMS,
    clientsPerRoom: CLIENTS,
    server: {
      cpuPercent: +meanOf((p) => p.cpuPercent).toFixed(1),
      eventLoopLagP99Ms: +meanOf((p) => p.eventLoopLagMs.p99).toFixed(2),
      simMsAvg: +meanOf((p) => roomsOf(p).reduce((a, r) => a + r.simMs.avg, 0) / (roomsOf(p).length || 1)).toFixed(3),
      patchMsAvg: +meanOf((p) => roomsOf(p).reduce((a, r) => a + r.patchMs.avg, 0) / (roomsOf(p).length || 1)).toFixed(3),
      patchMsMax: Math.max(0, ...perfSamples.flatMap((p) => roomsOf(p).map((r) => r.patchMs.max))),
      ticksPerSec: +meanOf((p) => roomsOf(p).reduce((a, r) => a + r.ticksPerSec, 0) / (roomsOf(p).length || 1)).toFixed(1),
    },
    perClient: {
      wsKBps: +(avg((b) => b.ws.stats.bytes) / secs / 1024).toFixed(1),
      patchesPerSec: +(avg((b) => b.ws.stats.patches) / secs).toFixed(1),
      messagesPerSec: +(avg((b) => b.ws.stats.messages) / secs).toFixed(1),
      maxPatchGapMs: Math.round(Math.max(...withWs.map((b) => b.ws.stats.maxGap))),
      sseKBps: +(bots.reduce((a, b) => a + b.sse.bytes, 0) / bots.length / secs / 1024).toFixed(1),
      sseEventsPerSec: +(bots.reduce((a, b) => a + b.sse.events, 0) / bots.length / secs).toFixed(1),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  bots.forEach((b) => b.leave());
  await sleep(300);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
