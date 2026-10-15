import React, { useState, useEffect, useCallback, useRef } from "react";
import { Heart, Flame, Skull, Zap, EyeOff, Radio, Wifi, WifiOff, Loader2, Volume2, VolumeX, Trophy, RotateCcw, Sparkles, Shield, Smile, MessageCircle, Send, Clock, Users } from "lucide-react";
import { soundManager } from "../game/SoundManager";

interface PlayerState {
  hp: number;
  maxHp: number;
  shield?: number;
  maxShield?: number;
  equippedWeapon?: string;
  availableWeapons?: string;
  ammo?: number;
  maxAmmo?: number;
  reserveAmmo?: number;
  isReloading?: boolean;
  reloadTimer?: number;
  maxReloadTimer?: number;
  isGhost: boolean;
  isHidden: boolean;
  dashCooldown: number;
  trapCooldown: number;
  kills: number;
  activeBuff: string;
  buffTimer: number;
  invulnerableTimer?: number;
  stunTimer?: number;
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
  hp: 30,
  maxHp: 30,
  shield: 0,
  maxShield: 0,
  equippedWeapon: "MELEE",
  availableWeapons: "MELEE",
  ammo: 999,
  maxAmmo: 999,
  reserveAmmo: 0,
  isReloading: false,
  reloadTimer: 0,
  maxReloadTimer: 2.0,
  isGhost: false,
  isHidden: false,
  dashCooldown: 0,
  trapCooldown: 0,
  kills: 0,
  activeBuff: "",
  buffTimer: 0,
  invulnerableTimer: 0,
  stunTimer: 0,
};

interface RoomPlayer {
  id: string;
  name: string;
  catColor: number;
  isHost: boolean;
}

interface RoomInfo {
  isCustomRoom: boolean;
  roomCode: string;
  hostId: string;
  isHost: boolean;
  status: string;
  playerCount: number;
  players: RoomPlayer[];
}

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
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [sseInfo, setSseInfo] = useState<{ connected: boolean; tickRate: number; ping: number }>({
    connected: false,
    tickRate: 60,
    ping: 0,
  });

  // ── Estado del Lobby y Espectadores ────────────────────────────────────────
  const [lobbyState, setLobbyState] = useState<{ active: boolean; countdown: number } | null>(null);
  const [spectatorQueue, setSpectatorQueue] = useState<{ inQueue: boolean; position: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<{ id: number; senderName: string; text: string; isSpectator: boolean; isSystem?: boolean }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [spectatorChatOpen, setSpectatorChatOpen] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const onRoomInfo = useCallback((e: Event) => setRoomInfo((e as CustomEvent).detail), []);

  const onConn = useCallback((e: Event) => setConn((e as CustomEvent).detail), []);
  // Se combina con el estado anterior: algunas actualizaciones son parciales (p.ej. al
  // cambiar de arma) y reemplazar todo dejaba campos en undefined (pantalla en negro).
  const onPlayer = useCallback((e: Event) => setPlayer(prev => ({ ...prev, ...(e as CustomEvent).detail })), []);
  const onZone = useCallback((e: Event) => setZone((e as CustomEvent).detail), []);
  const onAlive = useCallback((e: Event) => setAlive((e as CustomEvent).detail), []);
  const onSseTelemetry = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d) {
      setSseInfo({
        connected: !!d.connected,
        tickRate: d.tickRate || 60,
        ping: d.ping || 0,
      });
    }
  }, []);
  const onVictory = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    setVictory({ isVictory: true, winnerName: d.winnerName, isMe: d.isMe, kills: d.kills });
    setRedirectCountdown(6);
  }, []);
  const onRestart = useCallback(() => {
    setVictory(null);
    setRedirectCountdown(null);
    setLobbyState(null);
    setSpectatorQueue(null);
  }, []);
  const onPlaying = useCallback(() => {
    setVictory(null);
    setRedirectCountdown(null);
    setLobbyState(null); // La partida empieza: cerrar el lobby overlay
  }, []);

  // ── Handlers del Lobby ────────────────────────────────────────────────────
  const onLobbyUpdate = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d.status === "LOBBY") {
      setLobbyState({
        active: true,
        countdown: d.countdown ?? 40,
      });
      setSpectatorQueue(null);
    } else if (d.status === "PLAYING" || d.status === "VICTORY") {
      setLobbyState(null);
    }
  }, []);

  const onLobbyStart = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    setLobbyState({ active: true, countdown: d.countdown ?? 40 });
    setSpectatorQueue(null);
    setChatMessages(prev => [...prev, { id: Date.now(), senderName: "Sistema", text: `⏳ ¡Partida en ${d.countdown}s! Nadie se puede mover. Hablen por el chat general hasta que comience.`, isSpectator: false, isSystem: true }]);
  }, []);

  const onChatMessage = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    const msg = { id: Date.now() + Math.random(), senderName: d.senderName, text: d.text, isSpectator: !!d.isSpectator };
    setChatMessages(prev => [...prev.slice(-49), msg]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const onSpectatorJoined = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;
    setSpectatorQueue({ inQueue: true, position: d.queuePosition });
    setLobbyState(null);
    setChatMessages(prev => [...prev, { id: Date.now(), senderName: "Sistema", text: `👻 Eres fantasma espectador — en cola (#${d.queuePosition}) para la próxima partida. ¡Puedes ver la partida y chatear!`, isSpectator: true, isSystem: true }]);
  }, []);

  const onQueuePromotion = useCallback((e: Event) => {
    setSpectatorQueue(null);
    setChatMessages(prev => [...prev, { id: Date.now(), senderName: "Sistema", text: "🚀 ¡Comenzó tu turno para jugar! Has sido añadido a la partida.", isSpectator: false, isSystem: true }]);
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
    window.addEventListener("roomInfo-update", onRoomInfo);
    window.addEventListener("conn-update", onConn);
    window.addEventListener("player-update", onPlayer);
    window.addEventListener("zone-update", onZone);
    window.addEventListener("alive-update", onAlive);
    window.addEventListener("victory-update", onVictory);
    window.addEventListener("restart-update", onRestart);
    window.addEventListener("playing-update", onPlaying);
    window.addEventListener("killFeed-update", onKillFeed);
    window.addEventListener("style-update", onStyle);
    window.addEventListener("sse-telemetry", onSseTelemetry);
    window.addEventListener("lobby-update", onLobbyUpdate);
    window.addEventListener("lobbyStart-update", onLobbyStart);
    window.addEventListener("chatMessage-update", onChatMessage);
    window.addEventListener("spectatorJoined-update", onSpectatorJoined);
    window.addEventListener("queuePromotion-update", onQueuePromotion);

    return () => {
      window.removeEventListener("roomInfo-update", onRoomInfo);
      window.removeEventListener("conn-update", onConn);
      window.removeEventListener("player-update", onPlayer);
      window.removeEventListener("zone-update", onZone);
      window.removeEventListener("alive-update", onAlive);
      window.removeEventListener("victory-update", onVictory);
      window.removeEventListener("restart-update", onRestart);
      window.removeEventListener("playing-update", onPlaying);
      window.removeEventListener("killFeed-update", onKillFeed);
      window.removeEventListener("style-update", onStyle);
      window.removeEventListener("sse-telemetry", onSseTelemetry);
      window.removeEventListener("lobby-update", onLobbyUpdate);
      window.removeEventListener("lobbyStart-update", onLobbyStart);
      window.removeEventListener("chatMessage-update", onChatMessage);
      window.removeEventListener("spectatorJoined-update", onSpectatorJoined);
      window.removeEventListener("queuePromotion-update", onQueuePromotion);
    };
  }, [onRoomInfo, onConn, onPlayer, onZone, onAlive, onVictory, onRestart, onPlaying, onKillFeed, onStyle, onSseTelemetry, onLobbyUpdate, onLobbyStart, onChatMessage, onSpectatorJoined, onQueuePromotion]);

  // Auto-scroll al final del chat cuando llegan mensajes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);


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

  const WEAPON_DEFS: Record<string, { name: string; icon: string }> = {
    LASER: { name: "Pistola", icon: "🔫" },
    SHOTGUN: { name: "Escopeta", icon: "💥" },
    SNIPER: { name: "Sniper", icon: "🎯" },
    GRENADE: { name: "Granada", icon: "💣" },
    MELEE: { name: "Garras", icon: "🐾" },
  };

  const parseWeaponSlots = (availableWeapons: string | undefined): [string, string, string] => {
    if (!availableWeapons) return ["", "", "MELEE"];
    const parts = availableWeapons.split(",");
    if (parts.length >= 3) {
      return [parts[0] || "", parts[1] || "", "MELEE"];
    }
    const guns = parts.filter((p) => p && p !== "MELEE");
    return [guns[0] || "", guns[1] || "", "MELEE"];
  };

  const [slot1, slot2] = parseWeaponSlots(player.availableWeapons);

  const weaponSlots = [
    {
      key: "1",
      id: slot1,
      name: slot1 ? WEAPON_DEFS[slot1]?.name || slot1 : "Vacío",
      icon: slot1 ? WEAPON_DEFS[slot1]?.icon || "🔫" : "🔒",
      available: !!slot1,
      active: !!slot1 && player.equippedWeapon === slot1,
    },
    {
      key: "2",
      id: slot2,
      name: slot2 ? WEAPON_DEFS[slot2]?.name || slot2 : "Vacío",
      icon: slot2 ? WEAPON_DEFS[slot2]?.icon || "💥" : "🔒",
      available: !!slot2,
      active: !!slot2 && player.equippedWeapon === slot2,
    },
    {
      key: "3",
      id: "MELEE",
      name: "Garras",
      icon: "🐾",
      available: true,
      active: player.equippedWeapon === "MELEE",
    },
  ];

  const selectWeapon = (weapon: string) => {
    if (!weapon) return;
    const [s1, s2] = parseWeaponSlots(player.availableWeapons);
    if (weapon !== "MELEE" && weapon !== s1 && weapon !== s2) return;
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
  const shdPct = (player.maxShield || 0) > 0 ? Math.max(0, Math.min(100, ((player.shield || 0) / (player.maxShield || 1)) * 100)) : 0;
  const stylePct = Math.min(100, (styleScore / 1000) * 100);

  const triggerReload = () => {
    window.dispatchEvent(new CustomEvent("reload-weapon"));
  };

  const emotes = ["🐾", "🔥", "💀", "😎", "😿", "🏆"];

  // ── Chat: enviar mensaje ───────────────────────────────────────────────────
  const sendChatMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent("send-chat", { detail: { text } }));
    setChatInput("");
  };

  const handleChatKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); sendChatMessage(); }
  };

  // ── PANTALLA EXCLUSIVA DE LOBBY: Solo Cuenta Regresiva de 40s + Chat General ──
  if (lobbyState?.active) {
    return (
      <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center font-game select-none" style={{ background: "rgba(2, 6, 23, 0.92)", backdropFilter: "blur(18px)" }}>
        <div className="flex flex-col items-center gap-6 w-full max-w-lg px-4 pointer-events-auto">

          {/* Header */}
          <div className="flex items-center gap-3">
            <span className="text-4xl animate-bounce">🐾</span>
            <div className="text-center">
              <h1 className="text-2xl font-black uppercase tracking-widest text-white drop-shadow">BattleCats.io</h1>
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                ⏳ Sala de Espera — Cuenta Regresiva
              </p>
            </div>
            <span className="text-4xl animate-bounce" style={{ animationDelay: "0.2s" }}>🐾</span>
          </div>

          {/* Countdown grande circular */}
          <div className="relative flex flex-col items-center">
            <div
              className="w-44 h-44 rounded-full flex flex-col items-center justify-center shadow-2xl border-4 transition-all duration-300"
              style={{
                background: "radial-gradient(circle, rgba(16,185,129,0.2) 0%, rgba(2,6,23,0.95) 80%)",
                borderColor: lobbyState.countdown <= 10 ? "#f87171" : lobbyState.countdown <= 20 ? "#fbbf24" : "#10b981",
                boxShadow: lobbyState.countdown <= 10 ? "0 0 50px rgba(248,113,113,0.5)" : "0 0 45px rgba(16,185,129,0.35)",
              }}
            >
              <span className="text-[10px] font-extrabold tracking-widest text-slate-400 uppercase">Inicio en</span>
              <span
                className="font-black font-mono leading-none"
                style={{
                  fontSize: "clamp(2.8rem, 8vw, 4.4rem)",
                  color: lobbyState.countdown <= 10 ? "#f87171" : lobbyState.countdown <= 20 ? "#fbbf24" : "#10b981",
                }}
              >
                {lobbyState.countdown}s
              </span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">¡Prepárate!</span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-300 bg-slate-900/80 px-4 py-1.5 rounded-full border border-slate-700/60 shadow-lg">
              <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span>Nadie se puede mover hasta que termine la cuenta regresiva</span>
            </div>
          </div>

          {/* Chat General */}
          <div className="w-full glass-panel rounded-2xl border border-slate-700/60 shadow-2xl overflow-hidden flex flex-col" style={{ height: "270px" }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/50 bg-slate-900/70">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">Chat General</span>
              <span className="ml-auto text-[10px] text-slate-400">Habla con los demás antes del combate</span>
            </div>
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-1.5"
              style={{ scrollbarWidth: "thin" }}
            >
              {chatMessages.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6 italic">Sé el primero en saludar a tus rivales 🐾</p>
              )}
              {chatMessages.map(msg => (
                <div key={msg.id} className={`text-xs flex gap-1.5 items-baseline ${msg.isSystem ? "text-amber-400 italic bg-amber-500/10 px-2 py-1 rounded-lg" : "text-slate-200"}` }>
                  {!msg.isSystem && (
                    <span className={`font-black whitespace-nowrap ${msg.isSpectator ? "text-cyan-400" : "text-emerald-400"}`}>
                      {msg.isSpectator ? "👻" : "🐾"} {msg.senderName}:
                    </span>
                  )}
                  <span className="break-all">{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 px-3 py-2 border-t border-slate-700/50 bg-slate-900/60">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value.slice(0, 120))}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                onKeyUp={e => e.stopPropagation()}
                placeholder="Escribe un mensaje en el chat... (Enter para enviar)"
                className="flex-1 bg-slate-800/90 border border-slate-600/70 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500/70 transition"
              />
              <button
                onClick={sendChatMessage}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-lg shadow-emerald-900/30"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            💬 Usa este tiempo para coordinar. La partida arrancará automáticamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-5 select-none font-game opacity-85 transition-opacity">

      {/* ── BANNER MODO ESPECTADOR (En cola para próxima partida) ── */}
      {spectatorQueue && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-3 px-5 py-2.5 rounded-2xl glass-panel border border-cyan-400/50 bg-slate-950/85 shadow-[0_0_30px_rgba(6,182,212,0.35)] animate-pulse">
          <span className="text-2xl">👻</span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-cyan-300">Modo Espectador</span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 text-[11px] font-black border border-cyan-400/40">
                Cola #{spectatorQueue.position}
              </span>
            </div>
            <span className="text-[10px] text-slate-300">
              Viendo la partida en curso. ¡Entrarás a jugar automáticamente al comenzar la próxima!
            </span>
          </div>
        </div>
      )}

      {/* ── CHAT FLOTANTE DURANTE PARTIDA (Para espectadores y jugadores) ── */}
      {(spectatorQueue || player.isGhost) && (
        <div className="absolute bottom-6 left-6 z-40 pointer-events-auto flex flex-col w-80 glass-panel rounded-2xl border border-slate-700/60 shadow-2xl overflow-hidden bg-slate-950/85">
          <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-slate-700/50 bg-slate-900/60 cursor-pointer" onClick={() => setSpectatorChatOpen(!spectatorChatOpen)}>
            <div className="flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-black uppercase tracking-wider text-cyan-400">Chat General</span>
            </div>
            <span className="text-[10px] text-slate-400 hover:text-white transition font-mono">
              {spectatorChatOpen ? "▼" : "▲"}
            </span>
          </div>

          {spectatorChatOpen && (
            <>
              <div
                className="overflow-y-auto px-3 py-2 space-y-1"
                style={{ maxHeight: "140px", scrollbarWidth: "thin" }}
              >
                {chatMessages.length === 0 && (
                  <p className="text-[11px] text-slate-500 text-center py-2 italic">Sin mensajes aún</p>
                )}
                {chatMessages.map(msg => (
                  <div key={msg.id} className={`text-xs flex gap-1.5 items-baseline ${msg.isSystem ? "text-amber-400 italic text-[11px]" : "text-slate-200"}` }>
                    {!msg.isSystem && (
                      <span className={`font-black whitespace-nowrap ${msg.isSpectator ? "text-cyan-400" : "text-emerald-400"}`}>
                        {msg.isSpectator ? "👻" : "🐾"} {msg.senderName}:
                      </span>
                    )}
                    <span className="break-all">{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-1.5 px-2.5 py-2 border-t border-slate-700/50 bg-slate-900/40">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value.slice(0, 120))}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  onKeyUp={e => e.stopPropagation()}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 bg-slate-800/80 border border-slate-600/60 rounded-lg px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/60 transition"
                />
                <button
                  onClick={sendChatMessage}
                  className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center cursor-pointer"
                >
                  <Send className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── FILA SUPERIOR (HUD) ───────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pointer-events-none">

        {/* ── Izquierda: Barra de Salud, Escudo, Estilo ── */}
        <div className="pointer-events-none flex flex-col gap-2 min-w-[280px]">

          {/* Badges de Conexión, Audio y Menú */}
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-panel text-xs font-bold shadow-lg">
              {conn === "CONNECTED" && <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Servidor Conectado</span></>}
              {conn === "CONNECTING" && <><Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" /><span className="text-amber-400">Conectando…</span></>}
              {conn === "ERROR" && <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400">Error de conexión</span></>}
            </div>

            {/* SSE Stream Telemetry */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-panel text-xs font-bold shadow-lg border border-cyan-500/30" title="Server-Sent Events Telemetría en Vivo">
              <span className={`w-2 h-2 rounded-full ${sseInfo.connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <span className="text-cyan-400 font-mono text-[11px]">
                ⚡ SSE {sseInfo.tickRate}Hz
              </span>
              {sseInfo.connected && (
                <span className="text-emerald-300 font-mono text-[10px]">
                  {sseInfo.ping}ms
                </span>
              )}
            </div>

            <button
              onClick={toggleMute}
              className="pointer-events-auto glass-panel px-2.5 py-1 rounded-full text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1 hover:border-emerald-500/50 cursor-pointer"
              title="Alternar Sonido SFX"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isMuted ? "Mute" : "Audio"}</span>
            </button>

            {onOpenMenu && (
              <button
                onClick={onOpenMenu}
                className="pointer-events-auto glass-panel px-3 py-1 rounded-full text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1 hover:border-cyan-500/50 cursor-pointer"
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
                    <Shield className={`w-3.5 h-3.5 ${(player.maxShield || 0) <= 0 ? "text-slate-500 fill-slate-500" : "text-cyan-400 fill-cyan-400"}`} />
                    <span className={`text-[10px] font-black tracking-widest uppercase ${(player.maxShield || 0) <= 0 ? "text-slate-500" : "text-cyan-400"}`}>
                      {(player.maxShield || 0) <= 0 ? "Sin Escudo (Solo Garras)" : "Escudo Felino"}
                    </span>
                  </div>
                  <span className={`font-mono text-[11px] font-bold ${(player.maxShield || 0) <= 0 ? "text-slate-500" : "text-cyan-300"}`}>
                    {(player.maxShield || 0) <= 0 ? "BLOQUEADO" : `${Math.ceil(player.shield || 0)} / ${player.maxShield || 50}`}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-900/90 rounded-full overflow-hidden border border-slate-700/60 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${(player.maxShield || 0) <= 0 ? "bg-slate-700/40" : "bg-gradient-to-r from-sky-500 to-cyan-400 shadow-md"}`}
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

        {/* ── Centro: Zona Segura, Fase y Lobby de Sala ── */}
        <div className="pointer-events-none flex flex-col items-center gap-2">
          {/* Sala Personalizada: Banner de Espera y Control de Host */}
          {roomInfo?.isCustomRoom && roomInfo.status === "WAITING" && (
            <div className="pointer-events-auto glass-panel p-4 rounded-2xl border-2 border-emerald-400 bg-slate-950/95 shadow-[0_0_40px_rgba(16,185,129,0.35)] backdrop-blur-xl flex flex-col items-center gap-2.5 animate-fadeIn max-w-sm w-full mb-1">
              <div className="flex items-center justify-between w-full border-b border-slate-700/60 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">👑</span>
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-400">
                    Sala Privada (Sin Bots)
                  </span>
                </div>
                <div className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300">
                  Máx 20
                </div>
              </div>

              {/* Código de Sala */}
              <div className="flex items-center justify-between w-full bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase font-bold text-slate-400">Código de Sala:</span>
                  <span className="font-mono text-xl font-black text-amber-400 tracking-widest">
                    {roomInfo.roomCode || "----"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playClick();
                    const url = `${window.location.origin}/?room=${roomInfo.roomCode}`;
                    navigator.clipboard.writeText(url);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition flex items-center gap-1 shadow cursor-pointer"
                >
                  <span>📋</span>
                  <span>{codeCopied ? "¡Copiado!" : "Copiar Enlace"}</span>
                </button>
              </div>

              {/* Lista de Jugadores */}
              <div className="w-full space-y-1">
                <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-400 uppercase">
                  <span>Jugadores Conectados:</span>
                  <span className="font-mono text-emerald-400 font-bold">{roomInfo.playerCount} / 20</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 bg-slate-900/50 rounded-lg border border-slate-800/50">
                  {roomInfo.players?.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60 text-[11px] font-bold text-slate-200"
                    >
                      <span>{p.isHost ? "👑" : "🐾"}</span>
                      <span>{p.name}</span>
                      {p.isHost && <span className="text-[8px] text-amber-400 font-extrabold">(Host)</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Acciones de Host vs Invitado */}
              {roomInfo.isHost ? (
                <div className="flex flex-col items-center w-full pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playClick();
                      window.dispatchEvent(new CustomEvent("start-match"));
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider shadow-2xl flex items-center justify-center gap-1.5 transform hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <span>🚀</span>
                    <span>Comenzar Partida (Host)</span>
                  </button>
                  <span className="text-[9px] text-slate-400 mt-1 font-medium text-center">
                    Inicia cuando todos los jugadores estén listos.
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center w-full pt-0.5 text-center">
                  <div className="w-full py-2 px-2.5 rounded-xl bg-slate-900/80 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold flex items-center justify-center gap-1.5 animate-pulse">
                    <span>⏳</span>
                    <span>Esperando a que el anfitrión inicie...</span>
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1">
                    ¡Prepárate! Todos tendrán 15s de inmunidad al comenzar.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Banner de Stun / Aturdimiento */}
          {(player.stunTimer ?? 0) > 0 && (
            <div className="glass-panel px-6 py-2 rounded-2xl flex items-center gap-3 border-2 border-amber-400 bg-amber-950/85 shadow-[0_0_30px_rgba(251,191,36,0.6)] backdrop-blur-md animate-pulse">
              <span className="text-xl animate-bounce">⚡</span>
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black tracking-widest text-amber-300 uppercase">
                  ¡TRAMPA ESPECTRAL!
                </span>
                <span className="text-base font-black font-mono tracking-wider text-yellow-200">
                  💫 ATURDIDO ({(player.stunTimer!).toFixed(1)}s)
                </span>
              </div>
            </div>
          )}

          {/* Banner de Invulnerabilidad Inicial */}
          {(player.invulnerableTimer ?? 0) > 0 && (
            <div className="glass-panel px-6 py-2 rounded-2xl flex items-center gap-3 border-2 border-cyan-400 bg-cyan-950/80 shadow-[0_0_30px_rgba(56,189,248,0.5)] backdrop-blur-md animate-pulse">
              <Shield className="w-5 h-5 text-cyan-300 animate-bounce" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black tracking-widest text-cyan-300 uppercase">
                  ESCUDO PROTECTOR INICIAL
                </span>
                <span className="text-base font-black font-mono tracking-wider text-white">
                  🛡️ {Math.ceil(player.invulnerableTimer!)}s INMUNIDAD
                </span>
              </div>
            </div>
          )}

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
        <div className="pointer-events-none flex flex-col items-end gap-2 min-w-[200px]">

          {/* Vivos, Kills & Botón de Emotes */}
          <div className="flex items-center gap-2 pointer-events-none">
            <button
              onClick={() => setShowEmotes(!showEmotes)}
              className="pointer-events-auto glass-panel p-2 rounded-xl text-amber-400 hover:text-yellow-300 hover:border-amber-400/60 transition shadow-lg flex items-center justify-center cursor-pointer"
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

      {/* ── BARRA MODO FANTASMA (arriba, no tapa el centro de la pantalla) ── */}
      {player.isGhost && !victory && !spectatorQueue && (() => {
        const TRAP_COOLDOWN = 6.0; // igual que el servidor (JungleRoom: trapCooldown = 6.0)
        const cooldown = player.trapCooldown ?? 0;
        const ready = cooldown <= 0;
        const progress = ready ? 1 : Math.max(0, Math.min(1, 1 - cooldown / TRAP_COOLDOWN));
        return (
          <div className="absolute left-1/2 -translate-x-1/2 top-32 pointer-events-auto glass-panel border border-cyan-500/40 bg-slate-950/80 px-4 py-2 rounded-xl shadow-xl flex items-center gap-3 w-[min(92vw,360px)]">
            <span className="text-cyan-400 font-black text-xs whitespace-nowrap">👻 FANTASMA</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-[10px] font-bold mb-1">
                <span className="text-cyan-200 truncate">Clic der.: trampa</span>
                <span className={`font-mono ml-2 whitespace-nowrap ${ready ? "text-emerald-400" : "text-amber-400"}`}>
                  {ready ? "¡Trampa lista!" : `${cooldown.toFixed(1)}s`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-100 ${ready ? "bg-emerald-400" : "bg-amber-400"}`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
            <button
              onClick={handleRestart}
              title="Reiniciar partida"
              className="py-1 px-2 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              Reiniciar
            </button>
          </div>
        );
      })()}

      {/* ── FILA INFERIOR (SELECTOR DE ARMAS, DASH Y CONTROLES) ── */}
      <div className="flex items-end justify-between gap-4 pointer-events-none">

        {/* Cooldown del Dash / Roll */}
        <div className="pointer-events-none glass-panel flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-700/60 shadow-xl backdrop-blur-md">
          <div className="relative w-11 h-11 rounded-xl bg-slate-800 border border-slate-600 flex items-center justify-center shadow-inner">
            <Zap className={`w-6 h-6 ${player.equippedWeapon === "MELEE" ? "text-amber-400" : "text-cyan-400"}`} />
            {player.dashCooldown > 0 && (
              <div className="absolute inset-0 bg-slate-950/85 rounded-xl flex items-center justify-center text-xs font-mono font-black text-amber-400">
                {player.dashCooldown.toFixed(1)}s
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-black tracking-wide text-slate-100">
              {player.equippedWeapon === "MELEE" ? "DASH FELINO" : "ROLL FELINO"}
            </div>
            <div className="text-[10px] font-bold text-slate-400">
              {player.equippedWeapon === "MELEE" ? "ESPACIO • 1.8s CD (RÁPIDO)" : "ESPACIO • 2.5s CD (ESQUIVAR)"}
            </div>
          </div>
        </div>

        {/* Selector de Armas Suroi (3 Slots) + Widget de Munición y Recarga */}
        {!player.isGhost && (
          <div className="flex flex-col items-center gap-2 pointer-events-none">
            {/* Widget de Munición y Recarga del Arma Equipada */}
            <div className="pointer-events-none glass-panel px-4 py-1.5 rounded-2xl flex items-center gap-3 border border-slate-700/60 shadow-2xl backdrop-blur-md">
              {/* Icono y Nombre */}
              <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
                <span className="text-xl">
                  {WEAPON_DEFS[player.equippedWeapon || "MELEE"]?.icon || "🐾"}
                </span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-200">
                    {WEAPON_DEFS[player.equippedWeapon || "MELEE"]?.name || "Garras"}
                  </span>
                  <span className="text-[9px] font-bold text-emerald-400">
                    {player.equippedWeapon === "MELEE" ? "ZARPAZOS (0.5s CD • 1/4 VIDA vs GARRAS)" : (player.equippedWeapon === "GRENADE" ? "LANZABLE (100/70 DMG)" : (player.equippedWeapon === "SHOTGUN" ? "15x5 DMG (75)" : (player.equippedWeapon === "SNIPER" ? "50 DMG • 0.4s CADENCIA" : "20 DMG")))}
                  </span>
                </div>
              </div>

              {/* Indicador de Munición */}
              {player.equippedWeapon === "MELEE" ? (
                <div className="flex items-center gap-1.5 font-mono text-amber-400 font-black text-sm">
                  <span>∞</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">INFINITO</span>
                </div>
              ) : player.equippedWeapon === "GRENADE" ? (
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-xl font-black text-lime-400">{player.ammo ?? 3}</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">/ 3 GRANADAS</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-mono">
                  <span className={`text-2xl font-black ${(player.ammo || 0) === 0 ? "text-red-400 animate-pulse" : "text-slate-100"}`}>
                    {player.ammo ?? 12}
                  </span>
                  <span className="text-xs font-bold text-slate-500">/</span>
                  <span className="text-sm font-bold text-emerald-400">
                    {player.reserveAmmo ?? 24}
                  </span>
                </div>
              )}

              {/* Botón / Estado de Recarga */}
              {player.isReloading ? (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black animate-pulse">
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  <span>RECARGANDO {((player.reloadTimer || 0)).toFixed(1)}s</span>
                </div>
              ) : (
                player.equippedWeapon !== "MELEE" && player.equippedWeapon !== "GRENADE" && (
                  <button
                    onClick={triggerReload}
                    disabled={(player.ammo ?? 0) >= (player.maxAmmo ?? 12) || (player.reserveAmmo ?? 0) <= 0}
                    className={`pointer-events-auto px-3 py-1 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer border ${
                      (player.ammo ?? 0) < (player.maxAmmo ?? 12) && (player.reserveAmmo ?? 0) > 0
                        ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 shadow-sm"
                        : "bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed"
                    }`}
                    title="Recargar arma (R)"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>[R] RECARGAR</span>
                  </button>
                )
              )}
            </div>

            {/* Selector de Armas Suroi (3 Slots: Slot 1, Slot 2, Slot 3 Garras) */}
            <div className="pointer-events-none glass-panel p-2 rounded-2xl flex items-center gap-2 border border-slate-700/60 shadow-2xl backdrop-blur-md">
              {weaponSlots.map((w) => {
                return (
                  <button
                    key={w.key}
                    type="button"
                    tabIndex={-1}
                    disabled={!w.available}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => w.available && selectWeapon(w.id)}
                    title={w.available ? `Equipar ${w.name} (${w.key})` : `Espacio ${w.key} vacío (recoge un arma en el mapa)`}
                    className={`pointer-events-auto px-3.5 py-2 rounded-xl flex flex-col items-center min-w-[58px] transition border focus:outline-none ${
                      !w.available
                        ? "opacity-35 bg-slate-950/40 border-slate-800/50 text-slate-600 cursor-not-allowed"
                        : w.active
                        ? "bg-emerald-500/25 border-emerald-400 text-white scale-105 shadow-lg cursor-pointer"
                        : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
                    }`}
                  >
                    <span className="text-xs font-mono font-black text-slate-400">{w.key}</span>
                    <span className="text-lg my-0.5">{w.icon}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider">
                      {w.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Guía de controles */}
        <div className="pointer-events-none glass-panel px-5 py-2.5 rounded-2xl border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-3 shadow-xl backdrop-blur-md">
          <span><b className="text-slate-100">WASD</b> Moverse</span>
          <span><b className="text-emerald-400">F</b> Recoger/Cambiar</span>
          <span><b className="text-amber-400">R</b> Recargar</span>
          <span><b className="text-slate-100">1-3 / Rueda</b> Armas</span>
          <span><b className="text-slate-100">E</b> Emotes</span>
          <span><b className="text-slate-100">Espacio</b> {player.equippedWeapon === "MELEE" ? "Dash rápido" : "Roll esquiva"}</span>
        </div>
      </div>
    </div>
  );
};
