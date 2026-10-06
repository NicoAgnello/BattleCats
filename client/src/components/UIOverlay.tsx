import React, { useState, useEffect, useCallback } from "react";
import { Heart, Flame, Skull, Zap, EyeOff, Radio, Wifi, WifiOff, Loader2, Volume2, VolumeX, Trophy, RotateCcw, Sparkles, Shield, Smile } from "lucide-react";
import { soundManager } from "../game/SoundManager";

interface PlayerState {
  hp: number;
  maxHp: number;
  shield?: number;
  maxShield?: number;
  equippedWeapon?: string;
  isGhost: boolean;
  isHidden: boolean;
  dashCooldown: number;
  trapCooldown: number;
  kills: number;
  activeBuff: string;
  buffTimer: number;
}

interface ZoneState {
  timer: number;
  isShrinking: boolean;
  phase: number;
}

interface KillEvent {
  id: number;
  killer: string;
  victim: string;
  weapon?: string;
}

interface VictoryState {
  isVictory: boolean;
  winnerName: string;
  isMe: boolean;
  kills?: number;
}

const DEFAULT_PLAYER: PlayerState = {
  hp: 100,
  maxHp: 100,
  shield: 50,
  maxShield: 50,
  equippedWeapon: "LASER",
  isGhost: false,
  isHidden: false,
  dashCooldown: 0,
  trapCooldown: 0,
  kills: 0,
  activeBuff: "",
  buffTimer: 0,
};

interface UIOverlayProps {
  onOpenMenu?: () => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ onOpenMenu }) => {
  const [conn, setConn] = useState("CONNECTING");
  const [player, setPlayer] = useState<PlayerState>(DEFAULT_PLAYER);
  const [zone, setZone] = useState<ZoneState>({ timer: 18, isShrinking: false, phase: 1 });
  const [alive, setAlive] = useState({ alive: 7, total: 7 });
  const [styleScore, setStyleScore] = useState(0);
  const [stylePopup, setStylePopup] = useState<string | null>(null);
  const [killsFeed, setKillsFeed] = useState<KillEvent[]>([]);
  const [victory, setVictory] = useState<VictoryState | null>(null);
  const [isMuted, setIsMuted] = useState(soundManager.isMuted);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [showEmotes, setShowEmotes] = useState(false);

  const onConn = useCallback((e: Event) => setConn((e as CustomEvent).detail), []);
  const onPlayer = useCallback((e: Event) => setPlayer((e as CustomEvent).detail), []);
  const onZone = useCallback((e: Event) => setZone((e as CustomEvent).detail), []);
  const onAlive = useCallback((e: Event) => setAlive((e as CustomEvent).detail), []);
  const onVictory = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    setVictory({ isVictory: true, winnerName: d.winnerName, isMe: d.isMe, kills: d.kills });
    setRedirectCountdown(6);
  }, []);
  const onRestart = useCallback(() => {
    setVictory(null);
    setRedirectCountdown(null);
  }, []);
  const onPlaying = useCallback(() => {
    setVictory(null);
    setRedirectCountdown(null);
  }, []);

  // Countdown auto redirect
  useEffect(() => {
    if (redirectCountdown === null) return;
    if (redirectCountdown <= 0) {
      if (onOpenMenu) onOpenMenu();
      return;
    }
    const timer = setTimeout(() => {
      setRedirectCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [redirectCountdown, onOpenMenu]);

  const onKillFeed = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    const item: KillEvent = {
      id: Date.now() + Math.random(),
      killer: d.killer,
      victim: d.victim,
      weapon: d.weapon || "Bláster",
    };
    setKillsFeed(prev => [...prev.slice(-3), item]);
    setTimeout(() => {
      setKillsFeed(prev => prev.filter(k => k.id !== item.id));
    }, 4500);
  }, []);

  const onStyle = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    setStyleScore(d.score);
    if (d.reason) {
      setStylePopup(d.reason);
      setTimeout(() => setStylePopup(null), 1200);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("conn-update", onConn);
    window.addEventListener("player-update", onPlayer);
    window.addEventListener("zone-update", onZone);
    window.addEventListener("alive-update", onAlive);
    window.addEventListener("victory-update", onVictory);
    window.addEventListener("restart-update", onRestart);
    window.addEventListener("playing-update", onPlaying);
    window.addEventListener("killFeed-update", onKillFeed);
    window.addEventListener("style-update", onStyle);

    return () => {
      window.removeEventListener("conn-update", onConn);
      window.removeEventListener("player-update", onPlayer);
      window.removeEventListener("zone-update", onZone);
      window.removeEventListener("alive-update", onAlive);
      window.removeEventListener("victory-update", onVictory);
      window.removeEventListener("restart-update", onRestart);
      window.removeEventListener("playing-update", onPlaying);
      window.removeEventListener("killFeed-update", onKillFeed);
      window.removeEventListener("style-update", onStyle);
    };
  }, [onConn, onPlayer, onZone, onAlive, onVictory, onRestart, onPlaying, onKillFeed, onStyle]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    soundManager.setMuted(next);
  };

  const handleRestart = () => {
    if (onOpenMenu) {
      onOpenMenu();
    } else {
      window.dispatchEvent(new CustomEvent("restart-game"));
      setVictory(null);
    }
  };

  const selectWeapon = (weapon: string) => {
    window.dispatchEvent(new CustomEvent("switch-weapon", { detail: { weapon } }));
  };

  const triggerEmote = (emote: string) => {
    window.dispatchEvent(new CustomEvent("send-emote", { detail: { emote } }));
    setShowEmotes(false);
  };

  const getStyleRank = (score: number) => {
    if (score >= 900) return { rank: "RANGO SSS", label: "DIOS FELINO", badge: "bg-fuchsia-500/30 text-fuchsia-200" };
    if (score >= 700) return { rank: "RANGO S", label: "SUPER MICHI", badge: "bg-purple-500/30 text-purple-200" };
    if (score >= 500) return { rank: "RANGO A", label: "ASESINO", badge: "bg-amber-500/30 text-amber-200" };
    if (score >= 300) return { rank: "RANGO B", label: "BRAVO", badge: "bg-yellow-500/30 text-yellow-200" };
    if (score >= 120) return { rank: "RANGO C", label: "CAZADOR", badge: "bg-emerald-500/30 text-emerald-200" };
    return { rank: "RANGO D", label: "DORMILÓN", badge: "bg-slate-700/50 text-slate-300" };
  };

  const styleInfo = getStyleRank(styleScore);
  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  const shdPct = Math.max(0, Math.min(100, ((player.shield || 0) / (player.maxShield || 50)) * 100));
  const stylePct = Math.min(100, (styleScore / 1000) * 100);

  const weapons = [
    { key: "1", id: "LASER", name: "Bláster", icon: "🔫" },
    { key: "2", id: "SHOTGUN", name: "Escopeta", icon: "💥" },
    { key: "3", id: "SNIPER", name: "Sniper", icon: "⚡" },
    { key: "4", id: "GRENADE", name: "Granada", icon: "💣" },
    { key: "5", id: "MELEE", name: "Garras", icon: "🐾" },
  ];

  const emotes = ["🐾", "🔥", "💀", "😎", "😿", "🏆"];

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-5 select-none font-game">

      {/* ── FILA SUPERIOR (HUD) ───────────────────────────── */}
      <div className="flex items-start justify-between gap-4">

        {/* ── Izquierda: Barra de Salud, Escudo, Estilo ── */}
        <div className="pointer-events-auto flex flex-col gap-2 min-w-[280px]">

          {/* Badges de Conexión, Audio y Menú */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-panel text-xs font-bold shadow-lg">
              {conn === "CONNECTED" && <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Servidor Conectado</span></>}
              {conn === "CONNECTING" && <><Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" /><span className="text-amber-400">Conectando…</span></>}
              {conn === "ERROR" && <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400">Error de conexión</span></>}
            </div>

            <button
              onClick={toggleMute}
              className="glass-panel px-2.5 py-1 rounded-full text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1 hover:border-emerald-500/50"
              title="Alternar Sonido SFX"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isMuted ? "Mute" : "Audio"}</span>
            </button>

            {onOpenMenu && (
              <button
                onClick={onOpenMenu}
                className="glass-panel px-3 py-1 rounded-full text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1 hover:border-cyan-500/50"
                title="Volver al Menú Principal"
              >
                <span>⚙️ Menú</span>
              </button>
            )}
          </div>

          {/* Barra de Salud & Escudo */}
          <div className="glass-panel rounded-2xl p-3.5 border border-emerald-500/25 shadow-2xl backdrop-blur-md space-y-2">
            {/* HP */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <Heart className={`w-4 h-4 ${player.isGhost ? "text-cyan-400 fill-cyan-400" : "text-emerald-400 fill-emerald-400 animate-pulse"}`} />
                  <span className="text-[11px] font-black tracking-widest uppercase text-emerald-400">
                    {player.isGhost ? "FANTASMA MICHI" : "SALUD FELINA"}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-slate-200">{Math.ceil(player.hp)} / {player.maxHp}</span>
              </div>
              <div className="w-full h-3 bg-slate-900/90 rounded-full overflow-hidden border border-slate-700/60 p-0.5">
                <div
                  className="h-full rounded-full transition-all duration-200 shadow-md"
                  style={{
                    width: `${hpPct}%`,
                    background: player.isGhost
                      ? "linear-gradient(90deg, #0284c7, #38bdf8)"
                      : hpPct < 30 ? "linear-gradient(90deg, #dc2626, #f87171)"
                      : hpPct < 60 ? "linear-gradient(90deg, #d97706, #fbbf24)"
                      : "linear-gradient(90deg, #059669, #10b981)",
                  }}
                />
              </div>
            </div>

            {/* Escudo / Chaleco Suroi */}
            {!player.isGhost && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
                    <span className="text-[10px] font-black tracking-widest uppercase text-cyan-400">Escudo Felino</span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-cyan-300">{Math.ceil(player.shield || 0)} / {player.maxShield || 50}</span>
                </div>
                <div className="w-full h-2 bg-slate-900/90 rounded-full overflow-hidden border border-slate-700/60 p-0.5">
                  <div
                    className="h-full rounded-full transition-all duration-200 bg-gradient-to-r from-sky-500 to-cyan-400 shadow-md"
                    style={{ width: `${shdPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Barra de Estilo (Devil May Cry) */}
          <div className="glass-panel rounded-xl p-2.5 border border-amber-500/25 shadow-lg backdrop-blur-md">
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                <span className="text-[10px] font-black tracking-widest uppercase text-amber-400">Estilo Felino</span>
              </div>
              <span className={`text-[9px] font-black px-2 py-0.5 rounded shadow ${styleInfo.badge}`}>
                {styleInfo.rank} · {styleInfo.label}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900/90 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-red-500 rounded-full transition-all duration-300 shadow-lg"
                style={{ width: `${stylePct}%` }}
              />
            </div>
          </div>

          {/* Buffs Activos */}
          {player.activeBuff && (
            <div className="glass-panel self-start px-3 py-1.5 rounded-xl border border-yellow-500/40 text-xs font-bold flex items-center gap-2 animate-bounce">
              {player.activeBuff === "SPEED" && <><span>⚡</span><span className="text-amber-300">Super Velocidad</span></>}
              {player.activeBuff === "TRIPLE" && <><span>🌟</span><span className="text-purple-300">Triple Láser</span></>}
            </div>
          )}
        </div>

        {/* ── Centro: Zona Segura y Fase ── */}
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <div className="glass-panel px-7 py-3 rounded-2xl flex items-center gap-3.5 border border-amber-500/35 shadow-2xl backdrop-blur-md">
            <Radio className={`w-5 h-5 ${zone.isShrinking ? "text-red-400 animate-spin" : "text-emerald-400 animate-pulse"}`} />
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-extrabold tracking-widest text-slate-300 uppercase">
                {zone.isShrinking ? "¡LA ZONA SE ESTÁ CERRANDO!" : `Fase ${zone.phase} · Zona Segura`}
              </span>
              <span className={`text-2xl font-black font-mono tracking-wider ${zone.isShrinking ? "text-red-400 animate-pulse" : "text-amber-400"}`}>
                {zone.timer}s
              </span>
            </div>
          </div>

          {stylePopup && (
            <div className="glass-panel px-4 py-1 rounded-full border border-yellow-400/50 text-xs font-black text-amber-300 animate-bounce shadow-xl flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
              <span>{stylePopup}</span>
            </div>
          )}
        </div>

        {/* ── Derecha: Vivos, Kills, Emotes & KillFeed ── */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 min-w-[200px]">

          {/* Vivos, Kills & Botón de Emotes */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmotes(!showEmotes)}
              className="glass-panel p-2 rounded-xl text-amber-400 hover:text-yellow-300 hover:border-amber-400/60 transition shadow-lg flex items-center justify-center cursor-pointer"
              title="Expresiones y Emotes (E)"
            >
              <Smile className="w-5 h-5" />
            </button>

            <div className="glass-panel px-3.5 py-2 rounded-xl flex items-center gap-2 border border-slate-700/60 shadow-lg">
              <span className="text-sm">😼</span>
              <div>
                <div className="text-[9px] text-slate-400 font-extrabold uppercase">Gatos Vivos</div>
                <div className="text-sm font-black font-mono text-emerald-400">{alive.alive} / {alive.total}</div>
              </div>
            </div>

            <div className="glass-panel px-3.5 py-2 rounded-xl flex items-center gap-2 border border-slate-700/60 shadow-lg">
              <Skull className="w-4 h-4 text-red-400" />
              <div>
                <div className="text-[9px] text-slate-400 font-extrabold uppercase">Kills</div>
                <div className="text-sm font-black font-mono text-slate-100">{player.kills}</div>
              </div>
            </div>
          </div>

          {/* Menú de Emotes Flotante */}
          {showEmotes && (
            <div className="glass-panel p-2 rounded-2xl flex items-center gap-2 border border-amber-500/40 shadow-2xl animate-fadeIn">
              {emotes.map((em) => (
                <button
                  key={em}
                  onClick={() => triggerEmote(em)}
                  className="w-9 h-9 rounded-xl glass-panel hover:bg-amber-500/30 flex items-center justify-center text-lg hover:scale-110 transition cursor-pointer"
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {/* Badge Oculto en Arbusto */}
          {player.isHidden && !player.isGhost && (
            <div className="glass-panel px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-emerald-500/50 animate-pulse shadow-lg">
              <EyeOff className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-black text-emerald-400">Sigilo: Oculto en Arbusto</span>
            </div>
          )}

          {/* Kill Feed Toasts estilo Suroi */}
          <div className="flex flex-col gap-1.5 items-end mt-1">
            {killsFeed.map(k => (
              <div key={k.id} className="glass-panel px-3 py-1 rounded-lg border border-red-500/30 text-[11px] font-bold text-slate-200 flex items-center gap-1.5 animate-fadeIn">
                <span className="text-amber-400">{k.killer}</span>
                <span className="text-xs text-slate-400">[{k.weapon}]</span>
                <span className="text-red-400">{k.victim}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MODAL: VICTORIA ROYALE (#1) ────────────────────── */}
      {victory && (
        <div className="self-center pointer-events-auto glass-panel border-2 border-yellow-500/60 bg-slate-950/90 p-8 rounded-3xl text-center max-w-md shadow-2xl backdrop-blur-xl animate-fadeIn space-y-4">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 border-2 border-yellow-400 mx-auto flex items-center justify-center animate-bounce">
            <Trophy className="w-9 h-9 text-yellow-400" />
          </div>

          <div>
            <h2 className="text-3xl font-black tracking-wider text-yellow-400 uppercase drop-shadow-md">
              {victory.isMe ? "¡VICTORIA ROYALE!" : "PARTIDA TERMINADA"}
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              {victory.isMe
                ? "👑 ¡Eres el Michi Supremo y el último sobreviviente de la jungla!"
                : `🏆 Ganador: ${victory.winnerName}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs">
            <div>
              <span className="text-slate-400 block font-bold">Tus Eliminaciones</span>
              <span className="text-xl font-black text-white font-mono">{player.kills}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-bold">Rango de Estilo</span>
              <span className="text-xl font-black text-amber-400 font-mono">{styleInfo.rank}</span>
            </div>
          </div>

          <button
            onClick={handleRestart}
            className="w-full py-3.5 px-6 rounded-2xl font-black tracking-wider text-sm bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 text-slate-950 hover:brightness-110 active:scale-95 transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>
              {redirectCountdown !== null
                ? `VOLVER A PANTALLA DE INICIO (${redirectCountdown}s)`
                : "VOLVER A PANTALLA DE INICIO"}
            </span>
          </button>
        </div>
      )}

      {/* ── BANNER MODO FANTASMA ───────────────────────────────── */}
      {player.isGhost && !victory && (
        <div className="self-center pointer-events-auto glass-panel border border-cyan-500/40 bg-slate-950/80 p-4 rounded-2xl text-center max-w-sm space-y-2 shadow-2xl">
          <div className="flex items-center justify-center gap-2 text-cyan-400 font-black text-sm">
            <span>👻</span> MODO FANTASMA FELINO
          </div>
          <p className="text-xs text-cyan-200">
            Haz <strong>Clic Derecho</strong> para plantar trampas espectrales en el mapa.
          </p>
          {player.trapCooldown > 0 ? (
            <span className="text-amber-400 font-mono text-xs block font-bold">
              Recarga de Trampa: {player.trapCooldown.toFixed(1)}s
            </span>
          ) : (
            <span className="text-emerald-400 font-mono text-xs block font-bold">
              ¡Trampa Lista!
            </span>
          )}

          <button
            onClick={handleRestart}
            className="mt-2 py-1.5 px-4 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 mx-auto transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reiniciar Partida
          </button>
        </div>
      )}

      {/* ── FILA INFERIOR (SELECTOR DE ARMAS, DASH Y CONTROLES) ── */}
      <div className="flex items-end justify-between gap-4">

        {/* Cooldown del Dash */}
        <div className="pointer-events-auto glass-panel flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-700/60 shadow-xl backdrop-blur-md">
          <div className="relative w-11 h-11 rounded-xl bg-slate-800 border border-slate-600 flex items-center justify-center shadow-inner">
            <Zap className="w-6 h-6 text-amber-400" />
            {player.dashCooldown > 0 && (
              <div className="absolute inset-0 bg-slate-950/85 rounded-xl flex items-center justify-center text-xs font-mono font-black text-amber-400">
                {player.dashCooldown.toFixed(1)}s
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-black tracking-wide text-slate-100">DASH FELINO</div>
            <div className="text-[10px] font-bold text-slate-400">BARRA ESPACIADORA</div>
          </div>
        </div>

        {/* Selector de Armas Suroi (Slot 1-5) */}
        {!player.isGhost && (
          <div className="pointer-events-auto glass-panel p-2 rounded-2xl flex items-center gap-2 border border-slate-700/60 shadow-2xl backdrop-blur-md">
            {weapons.map((w) => {
              const active = (player.equippedWeapon || "LASER") === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => selectWeapon(w.id)}
                  className={`px-3 py-2 rounded-xl flex flex-col items-center min-w-[54px] transition cursor-pointer border ${
                    active
                      ? "bg-emerald-500/25 border-emerald-400 text-white scale-105 shadow-lg"
                      : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <span className="text-xs font-mono font-black text-slate-400">{w.key}</span>
                  <span className="text-base my-0.5">{w.icon}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider">{w.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Guía de controles */}
        <div className="glass-panel px-5 py-2.5 rounded-2xl border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-3 shadow-xl backdrop-blur-md">
          <span><b className="text-slate-100">WASD</b> Moverse</span>
          <span><b className="text-slate-100">1-5 / Rueda</b> Armas</span>
          <span><b className="text-slate-100">E</b> Emotes</span>
          <span><b className="text-slate-100">Espacio</b> Dash</span>
        </div>
      </div>
    </div>
  );
};
