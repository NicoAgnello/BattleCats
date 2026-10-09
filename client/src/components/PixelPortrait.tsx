import React, { useEffect, useState } from "react";

/* ─── Retrato Pixel Art Animado ──────────────────────────────────
 * Lee public/sprites/manifest.json (generado por /sprites/build.py) y anima
 * el retrato recorriendo su tira de frames horizontal.
 */

export interface PortraitInfo {
  name: string;
  title: string;
  w: number;
  h: number;
  frames: number;
  frameMs: number;
}

let manifestPromise: Promise<PortraitInfo[]> | null = null;

function loadPortraits(): Promise<PortraitInfo[]> {
  if (!manifestPromise) {
    manifestPromise = fetch("sprites/manifest.json")
      .then(r => (r.ok ? r.json() : { portraits: [] }))
      .then(m => (m.portraits ?? []) as PortraitInfo[])
      .catch(() => []);
  }
  return manifestPromise;
}

export const PixelPortrait: React.FC<{
  name: string;            // p.ej. "retrato-sargento"
  scale?: number;          // escala entera (pixel art nítido)
  className?: string;
  fallback?: React.ReactNode;
}> = ({ name, scale = 2, className = "", fallback = null }) => {
  const [info, setInfo] = useState<PortraitInfo | null | undefined>(undefined);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let alive = true;
    loadPortraits().then(list => {
      if (alive) setInfo(list.find(p => p.name === name) ?? null);
    });
    return () => { alive = false; };
  }, [name]);

  useEffect(() => {
    if (!info) return;
    setFrame(0);
    const id = window.setInterval(() => setFrame(f => (f + 1) % info.frames), info.frameMs);
    return () => window.clearInterval(id);
  }, [info]);

  if (info === null) return <>{fallback}</>;
  const w = (info?.w ?? 64) * scale;
  const h = (info?.h ?? 80) * scale;

  return (
    <div
      role="img"
      aria-label={info?.title ?? name}
      className={`select-none ${className}`}
      style={{
        width: w,
        height: h,
        backgroundImage: info ? `url(sprites/${info.name}.png)` : undefined,
        backgroundRepeat: "no-repeat",
        backgroundSize: info ? `${info.frames * w}px ${h}px` : undefined,
        backgroundPosition: `${-frame * w}px 0px`,
        imageRendering: "pixelated",
      }}
    />
  );
};
