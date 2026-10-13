#!/usr/bin/env node
/**
 * Test de mecánicas básicas contra el server levantado (tarda ~25 s):
 * inmunidad inicial, daño de balas a jugadores y cajas, recarga, dash, zona, muerte,
 * fantasma, victoria y bots en el modo clásico.
 *
 *   node loadtest/mechanics-test.mjs [--host H] [--port P]
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
const WS = `ws://${opt("host", "localhost")}:${Number(opt("port", 2567))}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg, extra = "") => {
  console.log(`${cond ? "  ✔" : "  ✘"} ${msg}${extra !== "" ? ` (${extra})` : ""}`);
  if (!cond) failures++;
};
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return false;
};

async function join(how, opts) {
  const room = how === "create" ? await new Client(WS).create("custom_room", opts) : how === "join" ? await new Client(WS).join("custom_room", opts) : await new Client(WS).joinOrCreate("jungle_room", opts);
  const messages = [];
  room.onMessage("*", (type, msg) => messages.push({ type, msg }));
  await sleep(200);
  return { room, messages, me: () => room.state.players.get(room.sessionId) };
}

function findItem(state, type) {
  let found = null;
  state.items.forEach((it) => {
    if (!found && it.active && it.itemType === type) found = it;
  });
  return found;
}

async function main() {
  console.log(`▶ Mecánicas contra ${WS}`);
  const code = String(1000 + Math.floor(Math.random() * 9000));
  const A = await join("create", { name: "Tirador", isCustom: true, isHost: true, roomCode: code });
  const B = await join("join", { name: "Blanco", isCustom: true, roomCode: code });
  A.room.send("startMatch");
  await until(() => A.room.state.status === "PLAYING");

  // Inmunidad inicial
  ok(A.me().invulnerableTimer === 15, "inmunidad inicial de 15 s en el HUD", A.me().invulnerableTimer);
  const zone0 = A.room.state.zone.timer;

  // Arma y disparo con inmunidad: no hay daño
  const gun = findItem(A.room.state, "LASER");
  A.room.send("debugTeleport", { x: gun.x, y: gun.y });
  ok(await until(() => A.me().equippedWeapon === "LASER"), "levanta la pistola al pasar por encima");
  const spot = { x: 2000, y: 4000 };
  A.room.send("debugTeleport", spot);
  B.room.send("debugTeleport", { x: spot.x + 120, y: spot.y });
  await sleep(200);
  A.room.send("shoot", { angle: 0 });
  ok(await until(() => A.messages.some((m) => m.type === "hit" && m.msg.isInvulnerable)), "con inmunidad el golpe no hace daño");
  ok(B.me().hp === 30, "el blanco sigue con 30 de vida", B.me().hp);

  // Dash y su cooldown (en décimas)
  A.room.send("dash", { dirX: 0, dirY: 1 });
  await sleep(100);
  const cd = A.me().dashCooldown;
  ok(cd > 2 && cd <= 2.5 && Math.round(cd * 10) === cd * 10, "dash: cooldown visible en décimas", cd);
  ok(await until(() => A.me().dashCooldown === 0, 3200), "el cooldown del dash llega a 0");

  // Recarga: vaciar el cargador
  A.room.send("debugTeleport", { x: spot.x, y: spot.y + 600 });
  await sleep(100);
  for (let i = 0; i < 12; i++) {
    A.room.send("shoot", { angle: Math.PI });
    await sleep(330);
    if (A.me().ammo === 0 || A.me().isReloading) break;
  }
  ok(await until(() => A.me().isReloading), "al vaciar el cargador recarga sola");
  ok(A.me().reloadTimer > 0, "tiempo de recarga visible", A.me().reloadTimer);
  ok(await until(() => !A.me().isReloading && A.me().ammo === 12, 2600), "termina la recarga con 12 balas", A.me().ammo);

  // Cajas: los disparos las rompen
  let crate = null;
  A.room.state.obstacles.forEach((o) => {
    if (!crate && o.obstacleType === "CRATE" && !o.destroyed && o.x > 1000 && o.x < 7000) crate = o;
  });
  A.room.send("debugTeleport", { x: crate.x - 150, y: crate.y });
  await sleep(150);
  const crateHp = crate.hp;
  for (let i = 0; i < 4; i++) {
    A.room.send("shoot", { angle: 0, angles: [0] });
    await sleep(340);
  }
  ok(crate.hp < crateHp, "las balas dañan las cajas", `${crateHp} → ${crate.hp}`);

  // Fin de la inmunidad y daño real
  ok(await until(() => A.me().invulnerableTimer === 0 && B.me().invulnerableTimer === 0, 16000), "la inmunidad termina a los 15 s");
  ok(A.room.state.zone.timer < zone0 && A.room.state.zone.timer > 0, "el temporizador de la zona baja", `${zone0} → ${A.room.state.zone.timer}`);
  A.room.send("debugTeleport", spot);
  B.room.send("debugTeleport", { x: spot.x + 120, y: spot.y });
  await sleep(200);
  A.room.send("shoot", { angle: 0, angles: [0] });
  ok(await until(() => B.me().hp === 10), "una bala de pistola saca 20 de vida", B.me().hp);

  // Muerte, fantasma y victoria
  await sleep(350);
  A.room.send("shoot", { angle: 0, angles: [0] });
  ok(await until(() => B.me().isGhost), "el blanco muere y queda como fantasma");
  ok(A.messages.some((m) => m.type === "kill"), "llega el aviso de eliminación");
  ok(await until(() => A.room.state.status === "VICTORY" && A.room.state.winnerId === A.room.sessionId), "victoria del último vivo");
  A.room.leave();
  B.room.leave();

  // Modo clásico: los bots se mueven y no atraviesan obstáculos
  const C = await join("classic", { name: "Solo" });
  const bots = [];
  C.room.state.players.forEach((p) => p.isBot && bots.push(p));
  ok(bots.length === 7, "el modo clásico tiene 7 bots", bots.length);
  const start = bots.map((b) => ({ x: b.x, y: b.y }));
  await sleep(2500);
  const moved = bots.filter((b, i) => Math.hypot(b.x - start[i].x, b.y - start[i].y) > 20).length;
  ok(moved >= 5, "los bots se mueven", `${moved}/7`);
  let inside = 0;
  C.room.state.obstacles.forEach((o) => {
    if (o.destroyed) return;
    bots.forEach((b) => {
      if (Math.hypot(b.x - o.x, b.y - o.y) < o.radius + 22 - 6) inside++;
    });
  });
  ok(inside === 0, "ningún bot quedó metido en un obstáculo", inside);

  console.log(failures ? `\n✘ ${failures} verificación(es) fallaron` : "\n✔ Todo OK");
  C.room.leave();
  await sleep(300);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
