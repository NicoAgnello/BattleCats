import React, { useEffect, useRef } from "react";

/* ─── Fondo del menú: un pedazo de la jungla hecho con los sprites del juego ───
 * Pasto, un tramo de río, árboles, arbustos, rocas y cajas, con gatos de los cinco
 * skins caminando y algún fantasmita. Se dibuja a resolución baja (1 px del mundo =
 * SCALE px de pantalla, como en el juego) y la cámara se pasea despacio.
 * Antes era un video grabado con el HUD viejo: este no se desactualiza al cambiar el arte.
 */

const SCALE = 3;                 // igual que CAT_SPRITE_SCALE del juego
const PAN_EXTRA = 160;           // px del mundo de más a lo ancho para el paneo
const PAN_PERIOD_MS = 90_000;    // ida y vuelta de la cámara
const FPS = 30;

const GRASS = ["#355a24", "#3f6a2b", "#497a32", "#53893a", "#5c9641", "#67a348", "#74b052"];
const DIRT = ["#6b4a2f", "#7a5634", "#8a6240"];
const SAND = ["#b8a070", "#c9b27a", "#d8c690"];
const WATER = ["#245096", "#2a5ca8", "#2f63b8", "#3a72c4"];
const FLOWERS = ["#f2f0e6", "#f0cf5a", "#e05a9a", "#b07ae0"];

const CAT_SKINS = [
  "juego-felino-naranja-bosque",
  "juego-felino-gris-urbano",
  "juego-felino-negro-selva",
  "juego-felino-crema-desierto",
  "juego-felino-blanco-nieve",
];

/** Hoja de sprites con sus frames tal como los exporta Aseprite (public/sprites/*.json). */
interface Frame { x: number; y: number; w: number; h: number }
interface Sheet { img: HTMLImageElement; frames: Frame[]; w: number; h: number }

/** Ruido determinístico para que la escena sea siempre la misma. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
/** Ruido suave (bilineal) para manchas de pasto y tierra. */
function smooth(x: number, y: number, cell: number) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const a = hash2(gx, gy), b = hash2(gx + 1, gy), c = hash2(gx, gy + 1), d = hash2(gx + 1, gy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

async function loadSheet(name: string): Promise<Sheet | null> {
  try {
    const meta = await fetch(`sprites/${name}.json`).then((r) => r.json());
    const frames: Frame[] = Object.values(meta.frames as Record<string, { frame: Frame }>).map((f) => f.frame);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = `sprites/${name}.png`;
    });
    return { img, frames, w: frames[0].w, h: frames[0].h };
  } catch {
    return null;
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, s: Sheet, i: number, x: number, y: number) {
  const f = s.frames[i % s.frames.length];
  ctx.drawImage(s.img, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), f.w, f.h);
}

interface Walker {
  sheet: Sheet; x: number; y: number; tx: number; ty: number;
  angle: number; pause: number; frame: number;
}
interface Ghost { x: number; y: number; phase: number; speed: number }

export const GameplayBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let cancelled = false;
    let raf = 0;
    let ground: HTMLCanvasElement | null = null;   // pasto, río, rocas y cajas
    let canopy: HTMLCanvasElement | null = null;   // árboles y arbustos (tapan a los gatos)
    let worldW = 0, worldH = 0, viewW = 0, viewH = 0;
    let riverX = (_y: number) => 0;
    const walkers: Walker[] = [];
    const ghosts: Ghost[] = [];
    let sheets: Record<string, Sheet | null> = {};

    const inRiver = (x: number, y: number, pad = 0) => Math.abs(x - riverX(y)) < 16 + pad;

    /** Arma las capas fijas del mundo para el tamaño de pantalla actual. */
    const buildWorld = () => {
      viewW = Math.ceil(window.innerWidth / SCALE);
      viewH = Math.ceil(window.innerHeight / SCALE);
      worldW = viewW + PAN_EXTRA;
      worldH = viewH;
      canvas.width = viewW;
      canvas.height = viewH;
      ctx.imageSmoothingEnabled = false;

      riverX = (y: number) => worldW * 0.66 + Math.sin(y / 38) * 14 + Math.sin(y / 17) * 4;

      ground = document.createElement("canvas");
      ground.width = worldW; ground.height = worldH;
      const g = ground.getContext("2d")!;
      const img = g.createImageData(worldW, worldH);
      const put = (i: number, hex: string) => {
        img.data[i] = parseInt(hex.slice(1, 3), 16);
        img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[i + 3] = 255;
      };
      for (let y = 0; y < worldH; y++) {
        const rx = riverX(y);
        for (let x = 0; x < worldW; x++) {
          const i = (y * worldW + x) * 4;
          const d = Math.abs(x - rx);
          const j = hash2(x, y);
          if (d < 13) {
            put(i, WATER[Math.min(WATER.length - 1, Math.floor((smooth(x, y, 9) * 0.7 + j * 0.3) * WATER.length))]);
          } else if (d < 16) {
            put(i, SAND[Math.floor(j * SAND.length)]);
          } else {
            const n = smooth(x, y, 14) * 0.75 + smooth(x, y, 5) * 0.25;
            if (smooth(x + 500, y, 26) > 0.78) {
              put(i, DIRT[Math.floor(j * DIRT.length)]);
            } else if (j > 0.994) {
              put(i, FLOWERS[Math.floor(hash2(y, x) * FLOWERS.length)]);
            } else {
              put(i, GRASS[Math.min(GRASS.length - 1, Math.floor((n * 0.85 + j * 0.15) * GRASS.length))]);
            }
          }
        }
      }
      g.putImageData(img, 0, 0);

      canopy = document.createElement("canvas");
      canopy.width = worldW; canopy.height = worldH;
      const c = canopy.getContext("2d")!;
      const r = rng(7);
      /** `variants`: primer frame de cada variante (cajas y barriles tienen 3 etapas de daño por variante). */
      const place = (s: Sheet | null, n: number, layer: CanvasRenderingContext2D, variants: number[]) => {
        if (!s) return;
        for (let k = 0; k < n; k++) {
          for (let tries = 0; tries < 20; tries++) {
            const x = r() * (worldW - s.w), y = r() * (worldH - s.h);
            if (inRiver(x + s.w / 2, y + s.h / 2, s.w / 2)) continue;
            drawFrame(layer, s, variants[Math.floor(r() * variants.length)], x, y);
            break;
          }
        }
      };
      const area = (worldW * worldH) / 40000;   // cantidad de cosas según el tamaño
      place(sheets.roca, Math.round(area * 1.2), g, [0, 1, 2, 3]);
      place(sheets.caja, Math.round(area * 0.8), g, [0, 3, 6]);
      place(sheets.barril, Math.round(area * 0.4), g, [0, 3]);
      place(sheets.arbusto, Math.round(area * 1.2), c, [0, 1, 2, 3, 4, 5, 6, 7]);
      place(sheets.arbol, Math.round(area * 1.0), c, [0, 1, 2, 3]);

      walkers.length = 0;
      ghosts.length = 0;
      const cats = CAT_SKINS.map((n) => sheets[n]).filter((s): s is Sheet => !!s);
      for (let k = 0; k < Math.max(8, Math.round(area * 2.4)) && cats.length; k++) {
        let x = r() * worldW, y = r() * worldH;
        if (inRiver(x, y, 10)) x = (x + worldW / 3) % worldW;
        walkers.push({ sheet: cats[k % cats.length], x, y, tx: x, ty: y, angle: r() * Math.PI * 2, pause: r() * 3, frame: r() * 6 });
      }
      for (let k = 0; k < 3; k++) {
        ghosts.push({ x: r() * worldW, y: r() * worldH, phase: r() * Math.PI * 2, speed: 4 + r() * 4 });
      }
    };

    const update = (dt: number) => {
      const r = Math.random;
      for (const w of walkers) {
        if (w.pause > 0) { w.pause -= dt; continue; }
        const dx = w.tx - w.x, dy = w.ty - w.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          w.pause = 1 + r() * 3;
          for (let tries = 0; tries < 10; tries++) {
            const tx = Math.max(16, Math.min(worldW - 16, w.x + (r() - 0.5) * 160));
            const ty = Math.max(16, Math.min(worldH - 16, w.y + (r() - 0.5) * 120));
            if (!inRiver(tx, ty, 10) && !inRiver((tx + w.x) / 2, (ty + w.y) / 2, 10)) { w.tx = tx; w.ty = ty; break; }
          }
          continue;
        }
        const speed = 22;   // px del mundo por segundo
        w.x += (dx / dist) * speed * dt;
        w.y += (dy / dist) * speed * dt;
        w.angle = Math.atan2(dy, dx);
        w.frame += dt * 10;
      }
      for (const g of ghosts) {
        g.phase += dt;
        g.x += g.speed * dt;
        if (g.x > worldW + 12) g.x = -12;
      }
    };

    const draw = (now: number) => {
      if (!ground || !canopy) return;
      const pan = reduceMotion ? PAN_EXTRA / 2 : (0.5 - 0.5 * Math.cos((now / PAN_PERIOD_MS) * Math.PI * 2)) * PAN_EXTRA;
      const camX = Math.round(pan);
      ctx.drawImage(ground, camX, 0, viewW, viewH, 0, 0, viewW, viewH);

      for (const w of walkers) {
        const sx = w.x - camX;
        if (sx < -32 || sx > viewW + 32) continue;
        const moving = w.pause <= 0;
        const frame = moving ? 4 + (Math.floor(w.frame) % 6) : Math.floor(now / 250) % 4;
        ctx.save();
        ctx.translate(Math.round(sx), Math.round(w.y));
        ctx.rotate(w.angle);
        drawFrame(ctx, w.sheet, frame, -16, -16);
        ctx.restore();
      }

      ctx.drawImage(canopy, camX, 0, viewW, viewH, 0, 0, viewW, viewH);

      const ghostSheet = sheets.fantasma;
      if (ghostSheet) {
        ctx.globalAlpha = 0.7;
        for (const g of ghosts) {
          drawFrame(ctx, ghostSheet, Math.floor(g.phase * 3) % 2, g.x - camX, g.y + Math.sin(g.phase * 2) * 3);
        }
        ctx.globalAlpha = 1;
      }
    };

    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc < 1 / FPS) return;
      update(acc);
      acc = 0;
      draw(now);
    };

    Promise.all([
      ...CAT_SKINS.map((n) => loadSheet(n).then((s) => [n, s] as const)),
      loadSheet("mundo-arbol").then((s) => ["arbol", s] as const),
      loadSheet("mundo-arbusto").then((s) => ["arbusto", s] as const),
      loadSheet("mundo-roca").then((s) => ["roca", s] as const),
      loadSheet("mundo-caja").then((s) => ["caja", s] as const),
      loadSheet("mundo-barril").then((s) => ["barril", s] as const),
      loadSheet("efecto-gatito-fantasma").then((s) => ["fantasma", s] as const),
    ]).then((list) => {
      if (cancelled) return;
      sheets = Object.fromEntries(list);
      buildWorld();
      if (reduceMotion) draw(0);
      else raf = requestAnimationFrame(loop);
    });

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        buildWorld();
        if (reduceMotion) draw(0);
      }, 150);
    };
    // Con la pestaña oculta no se anima (ahorra CPU mientras jugás en otra ventana)
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduceMotion && ground) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none" style={{ background: "#0b0810" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ imageRendering: "pixelated" }} />
      {/* Oscurecido parejo + bordes más oscuros, para que el menú se lea encima */}
      <div className="absolute inset-0" style={{ background: "rgba(11, 8, 16, 0.55)" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(11, 8, 16, 0.75) 100%)" }} />
    </div>
  );
};
