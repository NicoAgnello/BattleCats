import React, { useState, useEffect, useCallback } from "react";
import { Heart, Flame, Skull, Zap, EyeOff, Radio, Wifi, WifiOff, Loader2 } from "lucide-react";

interface PlayerState {
  hp: number; maxHp: number;
  isGhost: boolean; isHidden: boolean;
  dashCooldown: number; trapCooldown: number;
  kills: number;
}

interface ZoneState {
  timer: number; isShrinking: boolean; phase: number;
}

const DEFAULT_PLAYER: PlayerState = {
  hp: 100, maxHp: 100, isGhost: false, isHidden: false,
  dashCooldown: 0, trapCooldown: 0, kills: 0,
};

export const UIOverlay: React.FC = () => {
  const [conn,   setConn]   = useState("CONNECTING");
  const [player, setPlayer] = useState<PlayerState>(DEFAULT_PLAYER);
  const [zone,   setZone]   = useState<ZoneState>({ timer: 15, isShrinking: false, phase: 1 });

  const onConn   = useCallback((e: Event) => setConn((e as CustomEvent).detail), []);
  const onPlayer = useCallback((e: Event) => setPlayer((e as CustomEvent).detail), []);
  const onZone   = useCallback((e: Event) => setZone((e as CustomEvent).detail), []);

  useEffect(() => {
    window.addEventListener("conn-update",   onConn);
    window.addEventListener("player-update", onPlayer);
    window.addEventListener("zone-update",   onZone);
    return () => {
      window.removeEventListener("conn-update",   onConn);
      window.removeEventListener("player-update", onPlayer);
      window.removeEventListener("zone-update",   onZone);
    };
  }, [onConn, onPlayer, onZone]);

  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-5 select-none font-game">

      {/* ── TOP ROW ───────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">

        {/* ── izquierda: salud + estilo ── */}
        <div className="pointer-events-auto flex flex-col gap-2 min-w-[280px]">

          {/* badge conexión */}
          <div className="self-start flex items-center gap-1.5 px-3 py-1 rounded-full glass-panel text-xs font-bold">
            {conn === "CONNECTED"  && <><Wifi     className="w-3.5 h-3.5 text-emerald-400"/><span className="text-emerald-400">Conectado</span></>}
            {conn === "CONNECTING" && <><Loader2  className="w-3.5 h-3.5 text-amber-400 animate-spin"/><span className="text-amber-400">Conectando…</span></>}
            {conn === "ERROR"      && <><WifiOff  className="w-3.5 h-3.5 text-red-400"/><span className="text-red-400">Error de conexión</span></>}
          </div>

          {/* barra salud */}
          <div className="glass-panel rounded-2xl p-3.5 border border-emerald-500/20 shadow-xl">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-emerald-400 fill-emerald-400"/>
                <span className="text-xs font-extrabold tracking-widest uppercase text-emerald-400">
                  {player.isGhost ? "FANTASMA" : "SALUD"}
                </span>
              </div>
              <span className="font-mono text-xs text-slate-300">{Math.ceil(player.hp)}/{player.maxHp}</span>
            </div>
            <div className="w-full h-3.5 bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${hpPct}%`,
                  background: player.isGhost
                    ? "#3b82f6"
                    : hpPct < 30 ? "#ef4444"
                    : hpPct < 60 ? "#f59e0b"
                    : "#10b981",
                }}
              />
            </div>
          </div>

          {/* barra de estilo */}
          <div className="glass-panel rounded-xl p-3 border border-amber-500/20">
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-amber-400"/>
                <span className="text-[11px] font-extrabold tracking-widest uppercase text-amber-400">Estilo</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">RANGO C</span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
              <div className="h-full w-0 bg-gradient-to-r from-amber-500 to-yellow-300 rounded-full transition-all duration-500"/>
            </div>
          </div>
        </div>

        {/* ── centro: zona ── */}
        <div className="pointer-events-auto glass-panel px-6 py-3 rounded-2xl flex items-center gap-3 border border-amber-500/30 shadow-xl">
          <Radio className={`w-5 h-5 ${zone.isShrinking ? "text-red-400 animate-spin" : "text-emerald-400"}`}/>
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
              {zone.isShrinking ? "¡ZONA REDUCIÉNDOSE!" : `Fase ${zone.phase} · Zona Segura`}
            </span>
            <span className={`text-2xl font-black font-mono ${zone.isShrinking ? "text-red-400" : "text-amber-400"}`}>
              {zone.timer}s
            </span>
          </div>
        </div>

        {/* ── derecha: kills + bush ── */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="glass-panel px-4 py-2.5 rounded-xl flex items-center gap-2 border border-slate-700/50">
            <Skull className="w-4 h-4 text-red-400"/>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">Eliminaciones</div>
              <div className="text-lg font-black font-mono text-slate-100">{player.kills}</div>
            </div>
          </div>
          {player.isHidden && !player.isGhost && (
            <div className="glass-panel px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-emerald-500/40 animate-pulse">
              <EyeOff className="w-3.5 h-3.5 text-emerald-400"/>
              <span className="text-xs font-bold text-emerald-400">Oculto</span>
            </div>
          )}
        </div>
      </div>

      {/* ── FANTASMA BANNER ───────────────────────────────────── */}
      {player.isGhost && (
        <div className="self-center pointer-events-auto glass-panel border border-blue-500/40 bg-blue-950/40 p-4 rounded-2xl text-center max-w-sm space-y-2">
          <div className="flex items-center justify-center gap-2 text-blue-400 font-black text-base">
            <Skull className="w-5 h-5"/> ELIMINADO — MODO FANTASMA
          </div>
          <p className="text-xs text-blue-200">Usa <strong>Clic Derecho</strong> para colocar una trampa.</p>
          {player.trapCooldown > 0 && (
            <span className="text-amber-400 font-mono text-sm">Recarga: {player.trapCooldown.toFixed(1)}s</span>
          )}
        </div>
      )}

      {/* ── BOTTOM ROW ────────────────────────────────────────── */}
      <div className="flex items-end justify-between">

        {/* dash cooldown */}
        <div className="pointer-events-auto glass-panel flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700/50">
          <div className="relative w-10 h-10 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-400"/>
            {player.dashCooldown > 0 && (
              <div className="absolute inset-0 bg-slate-950/80 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold text-amber-400">
                {player.dashCooldown.toFixed(1)}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-bold text-slate-200">DASH</div>
            <div className="text-[10px] text-slate-400">ESPACIO</div>
          </div>
        </div>

        {/* controles hint */}
        <div className="glass-panel px-4 py-2 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex gap-4">
          <span><b className="text-slate-200">WASD</b> Moverse</span>
          <span><b className="text-slate-200">Mouse</b> Apuntar</span>
          <span><b className="text-slate-200">Clic Izq</b> Disparar</span>
          <span><b className="text-slate-200">Clic Der</b> Trampa (Fantasma)</span>
        </div>
      </div>
    </div>
  );
};
