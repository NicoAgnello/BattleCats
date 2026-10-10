import Phaser from "phaser";
import { kitFrame } from "./catSprites";
import type { StructureDef } from "./structures";

/* ─── Estructuras en pixel art armadas con el kit (/sprites/src/estructuras.py) ─
 * Piso (depth 3, interior) con la entrada marcada en cada puerta, muros con huecos
 * en las puertas (depth 31) y techo
 * (en el roofContainer existente, que se aclara al entrar). Las colisiones son
 * las de siempre (obstáculos WALL del servidor, ahora invisibles).
 * Todo a escala 3 (1 px del sprite = 3 px del mundo).
 */

const P = 3;            // pixel del sprite en el mundo
const WALL = 36;        // espesor del muro (radio de colisión 18 x 2)
const EAVE = 15;        // alero: el techo sobresale del muro

type Prop = [name: string, fx: number, fy: number];   // posición relativa a la mitad del ancho/alto
type RoofShape = "hip" | "gable" | "flat";   // cuatro aguas, dos aguas, plano
interface Style {
  floor: string; wall: string; roof: string; shape: RoofShape;
  entrance: string;          // pieza de kit-entrada frente a cada puerta
  props: Prop[];             // accesorios de 16x16 (kit-accesorio)
  bigProps?: Prop[];         // accesorios de 32x32 (kit-accesorio-grande)
  moss?: boolean;            // manchas de musgo en el techo
  berm?: boolean;            // terraplén de tierra y pasto alrededor (búnker semienterrado)
}

const STYLES: Record<StructureDef["type"], Style> = {
  MANSION:   { floor: "marmol", wall: "ladrillo", roof: "tejas_rojas", shape: "hip", entrance: "escalinata",
               props: [["chimenea", -0.55, -0.45], ["chimenea", 0.6, 0.5], ["claraboya", -0.1, -0.5], ["claraboya", 0.1, 0.5]] },
  CABIN:     { floor: "madera_clara", wall: "troncos", roof: "tejas_marrones", shape: "gable", entrance: "porche",
               props: [["chimenea", 0.45, -0.5]] },
  // fuerte de la selva: techo de paja a dos aguas y torre de vigía en una esquina
  OUTPOST:   { floor: "madera_oscura", wall: "troncos", roof: "paja", shape: "gable", entrance: "troncos",
               props: [["chimenea", 0.5, 0.45]], bigProps: [["torre", -1.04, -1.04], ["torre", 1.04, 1.04]] },
  // búnker: losa de hormigón con parapeto, cúpula de observación, escotilla, ventilaciones y musgo
  BUNKER:    { floor: "metal", wall: "hormigon", roof: "hormigon", shape: "flat", entrance: "rampa", moss: true, berm: true,
               props: [["escotilla", 0.55, 0.35], ["ventilacion", -0.65, -0.55], ["ventilacion", -0.65, 0.5], ["antena", 0.7, -0.6]],
               bigProps: [["cupula", -0.05, -0.1]] },
  WAREHOUSE: { floor: "hormigon", wall: "chapa", roof: "chapa", shape: "gable", entrance: "rampa",
               props: [["claraboya", -0.5, 0], ["claraboya", 0, 0], ["claraboya", 0.5, 0], ["ventilacion", -0.75, -0.65], ["ventilacion", 0.75, 0.65]] },
  LAB:       { floor: "laboratorio", wall: "blanco", roof: "paneles", shape: "flat", entrance: "lab",
               props: [["panel_solar", -0.55, -0.45], ["panel_solar", -0.25, -0.45], ["panel_solar", 0.05, -0.45],
                       ["aire", 0.55, 0.45], ["antena", 0.6, -0.45], ["ventilacion", -0.55, 0.5]] },
};

const snap = (v: number) => Math.round(v / P) * P;

function tiled(scene: Phaser.Scene, kind: string, tag: string, x: number, y: number, w: number, h: number) {
  const f = kitFrame(scene, kind, tag);
  if (!f || w <= 0 || h <= 0) return null;
  return scene.add.tileSprite(snap(x), snap(y), Math.max(1, Math.round(w / P)), Math.max(1, Math.round(h / P)), f.key, f.frame)
    .setScale(P);
}

function stamp(scene: Phaser.Scene, kind: string, tag: string, x: number, y: number, rot = 0) {
  const f = kitFrame(scene, kind, tag);
  return f ? scene.add.image(snap(x), snap(y), f.key, f.frame).setScale(P).setRotation(rot) : null;
}

/** Terraplén de tierra apisonada y grava alrededor del búnker (es suelo: se camina
 *  por encima, no bloquea). Borde irregular y tramado que se funde con el pasto; se
 *  abre frente a las puertas. Rompe la silueta cuadrada del búnker. */
function berm(scene: Phaser.Scene, rw: number, rh: number, doors: number[][]) {
  const g = scene.add.graphics();
  const D = 16;                                    // ancho máximo del terraplén en pixels del sprite
  const cols = [0x4e3c28, 0x5e4a32, 0x6e5838, 0x7a6440, 0x86704a];   // tierra oscura junto al muro -> clara
  const pw = Math.round(rw / P), ph = Math.round(rh / P);
  const n = (i: number, j: number) => {
    let h = (i * 374761393 + j * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const wave = (t: number) => 0.62 + 0.25 * Math.sin(t * 0.21) + 0.13 * Math.sin(t * 0.53 + 1.7);
  for (let j = -D; j < ph + D; j++) {
    for (let i = -D; i < pw + D; i++) {
      const dx = i < 0 ? -i : i >= pw ? i - pw + 1 : 0, dy = j < 0 ? -j : j >= ph ? j - ph + 1 : 0;
      if (!dx && !dy) continue;
      const d = Math.hypot(dx, dy);
      const reach = D * wave(dx ? j : i + 37);      // borde ondulado
      if (d > reach) continue;
      const wx = i * P - rw / 2, wy = j * P - rh / 2;
      if (doors.some(([x, y]) => Math.abs(wx - x) < (dy ? 60 : 160) && Math.abs(wy - y) < (dy ? 160 : 60))) continue;   // abierto en las puertas
      const t = d / reach + (n(i, j) - 0.5) * 0.35;  // 0 = junto al muro (tierra) .. 1 = borde (pasto)
      if (t > 0.9 && n(j, i) < 0.5) continue;        // borde tramado
      const r = n(i * 3, j * 7);
      const col = r > 0.94 ? 0x9a9a90 : r < 0.05 && t > 0.6 ? 0x4f6e2e : cols[Math.max(0, Math.min(4, Math.floor(t * 5)))];
      g.fillStyle(col, 1);                            // grava y alguna matita de pasto
      g.fillRect(snap(wx), snap(wy), P, P);
    }
  }
  return g;
}

/** Arma la estructura. Devuelve false si el kit no cargó (se usa el dibujo vectorial). */
export function buildStructureArt(
  scene: Phaser.Scene, def: StructureDef,
  interior: Phaser.GameObjects.Container, roof: Phaser.GameObjects.Container,
): boolean {
  if (!kitFrame(scene, "floor", "marmol")) return false;
  const st = STYLES[def.type];
  const hw = def.width / 2, hh = def.height / 2;
  const add = (c: Phaser.GameObjects.Container, o: Phaser.GameObjects.GameObject | null) => { if (o) c.add(o); };

  // ── Piso + sombra del edificio en el suelo + entrada (escalones, porche, rampa...) en cada puerta
  const sh = scene.add.graphics();
  sh.fillStyle(0x000000, 0.28);
  sh.fillRect(snap(-hw - WALL / 2 + 12), snap(-hh - WALL / 2 + 12), snap(def.width + WALL), snap(def.height + WALL));
  interior.add(sh);
  add(interior, tiled(scene, "floor", st.floor, 0, 0, def.width, def.height));
  def.doorways.forEach(d => {
    const rx = d.x - def.x, ry = d.y - def.y;
    const vertical = d.height > d.width;                       // puerta en muro este/oeste
    const OUT = WALL / 2 + EAVE + 21;                          // la pieza (48 de largo) queda entera fuera del alero
    // la pieza mira hacia abajo (sur); se gira según el lado de la puerta
    const [ox, oy, rot] = vertical
      ? (rx > 0 ? [OUT, 0, -Math.PI / 2] : [-OUT, 0, Math.PI / 2])
      : (ry > 0 ? [0, OUT, 0] : [0, -OUT, Math.PI]);
    add(interior, stamp(scene, "entrance", st.entrance, rx + ox, ry + oy, rot));
    // umbral: el piso de la casa sigue hasta la entrada (sin franja de tierra en el medio)
    const len = OUT - 24 + P, across = (vertical ? d.height : d.width) + 16;
    const sx = vertical ? Math.sign(rx) : 0, sy = vertical ? 0 : Math.sign(ry);
    add(interior, tiled(scene, "floor", st.floor, rx + sx * len / 2, ry + sy * len / 2,
      vertical ? len : across, vertical ? across : len));
  });

  // ── Muros con huecos en las puertas (mismo criterio que el servidor: puerta ± 8)
  const walls = scene.add.container(def.x, def.y).setDepth(31);
  const gaps = (horizontal: boolean, line: number) => def.doorways
    .filter(d => horizontal ? Math.abs(d.y - def.y - line) < WALL : Math.abs(d.x - def.x - line) < WALL)
    .map(d => horizontal ? [d.x - def.x - d.width / 2 - 8, d.x - def.x + d.width / 2 + 8]
                         : [d.y - def.y - d.height / 2 - 8, d.y - def.y + d.height / 2 + 8])
    .sort((a, b) => a[0] - b[0]);
  const runSegments = (from: number, to: number, cuts: number[][]) => {
    const segs: [number, number][] = [];
    let cur = from;
    for (const [a, b] of cuts) { if (a > cur) segs.push([cur, a]); cur = Math.max(cur, b); }
    if (to > cur) segs.push([cur, to]);
    return segs;
  };
  const posts: [number, number][] = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]];
  for (const y of [-hh, hh]) {
    const cuts = gaps(true, y);
    runSegments(-hw, hw, cuts).forEach(([a, b]) => add(walls, tiled(scene, "wall_h", st.wall, (a + b) / 2, y, b - a, WALL)));
    cuts.forEach(([a, b]) => { posts.push([a, y], [b, y]); });
  }
  for (const x of [-hw, hw]) {
    const cuts = gaps(false, x);
    runSegments(-hh, hh, cuts).forEach(([a, b]) => add(walls, tiled(scene, "wall_v", st.wall, x, (a + b) / 2, WALL, b - a)));
    cuts.forEach(([a, b]) => { posts.push([x, a], [x, b]); });
  }
  posts.forEach(([x, y]) => add(walls, stamp(scene, "corner", st.wall, x, y)));

  // ── Techo: relleno con alero que sobresale + faldones con luz/sombra + bordes
  const rw = def.width + WALL + EAVE * 2, rh = def.height + WALL + EAVE * 2;
  if (st.berm) interior.addAt(berm(scene, rw, rh, def.doorways.map(d => [d.x - def.x, d.y - def.y])), 0);
  add(roof, tiled(scene, "roof", st.roof, 0, 0, rw, rh));
  const x0 = snap(-rw / 2), y0 = snap(-rh / 2), W = snap(rw), H = snap(rh);
  const shade = scene.add.graphics();
  const row = (y: number, xa: number, xb: number, color: number, alpha: number) => {
    if (xb > xa) { shade.fillStyle(color, alpha); shade.fillRect(snap(xa), y, snap(xb - xa), P); }
  };
  if (st.shape === "hip") {
    // cuatro aguas: faldón superior (luz), inferior (sombra), izquierdo (luz suave),
    // derecho (sombra suave); líneas de limatesa en diagonal y cumbrera al medio
    const half = H / 2;
    for (let y = y0; y < y0 + H; y += P) {
      const d = y < 0 ? y - y0 : y0 + H - P - y;                 // distancia al borde más cercano (arriba/abajo)
      const inset = Math.min(d, half);
      row(y, x0, x0 + inset, 0xffffff, 0.06);                    // faldón izquierdo
      row(y, x0 + W - inset, x0 + W, 0x000000, 0.16);            // faldón derecho
      row(y, x0 + inset, x0 + W - inset, y < 0 ? 0xffffff : 0x000000, y < 0 ? 0.12 : 0.26);
      if (inset < half - P) {                                    // limatesas (diagonales)
        row(y, x0 + inset, x0 + inset + P, 0x000000, 0.3);
        row(y, x0 + W - inset - P, x0 + W - inset, 0x000000, 0.3);
      }
    }
    shade.fillStyle(0x000000, 0.35); shade.fillRect(snap(x0 + half), -P, snap(W - 2 * half), P * 2);
    shade.fillStyle(0xffffff, 0.25); shade.fillRect(snap(x0 + half), -P * 2, snap(W - 2 * half), P);
  } else if (st.shape === "gable") {
    // dos aguas a lo largo del lado mayor: un faldón con luz, el otro en sombra
    const alongX = W >= H;
    if (alongX) {
      shade.fillStyle(0xffffff, 0.1); shade.fillRect(x0, y0, W, snap(H / 2));
      shade.fillStyle(0x000000, 0.24); shade.fillRect(x0, 0, W, snap(H / 2));
      shade.fillStyle(0x000000, 0.35); shade.fillRect(x0, -P, W, P * 2);
      shade.fillStyle(0xffffff, 0.25); shade.fillRect(x0, -P * 2, W, P);
    } else {
      shade.fillStyle(0xffffff, 0.1); shade.fillRect(x0, y0, snap(W / 2), H);
      shade.fillStyle(0x000000, 0.24); shade.fillRect(0, y0, snap(W / 2), H);
      shade.fillStyle(0x000000, 0.35); shade.fillRect(-P, y0, P * 2, H);
    }
  } else {
    // plano: parapeto (borde levantado) alrededor
    shade.fillStyle(0xffffff, 0.16); shade.fillRect(x0, y0, W, P * 2); shade.fillRect(x0, y0, P * 2, H);
    shade.fillStyle(0x000000, 0.25); shade.fillRect(x0, y0 + H - P * 2, W, P * 2); shade.fillRect(x0 + W - P * 2, y0, P * 2, H);
  }
  // manchas de desgaste (cortan la repetición de la baldosa)
  let seed = def.x * 7 + def.y * 13;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < Math.round((W * H) / 26000); i++) {
    const bw = snap(18 + rnd() * 60), bh = snap(9 + rnd() * 24);
    shade.fillStyle(rnd() < 0.5 ? 0x000000 : 0xffffff, 0.05 + rnd() * 0.05);
    shade.fillRect(snap(x0 + rnd() * (W - bw)), snap(y0 + rnd() * (H - bh)), bw, bh);
  }
  roof.add(shade);
  const edge = scene.add.graphics();
  edge.fillStyle(0x14101c, 1);                                   // contorno del techo
  edge.fillRect(x0 - P, y0 - P, W + 2 * P, P); edge.fillRect(x0 - P, y0 + H, W + 2 * P, P);
  edge.fillRect(x0 - P, y0, P, H); edge.fillRect(x0 + W, y0, P, H);
  roof.add(edge);
  if (st.moss) {                                                 // musgo: manchas verdes tramadas
    const moss = scene.add.graphics();
    for (let i = 0; i < 7; i++) {
      const mx = x0 + 12 + rnd() * (W - 60), my = y0 + 12 + rnd() * (H - 48), mr = 4 + Math.floor(rnd() * 6);
      for (let j = -mr; j <= mr; j++) for (let k = -mr; k <= mr; k++) {
        const d = Math.hypot(j, k * 1.3) / mr;
        if (d > 1 || ((j + k) & 1 && d > 0.6) || rnd() < 0.15) continue;
        moss.fillStyle(d < 0.5 && rnd() < 0.5 ? 0x6e8a3a : 0x4f6e2e, 0.85);
        moss.fillRect(snap(mx + j * P), snap(my + k * P), P, P);
      }
    }
    roof.add(moss);
  }
  (st.bigProps ?? []).forEach(([name, fx, fy]) => add(roof, stamp(scene, "big_prop", name, fx * hw, fy * hh)));
  st.props.forEach(([name, fx, fy]) => add(roof, stamp(scene, "prop", name, fx * hw, fy * hh)));
  return true;
}
