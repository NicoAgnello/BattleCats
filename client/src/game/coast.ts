/* ─── Forma de la isla y oleaje de la costa ─────────────────────────────────
 * La isla es un cuadrado con esquinas muy redondeadas (radio 1500) y una costa
 * ondulada por ruido. islandEdge(x, y) = cuánto hacia adentro de la orilla está un
 * punto (en px del mundo): < 330 mar, 330..560 playa, > 560 pasto.
 * Las olas (crestas que van hacia la orilla y la resaca que sube y baja por la
 * arena) se calculan con waveFront() a partir de ese valor: no hay un sprite por
 * tramo de costa. Para la lógica del servidor ver docs/tecnico-agua-mar.md.
 */

export const WORLD = 8000;
export const P = 3;                          // 1 pixel del arte = 3 px del mundo
export const N = Math.ceil(WORLD / P);       // 2667 pixels por lado
export const SHORE = 330;                    // islandEdge donde termina el mar
export const BEACH_END = 560;                // islandEdge donde empieza el pasto
const CORNER = 1500;                         // radio de las esquinas de la isla

/** Ruido de valor suavizado (determinista; mismo resultado en cliente y servidor). */
export function makeNoise(cells: number, seed: number) {
  const g = new Float32Array((cells + 2) * (cells + 2));
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const scale = cells / N;
  return (px: number, py: number) => {
    const fx = px * scale, fy = py * scale;
    const x0 = fx | 0, y0 = fy | 0;
    // interpolación suave (smoothstep): sin quiebres en V entre celdas del ruido
    const ax = fx - x0, ay = fy - y0, tx = ax * ax * (3 - 2 * ax), ty = ay * ay * (3 - 2 * ay);
    const i = y0 * (cells + 2) + x0;
    const a = g[i] + (g[i + 1] - g[i]) * tx;
    const b = g[i + cells + 2] + (g[i + cells + 3] - g[i + cells + 2]) * tx;
    return a + (b - a) * ty;
  };
}

const nCoast = makeNoise(34, 51);            // ondulación de la orilla
const nBay = makeNoise(9, 83);               // bahías y cabos grandes

/** Distancia hacia adentro desde el borde de una caja de esquinas redondeadas + ruido. */
export function islandEdge(wx: number, wy: number): number {
  const dx = Math.min(wx, WORLD - wx), dy = Math.min(wy, WORLD - wy);
  const box = dx < CORNER && dy < CORNER ? CORNER - Math.hypot(CORNER - dx, CORNER - dy) : Math.min(dx, dy);
  const px = Math.max(0, Math.min(N - 1, wx / P)), py = Math.max(0, Math.min(N - 1, wy / P));
  return box + (nCoast(px, py) - 0.5) * 140 + (nBay(px, py) - 0.5) * 120;
}

/* Campo precalculado (lo llena generateGround): islandEdge cuantizado por pixel, para
 * consultarlo rápido cada frame (olas y gatos en el agua). 0..254 = 0..635 px, 255 = tierra adentro. */
const Q = 2.5;
export let edgeField: Uint8Array | null = null;
export let phaseField: Uint8Array | null = null;     // desfase de la ola según el tramo de costa
export function setFields(e: Uint8Array, ph: Uint8Array) { edgeField = e; phaseField = ph; }
export const quantizeEdge = (e: number) => Math.max(0, Math.min(255, Math.round(e / Q)));
export const dequantizeEdge = (q: number) => q * Q;

/** islandEdge en un punto (del campo si ya está, si no se calcula). */
export function edgeAt(wx: number, wy: number): number {
  if (edgeField) {
    const px = Math.max(0, Math.min(N - 1, Math.floor(wx / P))), py = Math.max(0, Math.min(N - 1, Math.floor(wy / P)));
    const q = edgeField[py * N + px];
    return q === 255 ? 1e4 : dequantizeEdge(q);
  }
  return islandEdge(wx, wy);
}

const nPhase = makeNoise(60, 11);            // corrimiento suave del desfase a lo largo de la costa

/** Desfase (0..1) de la ola en un punto: cambia a lo largo de la costa para que las
 *  olas no lleguen todas a la vez. */
export function wavePhase(wx: number, wy: number): number {
  const a = Math.atan2(wy - WORLD / 2, wx - WORLD / 2);
  const px = Math.max(0, Math.min(N - 1, wx / P)), py = Math.max(0, Math.min(N - 1, wy / P));
  return (((a / (Math.PI * 2)) * 7 + nPhase(px, py) * 0.35) % 1 + 1) % 1;
}

export const WAVE_PERIOD = 4200;              // ms de un ciclo de ola (sube y baja)
export const SWASH = 58;                      // cuánto sube la ola por la arena (px del mundo)

/** Hasta qué islandEdge llega el agua ahora en ese tramo de costa (sube rápido, baja lento). */
export function waveFront(time: number, phase: number): number {
  const u = ((time / WAVE_PERIOD + phase) % 1 + 1) % 1;
  const k = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
  const s = k * k * (3 - 2 * k);
  return SHORE - 14 + SWASH * s;
}

/** Profundidad del agua en un punto (0 = seco, 1 = cubierto del todo), con la ola. */
export function waterDepthAt(wx: number, wy: number, time: number): number {
  const e = edgeAt(wx, wy);
  if (e > SHORE + SWASH) return 0;
  const px = Math.max(0, Math.min(N - 1, Math.floor(wx / P))), py = Math.max(0, Math.min(N - 1, Math.floor(wy / P)));
  const ph = phaseField ? phaseField[py * N + px] / 255 : wavePhase(wx, wy);
  const front = waveFront(time, ph);
  return Math.max(0, Math.min(1, (front - e) / 170));
}
