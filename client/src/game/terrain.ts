import Phaser from "phaser";
import { RIVER_PATH, BRIDGES } from "./river";
import { kitFrame } from "./catSprites";
import { STRUCTURES } from "./structures";
import {
  WORLD, P, N, SHORE, makeNoise, islandEdge, quantizeEdge, dequantizeEdge, setFields,
  wavePhase, waveFront, SWASH,
} from "./coast";

/* ─── Suelo pixel art del mapa (sin baldosas ni divisiones) ─────────────────
 * Se genera una sola vez al cargar: una imagen de 2667x2667 pixels donde cada
 * pixel son 3 px del mundo (la misma escala que los gatos). Pasto con tonos
 * tramados, claros, bosques, flores, playa, caminos y río curvo con orillas.
 * El agua se anima aparte (ondas que se desplazan, recortadas a río y océano).
 */

// Tramado ordenado 4x4 (Bayer): mezcla dos tonos sin bordes duros
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

const hex = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const GRASS = [0x355a24, 0x3f6a2b, 0x497a32, 0x53893a, 0x5c9641, 0x67a348, 0x74b052].map(hex);
const SAND = [0xb8a070, 0xc9b27a, 0xd8c690, 0xe4d6a6].map(hex);
const DIRT = [0x6b4a2f, 0x7a5634, 0x8a6240, 0x9a7048, 0xa98054].map(hex);
const MUD = [0x4e3a26, 0x5e4630, 0x6e5238].map(hex);
const WATER_RIVER = [0x245096, 0x2a5ca8, 0x2f63b8, 0x3a72c4].map(hex);
const WATER_SEA = [0x173f6e, 0x1c497d, 0x22548e, 0x2767ae, 0x2f72bd].map(hex);
const COBBLE = [0x7a7a70, 0x8a8a80, 0x9a9a90, 0xa8a89c].map(hex);
const FLOWERS = [0xf2f0e6, 0xf0cf5a, 0xe05a9a, 0xb07ae0, 0xf08a5a].map(hex);

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const CLEARINGS = [
  [2000, 2000, 440, 360], [6000, 2000, 440, 360], [2000, 6000, 440, 360], [6000, 6000, 460, 380],
  [4000, 3400, 560, 460], [4000, 1400, 320, 260], [4000, 6600, 320, 260], [1400, 4000, 320, 260],
  [6600, 4000, 320, 260], [4000, 4000, 400, 300],
];
const DENSE = [
  [1200, 2800, 400, 320], [6800, 2800, 400, 320], [1200, 5200, 400, 320], [6800, 5200, 400, 320],
  [2800, 4000, 380, 300], [5200, 4000, 380, 300], [3000, 2200, 360, 280], [5000, 5800, 360, 280],
];

/* Senderos: salen de los puentes (que no están sobre el camino principal) y de cada
 * puerta. Serpentean, cambian de ancho, tienen tramos casi borrados y adoquines al
 * principio. [x, y, dirX, dirY, largo, medio ancho, largo de adoquines, semilla] */
type Trail = [number, number, number, number, number, number, number, number];
const TRAILS: Trail[] = [
  ...BRIDGES.filter(([, , y0, y1]) => Math.abs((y0 + y1) / 2 - 4000) > 200).flatMap(([x0, x1, y0, y1], i): Trail[] => [
    [x0 + 6, (y0 + y1) / 2, -1, 0, 380, 30, 75, i * 2 + 1],
    [x1 - 6, (y0 + y1) / 2, 1, 0, 380, 30, 75, i * 2 + 2],
  ]),
  // puente del camino principal: solo el tramo de adoquines a cada lado
  ...BRIDGES.filter(([, , y0, y1]) => Math.abs((y0 + y1) / 2 - 4000) <= 200).flatMap(([x0, x1, y0, y1]): Trail[] => [
    [x0 + 6, (y0 + y1) / 2, -1, 0, 85, 34, 85, 9],
    [x1 - 6, (y0 + y1) / 2, 1, 0, 85, 34, 85, 10],
  ]),
  ...STRUCTURES.flatMap((def, k) => def.doorways.map((d, i): Trail => {
    const vertical = d.height > d.width;
    const dx = vertical ? Math.sign(d.x - def.x) : 0, dy = vertical ? 0 : Math.sign(d.y - def.y);
    return [d.x + dx * 72, d.y + dy * 72, dx, dy, 300, 26, 55, 20 + k * 5 + i];   // desde el final de la entrada
  })),
];

/** Borde gastado de un camino. e = distancia al centro / medio ancho; blob = ruido suave
 *  (manchones). Cuerpo de tierra con borde ondulado por manchones (sin damero) y, por
 *  fuera, terrones sueltos de 1-3 px donde se gastó el pasto: más cerca del borde, más
 *  terrones (algunos quedan pegados al camino). */
function wornDirt(e: number, px: number, py: number, blob: number): boolean {
  if (e < 0.84 + (blob - 0.5) * 0.55) return true;
  if (e > 1.75) return false;
  const prob = 0.42 * (1 - (e - 0.8) / 0.95);
  const big = hash((px >> 1) + 7919, py >> 1) < prob;           // terrón de 2x2 (con un pixel mordido)
  if (big && hash(px, py) > 0.22) return true;
  return hash(px + 31, py + 17) < prob * 0.35;                    // pixel suelto
}

/** 0 = nada, 1 = tierra, 2 = adoquín, 3 = junta entre adoquines. */
function trailAt(wx: number, wy: number, px: number, py: number, blob: number): number {
  for (const [sx, sy, dx, dy, len, w, cob, seed] of TRAILS) {
    const along = (wx - sx) * dx + (wy - sy) * dy;
    if (along < -6 || along > len * 1.1) continue;
    const f = Math.max(0, along) / len;
    // serpenteo: el centro se va corriendo de a poco (dos ondas de distinta frecuencia)
    const mean = (Math.sin(along / 95 + seed * 1.7) * 18 + Math.sin(along / 37 + seed * 3.1) * 6) * Math.min(1, along / 60);
    const across = (wx - sx) * dy - (wy - sy) * dx - mean;
    // ancho que respira y se angosta poco; el final se cierra en una punta irregular
    const end = f > 0.88 ? Math.max(0, 1 - (f - 0.88) / (0.2 + (blob - 0.5) * 0.15)) : 1;
    const hw = (w * (0.85 + 0.2 * Math.sin(along / 53 + seed)) * (1 - f * 0.25) + 4) * Math.sqrt(end);   // final redondeado
    const e = Math.abs(across) / hw;
    if (e > 1.75) continue;
    if (along < cob && e < 1) {                              // adoquines al principio, que se van salteando
      const u = Math.floor((along + 6) / P), v = Math.floor((across + 60) / P);
      const row = Math.floor(v / 3), off = (row & 1) * 2;
      if (hash(Math.floor((u + off) / 4) + seed * 101, row) > along / cob * 0.9 + 0.08) {
        return v % 3 === 0 || (u + off) % 4 === 0 ? 3 : 2;
      }
    }
    if (end <= 0 ? hash(px + 3, py) < 0.05 : wornDirt(e, px, py, blob)) return 1;
  }
  return 0;
}

/** Para cada fila de pixels: x del centro del río y cos del ángulo (distancia ≈ |dx|·cos). */
function riverRows() {
  const cx = new Float32Array(N), cs = new Float32Array(N);
  let j = 0;
  for (let py = 0; py < N; py++) {
    const wy = py * P + 1.5;
    while (j < RIVER_PATH.length - 2 && RIVER_PATH[j + 1].y < wy) j++;
    const a = RIVER_PATH[j], b = RIVER_PATH[j + 1];
    const t = Math.max(0, Math.min(1, (wy - a.y) / ((b.y - a.y) || 1)));
    cx[py] = a.x + (b.x - a.x) * t;
    cs[py] = Math.cos(Math.atan2(b.x - a.x, b.y - a.y));
  }
  return { cx, cs };
}

/* Decoraciones de playa (pixel a pixel, sobre la arena seca y mojada): conchas,
 * caracoles, estrellas de mar y algún cangrejito. Pocas: alguna que otra. */
const BEACH_COLORS: Record<string, number> = {
  a: 0xf4ead6, b: 0xe6b8a2, c: 0xb47a62,             // concha abanico
  d: 0x8a6a52, e: 0xd8c0a0, f: 0xf2e6d0,             // caracol
  s: 0xe07a4a, S: 0xf6a878, t: 0xb85a34,             // estrella de mar
  r: 0xb8402a, R: 0xdc643c, w: 0x1e1e24, l: 0x8a2e1e, // cangrejo
};
const BEACH_DECOR: { rows: string[]; weight: number }[] = [
  { rows: [".aaa.", "abbba", ".bcb.", "..c.."], weight: 30 },
  { rows: [".bb", "bab", "cb."], weight: 18 },
  { rows: [".dd.", "deed", "dfe.", ".d.."], weight: 22 },
  { rows: ["..s..", "ssSss", ".sts.", ".s.s.", "s...s"], weight: 16 },
  { rows: ["l.....l", ".rRRRr.", "lRwRwRl", ".rRRRr.", "l.l.l.l"], weight: 10 },
];

function decorateBeach(d: Uint8ClampedArray) {
  const sand = new Set(SAND.map(c => (c[0] << 16) | (c[1] << 8) | c[2]));
  const at = (x: number, y: number) => { const o = (y * N + x) * 4; return (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; };
  const put = (x: number, y: number, c: number) => {
    const o = (y * N + x) * 4; d[o] = (c >> 16) & 255; d[o + 1] = (c >> 8) & 255; d[o + 2] = c & 255;
  };
  const total = BEACH_DECOR.reduce((a, b) => a + b.weight, 0);
  const CELL = 34;
  for (let cy = 0; cy < N / CELL; cy++) for (let cx = 0; cx < N / CELL; cx++) {
    if (hash(cx + 911, cy + 377) > 0.15) continue;
    let pick = hash(cy + 5, cx + 13) * total, dec = BEACH_DECOR[0];
    for (const it of BEACH_DECOR) { if ((pick -= it.weight) < 0) { dec = it; break; } }
    const x0 = cx * CELL + Math.floor(hash(cx, cy + 1) * (CELL - 8)), y0 = cy * CELL + Math.floor(hash(cx + 1, cy) * (CELL - 8));
    const h = dec.rows.length, w = dec.rows[0].length;
    if (x0 + w + 2 >= N || y0 + h + 2 >= N) continue;
    // todo el lugar (con margen) tiene que ser arena
    let ok = true;
    for (let y = -1; y <= h + 1 && ok; y++) for (let x = -1; x <= w + 1 && ok; x++) ok = sand.has(at(x0 + x, y0 + y));
    if (!ok) continue;
    const flip = hash(cx + 3, cy + 9) < 0.5;
    const shadow = (SAND[0][0] << 16) | (SAND[0][1] << 8) | SAND[0][2];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (dec.rows[y][flip ? w - 1 - x : x] !== ".") put(x0 + x + 1, y0 + y + 1, shadow);   // sombrita
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = dec.rows[y][flip ? w - 1 - x : x];
      if (ch !== ".") put(x0 + x, y0 + y, BEACH_COLORS[ch]);
    }
  }
}

/** Genera la textura "ground" del mapa entero. */
export function generateGround(scene: Phaser.Scene): string {
  const key = "ground";
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, N, N);
  if (!tex) return key;
  const ctx = tex.getContext();
  const img = ctx.createImageData(N, N);
  const d = img.data;

  const nBig = makeNoise(60, 11), nMid = makeNoise(220, 23), nFine = makeNoise(700, 37);
  const nRiver = makeNoise(400, 61), nFlower = makeNoise(120, 71);
  const { cx: rcx, cs: rcs } = riverRows();
  const edgeQ = new Uint8Array(N * N).fill(255), phaseQ = new Uint8Array(N * N);
  const ellipse = (wx: number, wy: number, e: number[]) => {
    const ex = (wx - e[0]) / e[2], ey = (wy - e[1]) / e[3];
    return ex * ex + ey * ey;
  };

  for (let py = 0; py < N; py++) {
    const wy = py * P + 1.5;
    const by = (py & 3) * 4;
    for (let px = 0; px < N; px++) {
      const wx = px * P + 1.5;
      const bay = BAYER[by + (px & 3)];
      const o = (py * N + px) * 4;
      let c: number[];

      // Costa: distancia al borde del mapa con ondulación orgánica
      const edge = islandEdge(wx, wy);                         // isla de esquinas redondeadas (coast.ts)
      const fi0 = py * N + px;
      if (edge < 640) {
        edgeQ[fi0] = quantizeEdge(edge);
        phaseQ[fi0] = Math.floor(wavePhase(wx, wy) * 255);
      }
      // Río curvo con borde irregular; en la playa se ensancha y desemboca en el mar
      const rd = Math.abs(wx - rcx[py]) * rcs[py];
      const wob = (nRiver(px, py) - 0.5) * 18;
      const mouth = Math.max(0, 600 - edge) * 0.1;
      if (edge >= 300 && edge < 560 && rd < 58 + wob + mouth) {
        const fi = 3 - rd / (22 + mouth * 0.4) + (nFine(px, py) - 0.5) - Math.max(0, 420 - edge) / 60;
        c = WATER_RIVER[Math.max(0, Math.min(3, Math.floor(fi + bay - 0.5)))];
        if (rd > 54 + wob + mouth) c = WATER_RIVER[3];
      } else if (edge >= 312 && edge < 560 && rd < 72 + wob + mouth * 1.2) {
        c = SAND[0];                                             // arena mojada en la desembocadura
        if (hash(px, py) > 0.99) c = hex(0x9a9a90);
      } else if (edge < 330) {
        const t = edge / 330;                                    // 0 = mar profundo .. 1 = orilla
        const fi = t * 4.2 + (nMid(px, py) - 0.5) * 1.2;
        c = WATER_SEA[Math.max(0, Math.min(4, Math.floor(fi + bay - 0.5)))];
        if (edge > SHORE - 18) c = WATER_SEA[4];                // agua bajita (la espuma es animada)
      } else if (edge < 560) {
        const t = (edge - 330) / 230;                            // arena mojada -> seca -> pasto
        if (t > 0.82 && bay < (t - 0.82) * 5.5) c = GRASS[3];
        else {
          const si = (t < 0.18 ? 0 : 1 + t * 2) + (nFine(px, py) - 0.5) * 1.4;
          c = SAND[Math.max(0, Math.min(3, Math.floor(si + bay - 0.5)))];
          if (hash(px, py) > 0.996) c = hex(0xf2f0e6);           // caracolitos
        }
      } else {
        // Río + orillas de barro
        if (rd < 58 + wob) {
          const fi = 3 - rd / 22 + (nFine(px, py) - 0.5);
          c = WATER_RIVER[Math.max(0, Math.min(3, Math.floor(fi + bay - 0.5)))];
          if (rd > 54 + wob) c = WATER_RIVER[3];
        } else if (rd < 84 + wob * 1.3) {
          const mi = (rd - 58 - wob) / 9 + (nFine(px, py) - 0.5) * 1.5;
          c = MUD[Math.max(0, Math.min(2, Math.floor(mi + bay - 0.5)))];
          if (hash(px, py) > 0.985) c = hex(0x9a9a90);           // piedritas
        } else {
          // Caminos de tierra: eje E-O + senderos desde puentes y puertas (ver trailAt)
          const roadWob = (nMid(px, py) - 0.5) * 14;
          // camino principal: serpentea un poco, cambia de ancho y tiene el borde tramado
          const roadY = 4000 + Math.sin(wx / 310) * 22 + Math.sin(wx / 97 + 1.3) * 7;
          const roadHw = 30 + Math.sin(wx / 140) * 6 + Math.sin(wx / 41) * 3;
          const re = Math.abs(wy - roadY + roadWob) / roadHw;
          const blob = nMid(px, py);
          const endFade = Math.min(1, Math.min(wx - 600, 7400 - wx) / 250);
          const inMain = endFade > 0 && wornDirt(re / Math.max(0.2, endFade), px, py, blob);
          const trail = trailAt(wx, wy, px, py, blob);
          const tr = trail >= 2 ? trail : inMain ? 1 : trail;
          const inRoad = tr === 1;
          if (tr >= 2) {
            c = tr === 3 ? DIRT[1] : COBBLE[Math.floor(hash(px >> 1, py >> 1) * COBBLE.length)];
          } else if (inRoad) {
            const rut = Math.abs(wy - roadY + roadWob);
            const di = 2.6 + (nFine(px, py) - 0.5) * 2 - (Math.abs(rut - 14) < 3 && wx > 600 ? 1.2 : 0);
            c = DIRT[Math.max(0, Math.min(4, Math.floor(di + bay - 0.5)))];
            if (hash(px, py) > 0.992) c = hex(0x9a9a90);
          } else {
            // Pasto: tono por ruido + claros (más luz) + bosques (más oscuro)
            let clear = 0, dense = 0;
            for (const e of CLEARINGS) { const v = ellipse(wx, wy, e); if (v < 1.25) clear = Math.max(clear, Math.min(1, (1.25 - v) * 2)); }
            for (const e of DENSE) { const v = ellipse(wx, wy, e); if (v < 1.25) dense = Math.max(dense, Math.min(1, (1.25 - v) * 2)); }
            const gi = 3 + (nBig(px, py) - 0.5) * 2.2 + (nMid(px, py) - 0.5) * 1.4 + clear * 1.4 - dense * 1.8;
            c = GRASS[Math.max(0, Math.min(6, Math.floor(gi + bay - 0.5)))];
            const h = hash(px, py);
            const meadow = nFlower(px, py);
            if (meadow > 0.72 && h > 0.965 - clear * 0.02) c = FLOWERS[Math.floor(hash(py, px) * FLOWERS.length)];
            else if (h > 0.975) c = GRASS[Math.max(0, Math.floor(gi) - 2)];      // matitas oscuras
            else if (h < 0.004) c = hex(0x8a8a80);                               // piedrita
            else if (nFine(px, py) > 0.86 && nBig(px, py) < 0.4) c = DIRT[2 + (bay > 0.5 ? 1 : 0)];  // parche de tierra
          }
        }
      }
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  decorateBeach(d);
  setFields(edgeQ, phaseQ);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

/** Agua animada: dos capas de ondas pixel en el río (bajan hacia el sur) y dos en el
 *  mar (titilan en el lugar; el movimiento hacia la costa lo dan las crestas de
 *  buildSeaFx). Cada grupo recortado con su propia máscara. */
export function buildWater(scene: Phaser.Scene): (time: number) => void {
  const fa = kitFrame(scene, "water", "a"), fb = kitFrame(scene, "water", "b");
  if (!fa || !fb) return () => {};
  // mar: anillo entre la orilla de la isla (un poco antes de la arena) y afuera del mapa
  const seaMask = scene.make.graphics({}, false);
  seaMask.fillStyle(0xffffff);
  const C = WORLD / 2, RAYS = 720;
  const shore: { x: number; y: number }[] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let r = 2600;
    while (r < 6000 && islandEdge(C + dx * r, C + dy * r) > SHORE - 40) r += 6;
    shore.push({ x: C + dx * r, y: C + dy * r });
  }
  for (let i = 0; i < RAYS; i++) {
    const p0 = shore[i], p1 = shore[(i + 1) % RAYS];
    const a0 = (i / RAYS) * Math.PI * 2, a1 = ((i + 1) / RAYS) * Math.PI * 2;
    const o0 = { x: C + Math.cos(a0) * 6000, y: C + Math.sin(a0) * 6000 }, o1 = { x: C + Math.cos(a1) * 6000, y: C + Math.sin(a1) * 6000 };
    seaMask.fillTriangle(p0.x, p0.y, o0.x, o0.y, o1.x, o1.y);
    seaMask.fillTriangle(p0.x, p0.y, o1.x, o1.y, p1.x, p1.y);
  }
  // río: polígono a lo largo de la curva (un poco más angosto que el agua dibujada)
  const riverMask = scene.make.graphics({}, false);
  riverMask.fillStyle(0xffffff);
  const left: Phaser.Types.Math.Vector2Like[] = [], right: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < RIVER_PATH.length; i++) {
    const a = RIVER_PATH[Math.max(0, i - 1)], b = RIVER_PATH[Math.min(RIVER_PATH.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    left.push({ x: RIVER_PATH[i].x + nx * 48, y: RIVER_PATH[i].y + ny * 48 });
    right.push({ x: RIVER_PATH[i].x - nx * 48, y: RIVER_PATH[i].y - ny * 48 });
  }
  riverMask.fillPoints([...left, ...right.reverse()], true);

  const layer = (f: { key: string; frame: string }, alpha: number, m: Phaser.Display.Masks.GeometryMask) =>
    scene.add.tileSprite(0, 0, N, N, f.key, f.frame).setOrigin(0).setScale(P).setDepth(0.5).setAlpha(alpha).setMask(m);
  const rm = riverMask.createGeometryMask(), sm = seaMask.createGeometryMask();
  const ra = layer(fa, 0.9, rm), rb = layer(fb, 0.8, rm);
  const sa = layer(fa, 0.8, sm), sb = layer(fb, 0.7, sm);
  // en pasos de 1 pixel (pixel art nítido)
  return (time: number) => {
    ra.tilePositionY = -Math.floor(time / 110);
    ra.tilePositionX = Math.floor(Math.sin(time / 1700) * 2);
    rb.tilePositionY = -Math.floor(time / 70);
    rb.tilePositionX = Math.floor(time / 400);
    sa.tilePositionX = Math.floor(Math.sin(time / 2300) * 3);
    sa.tilePositionY = Math.floor(Math.cos(time / 2900) * 2);
    sb.tilePositionX = Math.floor(Math.cos(time / 1900) * 2);
    sb.tilePositionY = Math.floor(Math.sin(time / 2500) * 3);
  };
}

/** Olas de la costa, dibujadas cada frame solo en lo que ve la cámara (un lienzo del
 *  tamaño de la vista, en pixels del arte):
 *  - crestas: líneas claras paralelas a la orilla que avanzan hacia la playa;
 *  - resaca: el agua sube por la arena con espuma al frente y vuelve a bajar,
 *    dejando la arena mojada. Cada tramo de costa va desfasado (no todas a la vez).
 *  Todo sale de los campos precalculados de coast.ts: nada de sprites por tramo. */
export function buildSeaFx(scene: Phaser.Scene, edgeQ: Uint8Array, phaseQ: Uint8Array): (time: number) => void {
  const KEY = "sea_fx";
  let cw = 0, ch = 0;
  let tex: Phaser.Textures.CanvasTexture | null = null;
  let img: ImageData | null = null;
  const view = scene.add.image(0, 0, "__DEFAULT").setOrigin(0).setScale(P).setDepth(0.6);
  const LAMBDA = 96, SPEED = 0.034;                       // separación de crestas y velocidad (px/ms)
  return (time: number) => {
    const cam = scene.cameras.main, wv = cam.worldView;
    const x0 = Math.max(0, Math.floor(wv.x / P) - 1), y0 = Math.max(0, Math.floor(wv.y / P) - 1);
    const x1 = Math.min(N, Math.ceil(wv.right / P) + 1), y1 = Math.min(N, Math.ceil(wv.bottom / P) + 1);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    if (w > cw || h > ch || !tex || !img) {                  // lienzo del tamaño de la vista (crece si hace falta)
      cw = Math.max(cw, w + 16); ch = Math.max(ch, h + 16);
      if (scene.textures.exists(KEY)) scene.textures.remove(KEY);
      tex = scene.textures.createCanvas(KEY, cw, ch);
      if (!tex) return;
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
      img = tex.getContext().createImageData(cw, ch);
      view.setTexture(KEY);
    }
    const d = img.data;
    d.fill(0);
    let any = false;
    for (let y = 0; y < h; y++) {
      const row = (y0 + y) * N;
      for (let x = 0; x < w; x++) {
        const q = edgeQ[row + x0 + x];
        if (q === 255) continue;
        const e = dequantizeEdge(q);
        if (e > SHORE + SWASH + 30) continue;
        const o = (y * cw + x) * 4;
        const ph = phaseQ[row + x0 + x] / 255;
        const front = waveFront(time, ph);
        if (e < SHORE - 24) {
          // mar: crestas que avanzan hacia la orilla (cortadas al azar para que no sean rayas)
          const k = ((e - time * SPEED + ph * LAMBDA) % LAMBDA + LAMBDA) % LAMBDA;
          // (solo donde la orilla tiene pendiente: en zonas planas la cresta se haría mancha)
          const i0 = row + x0 + x;
          const slope = Math.abs(edgeQ[Math.min(i0 + 2, edgeQ.length - 1)] - edgeQ[Math.max(i0 - 2, 0)])
            + Math.abs(edgeQ[Math.min(i0 + 2 * N, edgeQ.length - 1)] - edgeQ[Math.max(i0 - 2 * N, 0)]);
          if (k < 3.2 && e > 40 && slope >= 3) {
            const gap = ((((x0 + x) >> 2) * 73856093) ^ (Math.floor((e - time * SPEED) / LAMBDA) * 19349663)) & 7;
            if (gap < 6) {
              const near = Math.min(1, e / SHORE);
              d[o] = 190; d[o + 1] = 226; d[o + 2] = 246; d[o + 3] = 70 + near * 110; any = true;
            }
          }
          continue;
        }
        if (e < front - 6) {                                 // agua que sube por la arena
          const t = Math.min(1, (front - e) / 50);           // más clara y transparente cerca del frente
          d[o] = 120 - t * 50; d[o + 1] = 190 - t * 50; d[o + 2] = 240 - t * 20; d[o + 3] = 120 + t * 100; any = true;
        } else if (e < front) {                              // espuma al frente de la ola
          d[o] = 236; d[o + 1] = 246; d[o + 2] = 255; d[o + 3] = 235; any = true;
        } else if (e < SHORE + SWASH + 4) {                  // arena mojada por donde ya pasó
          d[o] = 70; d[o + 1] = 50; d[o + 2] = 30; d[o + 3] = 40; any = true;
        }
      }
    }
    view.setVisible(any);
    if (!any) return;
    tex.getContext().putImageData(img, 0, 0);
    tex.refresh();
    view.setPosition(x0 * P, y0 * P);
  };
}

/** Puentes armados por piezas: extremo + tramos + extremo espejado, del largo justo
 *  para ir de orilla a orilla (el rectángulo lógico de BRIDGES). Van sobre el agua animada. */
export function placeBridges(scene: Phaser.Scene): boolean {
  const end = kitFrame(scene, "bridge_end", "extremo"), mid = kitFrame(scene, "bridge_mid", "tramo");
  if (!end || !mid) return false;
  const endW = scene.textures.getFrame(end.key, end.frame).width;
  BRIDGES.forEach(([x0, x1, y0, y1]) => {
    const cy = (y0 + y1) / 2, len = Math.round((x1 - x0) / P);
    const midW = Math.max(0, len - 2 * endW);
    if (midW > 0) scene.add.tileSprite(x0 + endW * P, cy, midW, 44, mid.key, mid.frame).setOrigin(0, 0.5).setScale(P).setDepth(1);
    scene.add.image(x0, cy, end.key, end.frame).setOrigin(0, 0.5).setScale(P).setDepth(1);
    scene.add.image(x1, cy, end.key, end.frame).setOrigin(1, 0.5).setScale(P).setFlipX(true).setDepth(1);
  });
  return true;
}
