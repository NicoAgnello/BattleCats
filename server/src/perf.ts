import { monitorEventLoopDelay } from "perf_hooks";

/**
 * Métricas de rendimiento del servidor (por sala y del proceso).
 * Se consultan en GET /api/perf y alimentan la telemetría SSE. El costo de medir es
 * despreciable (dos performance.now() por tick).
 */

interface Sample {
  count: number;
  total: number;
  max: number;
}

const newSample = (): Sample => ({ count: 0, total: 0, max: 0 });

export interface RoomPerf {
  roomId: string;
  roomCode: string;
  clients: number;
  players: number;
  projectiles: number;
  sim: Sample;
  patch: Sample;
  /** Totales desde que se creó la sala (no se reinician): de acá sale la telemetría. */
  ticks: number;
  patches: number;
}

const rooms = new Map<string, RoomPerf>();
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

let windowStart = Date.now();
let cpuStart = process.cpuUsage();

export function perfRoom(roomId: string): RoomPerf {
  let r = rooms.get(roomId);
  if (!r) {
    r = { roomId, roomCode: "", clients: 0, players: 0, projectiles: 0, sim: newSample(), patch: newSample(), ticks: 0, patches: 0 };
    rooms.set(roomId, r);
  }
  return r;
}

export function perfDispose(roomId: string) {
  rooms.delete(roomId);
  lastRates.delete(roomId);
}

/** Último conteo usado para calcular los ritmos de la telemetría, por sala. */
const lastRates = new Map<string, { ticks: number; patches: number; at: number }>();

/**
 * Ciclos de simulación y envíos de estado por segundo de cada sala, medidos desde la
 * llamada anterior (la telemetría SSE la hace una vez por segundo). Independiente de
 * perfSnapshot: consultar /api/perf no altera estos números.
 */
export function roomRates(): Record<string, { tickRate: number; patchRate: number }> {
  const now = performance.now();
  const out: Record<string, { tickRate: number; patchRate: number }> = {};
  rooms.forEach((r) => {
    const prev = lastRates.get(r.roomId);
    lastRates.set(r.roomId, { ticks: r.ticks, patches: r.patches, at: now });
    if (!prev) return; // primera vez: todavía no hay un intervalo para medir
    const secs = Math.max(0.001, (now - prev.at) / 1000);
    out[r.roomId] = {
      tickRate: Math.round((r.ticks - prev.ticks) / secs),
      patchRate: Math.round((r.patches - prev.patches) / secs),
    };
  });
  return out;
}

export function record(s: Sample, ms: number) {
  s.count++;
  s.total += ms;
  if (ms > s.max) s.max = ms;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Devuelve las métricas acumuladas desde la última llamada y reinicia la ventana. */
export function perfSnapshot() {
  const now = Date.now();
  const elapsedMs = Math.max(1, now - windowStart);
  const cpu = process.cpuUsage(cpuStart);
  const snapshot = {
    windowMs: elapsedMs,
    cpuPercent: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
    heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    eventLoopLagMs: {
      mean: round(loopDelay.mean / 1e6),
      p99: round(loopDelay.percentile(99) / 1e6),
      max: round(loopDelay.max / 1e6),
    },
    rooms: Array.from(rooms.values()).map((r) => ({
      roomId: r.roomId,
      roomCode: r.roomCode,
      clients: r.clients,
      players: r.players,
      projectiles: r.projectiles,
      ticksPerSec: round((r.sim.count / elapsedMs) * 1000),
      simMs: { avg: round(r.sim.total / (r.sim.count || 1)), max: round(r.sim.max) },
      patchesPerSec: round((r.patch.count / elapsedMs) * 1000),
      patchMs: { avg: round(r.patch.total / (r.patch.count || 1)), max: round(r.patch.max) },
    })),
  };
  windowStart = now;
  cpuStart = process.cpuUsage();
  loopDelay.reset();
  rooms.forEach((r) => {
    r.sim = newSample();
    r.patch = newSample();
  });
  return snapshot;
}
