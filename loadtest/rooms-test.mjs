#!/usr/bin/env node
/**
 * Test funcional de salas privadas (con el server levantado).
 *
 *   node loadtest/rooms-test.mjs                 # contra localhost
 *   node loadtest/rooms-test.mjs --host 192.168.1.15   # por la red local
 *
 * Recorre: crear sala, consultar el código, unirse, permisos del anfitrión, código
 * repetido, inicio de partida, unirse con la partida empezada, SSE por sala, cambio
 * de anfitrión, sala llena y código inexistente.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../client/package.json"));
const { Client } = require("colyseus.js");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const HOST = opt("host", "localhost");
const PORT = Number(opt("port", 2567));
const HTTP = `http://${HOST}:${PORT}`;
const WS = `ws://${HOST}:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg, extra = "") => {
  console.log(`${cond ? "  ✔" : "  ✘"} ${msg}${extra ? ` (${extra})` : ""}`);
  if (!cond) failures++;
};
const code = () => String(1000 + Math.floor(Math.random() * 9000));
const roomInfo = async (c) => (await fetch(`${HTTP}/api/room/${c}`)).json();

/** Crea/une un jugador; ignora los mensajes que no escuchamos. */
async function player(how, opts) {
  const client = new Client(WS);
  const room = how === "create" ? await client.create("custom_room", opts) : await client.join("custom_room", opts);
  const messages = [];
  room.onMessage("*", (type, msg) => messages.push({ type, msg }));
  await sleep(200);
  return { client, room, messages };
}

/** Abre el stream SSE de una sala y cuenta los eventos de juego que llegan. */
function sseCounter(roomId) {
  const abort = new AbortController();
  const counts = { tick: 0, foreign: 0 };
  (async () => {
    try {
      const res = await fetch(`${HTTP}/api/events${roomId ? `?roomId=${roomId}` : ""}`, { signal: abort.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = /event: (\w+)/.exec(block)?.[1];
          const data = /data: (.*)/.exec(block)?.[1];
          if (type === "tick") {
            counts.tick++;
            const rid = JSON.parse(data).roomId;
            if (roomId && rid !== roomId) counts.foreign++;
          }
        }
      }
    } catch {}
  })();
  return { counts, close: () => abort.abort() };
}

async function main() {
  console.log(`▶ Salas privadas contra ${HTTP}`);
  const opened = [];
  const track = (p) => (opened.push(p), p);

  // 1. Crear sala
  const c1 = code();
  const host = track(await player("create", { name: "Anfitrión", skin: 1, isCustom: true, isHost: true, roomCode: c1 }));
  ok(host.room.state.isCustomRoom && host.room.state.roomCode === c1, "el anfitrión crea la sala con su código", c1);
  ok(host.room.state.status === "WAITING", "la sala arranca en espera");
  ok(host.room.state.hostId === host.room.sessionId, "el creador es el anfitrión");
  ok(![...host.room.state.players.values()].some((p) => p.isBot), "la sala privada no tiene bots");

  // 2. Consultar el código
  let info = await roomInfo(c1);
  ok(info.exists && info.roomId === host.room.roomId, "GET /api/room/:code encuentra la sala");
  ok(info.maxClients === 20, "límite de 20 jugadores", `maxClients=${info.maxClients}`);

  // 3. Unirse con el código
  const guest = track(await player("join", { name: "Invitado", skin: 2, isCustom: true, roomCode: c1 }));
  await sleep(200);
  ok(guest.room.roomId === host.room.roomId, "el invitado entra a la misma sala");
  ok(host.room.state.players.size === 2 && guest.room.state.players.size === 2, "los dos ven 2 jugadores");
  ok(guest.room.state.hostId === host.room.sessionId, "el invitado ve al anfitrión correcto");

  // 4. Solo el anfitrión puede iniciar
  guest.room.send("startMatch");
  await sleep(250);
  ok(host.room.state.status === "WAITING", "un invitado no puede iniciar la partida");
  ok(guest.messages.some((m) => m.type === "error"), "el invitado recibe el aviso de error");

  // 5. Código repetido: no debe quedar una segunda sala con el mismo código
  let dupError = "";
  let dupCode = 0;
  let dup = null;
  try {
    dup = track(await player("create", { name: "Otro", isCustom: true, isHost: true, roomCode: c1 }));
  } catch (e) {
    dupError = e.message || String(e);
    dupCode = e.code;
  }
  ok(!dup || dup.room.state.roomCode !== c1, "no se pueden crear dos salas con el mismo código", dupError || (dup ? `roomCode=${dup.room.state.roomCode}` : ""));
  ok(dupCode === 4409, "el error trae el código 4409 (el cliente reintenta con otro código)", `code=${dupCode}`);
  if (dup) await dup.room.leave();

  // 6. SSE por sala: el stream de la sala solo trae sus eventos
  const other = track(await player("create", { name: "Ajeno", isCustom: true, isHost: true, roomCode: code() }));
  other.room.send("startMatch");
  const sseMine = sseCounter(host.room.roomId);
  await sleep(300);

  // 7. Iniciar partida
  host.room.send("startMatch");
  await sleep(400);
  ok(host.room.state.status === "PLAYING" && guest.room.state.status === "PLAYING", "el anfitrión inicia la partida");
  const [a, b] = [...host.room.state.players.values()];
  ok(Math.hypot(a.x - b.x, a.y - b.y) > 200, "los jugadores aparecen separados", `${Math.round(Math.hypot(a.x - b.x, a.y - b.y))} px`);
  ok(host.room.state.aliveCount === 2, "2 vivos al empezar");
  info = await roomInfo(c1);
  ok(info.status === "PLAYING", "la consulta del código informa la partida en curso", info.status);

  // 8. Unirse con la partida empezada
  let lateError = "";
  let late = null;
  try {
    late = track(await player("join", { name: "Tarde", isCustom: true, roomCode: c1 }));
  } catch (e) {
    lateError = e.message || String(e);
  }
  ok(!late, "no se puede entrar con la partida empezada", lateError || "entró");
  if (late) {
    await late.room.leave();
    await sleep(200);
  }

  await sleep(1200);
  ok(sseMine.counts.tick > 10, "el SSE de la sala recibe ticks", `${sseMine.counts.tick}`);
  ok(sseMine.counts.foreign === 0, "el SSE de la sala no recibe ticks de otra sala", `${sseMine.counts.foreign} ajenos`);
  sseMine.close();

  // 9. Cambio de anfitrión
  await host.room.leave();
  await sleep(300);
  ok(guest.room.state.hostId === guest.room.sessionId, "si se va el anfitrión, el invitado pasa a serlo");
  ok(guest.room.state.players.size === 1, "queda 1 jugador");

  // 10. Sala llena (20)
  const c2 = code();
  const full = [track(await player("create", { name: "L0", isCustom: true, isHost: true, roomCode: c2 }))];
  for (let i = 1; i < 20; i++) full.push(track(await player("join", { name: `L${i}`, isCustom: true, roomCode: c2 })));
  info = await roomInfo(c2);
  ok(info.clients === 20, "entran 20 jugadores", `clients=${info.clients}`);
  let fullError = "";
  try {
    track(await player("join", { name: "L20", isCustom: true, roomCode: c2 }));
  } catch (e) {
    fullError = e.message || String(e);
  }
  ok(!!fullError, "el jugador 21 es rechazado", fullError);

  // 11. Código inexistente
  info = await roomInfo("0000");
  ok(!info.exists, "un código inexistente no se encuentra");
  let missingError = "";
  try {
    track(await player("join", { name: "X", isCustom: true, roomCode: "0000" }));
  } catch (e) {
    missingError = e.message || String(e);
  }
  ok(!!missingError, "unirse a un código inexistente falla", missingError);

  // (el resumen va antes de cerrar: si Node se queda sin tareas pendientes mientras
  // espera los leave(), termina solo con código 0 y se perdería el resultado)
  console.log(failures ? `\n✘ ${failures} verificación(es) fallaron` : "\n✔ Todo OK");
  opened.forEach((p) => p.room.leave().catch(() => {}));
  await sleep(300);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
