/* ─── Trazado del río (compartido: dibujo del suelo + lógica del juego) ──────
 * El río es una curva suave (Catmull-Rom) por los mismos 6 puntos de antes, en
 * lugar de una línea quebrada. MISMO CÓDIGO en client/src/game/river.ts: si se
 * cambia uno, cambiar el otro.
 */

export const RIVER_CONTROL = [
  { x: 4000, y: 0 }, { x: 4200, y: 1500 }, { x: 3900, y: 3100 },
  { x: 3800, y: 4900 }, { x: 4300, y: 6500 }, { x: 4100, y: 8000 },
];

/** Radio del agua (desde el centro del río) para la lógica: fricción del agua. */
export const RIVER_HALF_WIDTH = 60;

/** Centro del río muestreado densamente (cada ~25 px) sobre la curva. */
export const RIVER_PATH: { x: number; y: number }[] = (() => {
  const pts = RIVER_CONTROL;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const steps = 64;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
})();

/** Distancia de un punto al centro del río. */
export function riverDistance(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < RIVER_PATH.length - 1; i++) {
    const a = RIVER_PATH[i], b = RIVER_PATH[i + 1];
    if (Math.min(a.y, b.y) - 300 > y || Math.max(a.y, b.y) + 300 < y) continue;   // el río baja de norte a sur
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
}

/** x del centro del río a la altura y, y coseno de su inclinación (el río baja de norte a sur). */
export function riverAt(y: number): { x: number; cos: number } {
  let j = 0;
  while (j < RIVER_PATH.length - 2 && RIVER_PATH[j + 1].y < y) j++;
  const a = RIVER_PATH[j], b = RIVER_PATH[j + 1];
  const t = Math.max(0, Math.min(1, (y - a.y) / ((b.y - a.y) || 1)));
  return { x: a.x + (b.x - a.x) * t, cos: Math.cos(Math.atan2(b.x - a.x, b.y - a.y)) };
}

/** Puentes (cruzan el río sin fricción), centrados sobre el río a cada altura y con
 *  largo suficiente para ir de orilla a orilla (agua + barro). [x0, x1, y0, y1] */
export const BRIDGE_REACH = 132;            // medio largo medido en perpendicular al río
export const BRIDGES: [number, number, number, number][] = [2000, 4000, 6000].map(y => {
  const { x, cos } = riverAt(y);
  const half = Math.ceil(BRIDGE_REACH / Math.max(0.5, cos) / 12) * 12;   // múltiplo de 12 (4 px del sprite)
  const cx = Math.round(x / 3) * 3;
  return [cx - half, cx + half, y - 50, y + 50];
});

export function onBridge(x: number, y: number): boolean {
  return BRIDGES.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** ¿Está en el agua del río (fuera de los puentes)? */
export function inRiver(x: number, y: number): boolean {
  return !onBridge(x, y) && riverDistance(x, y) < RIVER_HALF_WIDTH;
}
