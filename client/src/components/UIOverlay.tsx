import React, { useState, useEffect, useCallback, useRef } from "react";
import { Zap, EyeOff, Volume2, VolumeX, Trophy, Smile, MessageCircle, Send } from "lucide-react";
import { soundManager } from "../game/SoundManager";
import { PixelPortrait } from "./PixelPortrait";
import { SKINS, type PlayerConfig } from "./StartScreen";

/* ── Piezas del HUD pixel art ────────────────────────────────────────────── */

/** Primer frame de un sprite del juego (public/sprites), a escala entera. */
const SpriteIcon: React.FC<{ name: string; w: number; h: number; scale?: number; frame?: number; className?: string }> = ({
  name, w, h, scale = 1, frame = 0, className = "",
}) => (
  <span
    aria-hidden="true"
    className={`hud-sprite ${className}`}
    style={{
      width: w * scale,
      height: h * scale,
      backgroundImage: `url(sprites/${name}.png)`,
      backgroundSize: `auto ${h * scale}px`,
      backgroundPosition: `${-frame * w * scale}px 0`,
    }}
  />
);

/** Colores de la barra de vida sobre los gatos (MainScene.redrawHp): [franja clara, base]. */
const hpColors = (pct: number, ghost: boolean): [string, string] =>
  ghost ? ["#bae6fd", "#38bdf8"]
  : pct < 30 ? ["#fca5a5", "#ef4444"]
  : pct < 60 ? ["#fde68a", "#f59e0b"]
  : ["#6ee7b7", "#10b981"];

/** Sprite de cada arma (primer frame del ítem del suelo; garras = zarpazo). */
const WEAPON_SPRITES: Record<string, { name: string; w: number; h: number; frame?: number }> = {
  LASER: { name: "item-pistola", w: 12, h: 8 },
  SHOTGUN: { name: "item-escopeta", w: 19, h: 9 },
  SNIPER: { name: "item-sniper", w: 26, h: 9 },
  GRENADE: { name: "item-granada", w: 9, h: 10 },
  MELEE: { name: "efecto-zarpazo", w: 22, h: 18, frame: 2 },
};

const WeaponSprite: React.FC<{ id: string; scale?: number }> = ({ id, scale = 2 }) => {
  const s = WEAPON_SPRITES[id];
  return s ? <SpriteIcon name={s.name} w={s.w} h={s.h} frame={s.frame} scale={scale} /> : null;
};

/** Barra segmentada: un corte cada `segments` partes, como bloques de vida. */
const HudBar: React.FC<{ pct: number; light: string; base: string; segments?: number; empty?: string; height?: number }> = ({
  pct, light, base, segments = 0, empty, height,
}) => (
  <div className="hud-bar flex-1" style={{ background: empty, height }}>
    <div
      className="hud-fill"
      style={{ width: `${pct}%`, background: `linear-gradient(${light} 0 3px, ${base} 3px)` }}
    />
    {segments > 1 && (
      <div
        className="hud-ticks"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent calc(100% - 2px), var(--hud-ink) 0)",
          backgroundSize: `${100 / segments}% 100%`,
        }}
      />
    )}
  </div>
);

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
  /** Nombre y skin elegidos en el menú (retrato del HUD). */
  playerConfig?: PlayerConfig | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ onOpenMenu, playerConfig }) => {
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

  // Clic fuera de un campo de texto: soltarlo. Phaser cancela el pointerdown sobre el
  // canvas, así que el navegador no saca el foco solo y el juego seguía sin teclado.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.contains(e.target as Node)) {
        el.blur();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
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

  // ── Sala de espera de la partida rápida: cuenta regresiva + chat ──
  if (lobbyState?.active) {
    const left = lobbyState.countdown;
    const [cdLight, cdBase] = left <= 10 ? ["#fca5a5", "#ef4444"] : left <= 20 ? ["#fde68a", "#f59e0b"] : ["#6ee7b7", "#10b981"];
    return (
      <div className="hud pointer-events-none absolute inset-0 z-50 flex items-center justify-center select-none" style={{ background: "rgba(11, 8, 16, 0.9)" }}>
        <div className="flex flex-col items-center gap-5 w-full max-w-md px-4 pointer-events-auto">

          <div className="hud-panel w-full px-6 py-5 flex flex-col items-center gap-3">
            <span className="text-[16px]" style={{ color: "var(--hud-dim)" }}>La partida rápida arranca en</span>
            <span className="text-[72px] leading-none tabular-nums" style={{ color: cdBase }}>{left}</span>
            <div className="flex w-full">
              <HudBar pct={(left / 40) * 100} light={cdLight} base={cdBase} segments={8} />
            </div>
            <span className="text-[14px] text-center" style={{ color: "var(--hud-dim)" }}>
              Nadie se puede mover hasta que termine la cuenta.
            </span>
          </div>

          <div className="hud-panel w-full flex flex-col" style={{ height: "270px" }}>
            <div className="flex items-center gap-2 px-3 py-2 text-[15px]" style={{ borderBottom: "2px solid var(--hud-ink)" }}>
              <MessageCircle className="w-4 h-4" style={{ color: "#6ee7b7" }} />
              Chat
            </div>
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[14px]" style={{ scrollbarWidth: "thin" }}>
              {chatMessages.length === 0 && (
                <p className="text-[14px] text-center py-6" style={{ color: "var(--hud-dim)" }}>Saludá a tus rivales antes de que arranque.</p>
              )}
              {chatMessages.map(msg => (
                <div key={msg.id} className="flex gap-1.5 items-baseline" style={{ color: msg.isSystem ? "var(--hud-gold)" : "var(--hud-text)" }}>
                  {!msg.isSystem && (
                    <span className="whitespace-nowrap" style={{ color: msg.isSpectator ? "var(--hud-shield)" : "#6ee7b7" }}>
                      {msg.senderName}:
                    </span>
                  )}
                  <span className="break-all">{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 p-2.5" style={{ borderTop: "2px solid var(--hud-ink)" }}>
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
                placeholder="Escribí un mensaje y apretá Enter"
                className="flex-1 min-w-0 px-2 h-[28px] text-[14px] outline-none"
                style={{ background: "#120e18", color: "var(--hud-text)", boxShadow: "0 0 0 2px var(--hud-ink), inset 0 2px 0 var(--hud-shade)" }}
              />
              <button onClick={sendChatMessage} className="hud-chip h-[28px] cursor-pointer" aria-label="Enviar mensaje">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-5 select-none font-game opacity-85 transition-opacity">

      {/* ── Espectador en la fila para la próxima partida ── */}
      {spectatorQueue && (
        <div className="hud hud-panel absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-4 px-4 py-2.5">
          <SpriteIcon name="efecto-gatito-fantasma" w={11} h={11} scale={3} />
          <div className="flex flex-col">
            <span className="text-[16px]">
              Mirando la partida <span style={{ color: "var(--hud-shield)" }}>· lugar {spectatorQueue.position} en la fila</span>
            </span>
            <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Entrás a jugar cuando empiece la próxima.</span>
          </div>
        </div>
      )}

      {/* ── Chat (fantasmas y espectadores) ── */}
      {(spectatorQueue || player.isGhost) && (
        <div className="hud hud-panel absolute bottom-6 left-6 z-40 pointer-events-auto flex flex-col w-80">
          <button
            type="button"
            className="flex items-center justify-between px-3 py-2 text-[15px] cursor-pointer"
            style={{ borderBottom: spectatorChatOpen ? "2px solid var(--hud-ink)" : undefined }}
            onClick={() => setSpectatorChatOpen(!spectatorChatOpen)}
            aria-expanded={spectatorChatOpen}
          >
            <span className="flex items-center gap-2"><MessageCircle className="w-4 h-4" style={{ color: "var(--hud-shield)" }} />Chat</span>
            <span style={{ color: "var(--hud-dim)" }}>{spectatorChatOpen ? "Ocultar" : "Mostrar"}</span>
          </button>

          {spectatorChatOpen && (
            <>
              <div className="overflow-y-auto px-3 py-2 space-y-1 text-[14px]" style={{ maxHeight: "140px", scrollbarWidth: "thin" }}>
                {chatMessages.length === 0 && (
                  <p className="text-[13px] text-center py-2" style={{ color: "var(--hud-dim)" }}>Todavía no hay mensajes.</p>
                )}
                {chatMessages.map(msg => (
                  <div key={msg.id} className="flex gap-1.5 items-baseline" style={{ color: msg.isSystem ? "var(--hud-gold)" : "var(--hud-text)" }}>
                    {!msg.isSystem && (
                      <span className="whitespace-nowrap" style={{ color: msg.isSpectator ? "var(--hud-shield)" : "#6ee7b7" }}>
                        {msg.senderName}:
                      </span>
                    )}
                    <span className="break-all">{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 p-2.5" style={{ borderTop: "2px solid var(--hud-ink)" }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value.slice(0, 120))}
                  onKeyDown={e => {
                    e.stopPropagation();
                    // Al mandar (o con Escape) se suelta el campo: el juego ignora el
                    // teclado mientras haya un input con foco y quedabas sin poder moverte
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendChatMessage();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.blur();
                    }
                  }}
                  onKeyUp={e => e.stopPropagation()}
                  placeholder="Escribí un mensaje (Esc para volver al juego)"
                  className="flex-1 min-w-0 px-2 h-[26px] text-[14px] outline-none"
                  style={{ background: "#120e18", color: "var(--hud-text)", boxShadow: "0 0 0 2px var(--hud-ink), inset 0 2px 0 var(--hud-shade)" }}
                />
                <button onClick={sendChatMessage} className="hud-chip h-[26px] cursor-pointer" aria-label="Enviar mensaje">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── FILA SUPERIOR (HUD) ───────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pointer-events-none">

        {/* ── Izquierda: placa del jugador (retrato, vida, escudo, estilo) ── */}
        <div className="hud pointer-events-none flex flex-col gap-3 w-[340px]">

          {/* Estado de la conexión, SSE, sonido y menú */}
          <div className="flex items-center gap-2.5 pointer-events-none">
            <span className="hud-chip" title="Conexión con el servidor de juego (WebSocket)">
              <span
                className="w-2 h-2"
                style={{ background: conn === "CONNECTED" ? "#10b981" : conn === "CONNECTING" ? "#f59e0b" : "#ef4444" }}
              />
              {conn === "CONNECTED" ? "Conectado" : conn === "CONNECTING" ? "Conectando…" : "Sin conexión"}
            </span>
            <span className="hud-chip" title="Server-Sent Events: telemetría del servidor. El ping se mide ida y vuelta por WebSocket.">
              <span style={{ color: "var(--hud-shield)" }}>SSE {sseInfo.tickRate} Hz</span>
              {sseInfo.connected && <span style={{ color: "var(--hud-dim)" }}>{sseInfo.ping} ms</span>}
            </span>
            <button
              onClick={toggleMute}
              className="hud-chip pointer-events-auto cursor-pointer"
              title={isMuted ? "Activar sonido" : "Silenciar"}
              aria-label={isMuted ? "Activar sonido" : "Silenciar"}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            {onOpenMenu && (
              <button onClick={onOpenMenu} className="hud-chip pointer-events-auto cursor-pointer" title="Volver al menú principal">
                Menú
              </button>
            )}
          </div>

          {/* Placa: retrato animado + barras */}
          <div className="hud-panel flex gap-3 p-3">
            <div
              className="flex-none overflow-hidden"
              style={{
                width: 64, height: 80,
                background: "#120e18",
                boxShadow: "0 0 0 2px var(--hud-ink), inset 0 0 0 2px var(--hud-bevel)",
                filter: player.isGhost ? "grayscale(1) brightness(1.2) sepia(1) hue-rotate(160deg)" : undefined,
                opacity: player.isGhost ? 0.75 : 1,
              }}
            >
              <PixelPortrait name={(SKINS[playerConfig?.skin ?? 0] ?? SKINS[0]).portrait} scale={1} />
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[18px] leading-none truncate">{playerConfig?.name || "Michi"}</span>
                {player.isGhost
                  ? <span className="text-[13px]" style={{ color: "#38bdf8" }}>Fantasma</span>
                  : <span className="text-[13px]" style={{ color: "var(--hud-dim)" }} title="Rango de estilo">
                      {styleInfo.label.charAt(0) + styleInfo.label.slice(1).toLowerCase()}
                    </span>}
              </div>

              {/* Vida: un bloque cada 10 puntos */}
              <div className="flex items-center gap-2">
                <SpriteIcon name="item-botiquin" w={18} h={16} />
                {(() => {
                  const [light, base] = hpColors(hpPct, player.isGhost);
                  return <HudBar pct={hpPct} light={light} base={base} segments={Math.round(player.maxHp / 10)} />;
                })()}
                <span className="text-[14px] tabular-nums w-[52px] text-right">{Math.ceil(player.hp)}/{player.maxHp}</span>
              </div>

              {/* Escudo */}
              {!player.isGhost && (
                <div className="flex items-center gap-2" style={{ opacity: (player.maxShield || 0) > 0 ? 1 : 0.55 }}>
                  <SpriteIcon name="item-escudo" w={16} h={16} className="mx-px" />
                  <HudBar
                    pct={shdPct}
                    light="#bae6fd"
                    base="var(--hud-shield)"
                    empty="var(--hud-shield-empty)"
                    height={10}
                    segments={(player.maxShield || 0) > 0 ? Math.round((player.maxShield || 50) / 10) : 0}
                  />
                  <span className="text-[14px] tabular-nums w-[52px] text-right" style={{ color: "var(--hud-dim)" }}>
                    {(player.maxShield || 0) > 0 ? `${Math.ceil(player.shield || 0)}/${player.maxShield}` : "—"}
                  </span>
                </div>
              )}

              {/* Estilo: letra de rango + barra fina */}
              <div className="flex items-center gap-2">
                <span
                  className="w-[18px] h-[18px] flex items-center justify-center text-[14px] leading-none"
                  style={{ background: "var(--hud-gold)", color: "var(--hud-ink)", boxShadow: "0 0 0 2px var(--hud-ink)" }}
                  title="Rango de estilo"
                >
                  {styleInfo.rank.replace("RANGO ", "")}
                </span>
                <HudBar pct={stylePct} light="#fde68a" base="#f59e0b" height={6} />
                <span className="w-[52px]" />
              </div>
            </div>
          </div>

          {/* Buff activo */}
          {player.activeBuff && (
            <span className="hud-chip self-start">
              {player.activeBuff === "SPEED" && <><SpriteIcon name="item-velocidad" w={14} h={18} /><span style={{ color: "var(--hud-gold)" }}>Velocidad</span></>}
              {player.activeBuff === "TRIPLE" && <><SpriteIcon name="item-triple" w={20} h={16} /><span style={{ color: "#c4b5fd" }}>Triple láser</span></>}
            </span>
          )}
        </div>

        {/* ── Centro: sala privada, aturdido, inmunidad y zona ── */}
        <div className="hud pointer-events-none flex flex-col items-center gap-3">
          {/* Sala privada esperando: código, jugadores y arranque del anfitrión */}
          {roomInfo?.isCustomRoom && roomInfo.status === "WAITING" && (
            <div className="hud-panel pointer-events-auto w-[320px] p-4 flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[16px]">Sala privada</span>
                <span className="text-[14px] tabular-nums" style={{ color: "var(--hud-dim)" }}>
                  {roomInfo.playerCount}/20 jugadores
                </span>
              </div>

              <div className="flex items-center justify-between px-3 py-2" style={{ background: "#120e18", boxShadow: "0 0 0 2px var(--hud-ink)" }}>
                <div className="flex flex-col">
                  <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Código</span>
                  <span className="room-code text-[30px] leading-none" style={{ color: "var(--hud-gold)" }}>
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
                  className="hud-chip cursor-pointer"
                >
                  {codeCopied ? "Copiado" : "Copiar enlace"}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 max-h-[72px] overflow-y-auto p-0.5">
                {roomInfo.players?.map((p) => (
                  <span key={p.id} className="hud-chip">
                    <span>{p.name}</span>
                    {p.isHost && <span style={{ color: "var(--hud-gold)" }}>anfitrión</span>}
                  </span>
                ))}
              </div>

              {roomInfo.isHost ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playClick();
                      window.dispatchEvent(new CustomEvent("start-match"));
                    }}
                    className="hud-btn w-full py-2 cursor-pointer"
                  >
                    Comenzar partida
                  </button>
                  <span className="text-[13px] text-center" style={{ color: "var(--hud-dim)" }}>
                    Arrancala cuando estén todos adentro.
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1 text-center">
                  <span className="text-[15px] hud-blink" style={{ color: "var(--hud-shield)" }}>
                    Esperando al anfitrión…
                  </span>
                  <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>
                    Al empezar, todos tienen 15 s de inmunidad.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Aturdido por una trampa fantasma */}
          {(player.stunTimer ?? 0) > 0 && (
            <div className="hud-panel px-4 py-2 flex items-center gap-3" style={{ background: "#3b2410" }}>
              <SpriteIcon name="efecto-trampa" w={22} h={22} scale={2} />
              <div className="flex flex-col">
                <span className="text-[13px]" style={{ color: "#fde68a" }}>Trampa fantasma</span>
                <span className="text-[20px] leading-none tabular-nums" style={{ color: "var(--hud-gold)" }}>
                  Aturdido {(player.stunTimer!).toFixed(1)} s
                </span>
              </div>
            </div>
          )}

          {/* Inmunidad inicial */}
          {(player.invulnerableTimer ?? 0) > 0 && (
            <div className="hud-chip h-[30px] px-3 text-[15px]">
              <SpriteIcon name="item-escudo" w={16} h={16} />
              <span style={{ color: "var(--hud-shield)" }}>Inmune</span>
              <span className="tabular-nums">{Math.ceil(player.invulnerableTimer!)} s</span>
            </div>
          )}

          {/* Zona: fase y cuenta regresiva */}
          <div className="hud-panel px-5 py-2 flex flex-col items-center min-w-[150px]" style={zone.isShrinking ? { background: "#3a1218" } : undefined}>
            <span className="text-[13px]" style={{ color: zone.isShrinking ? "#fca5a5" : "var(--hud-dim)" }}>
              {zone.isShrinking ? "La zona se cierra" : `Fase ${zone.phase} · zona segura`}
            </span>
            <span
              className={`text-[30px] leading-none tabular-nums ${zone.isShrinking ? "hud-blink" : ""}`}
              style={{ color: zone.isShrinking ? "#ef4444" : "var(--hud-gold)" }}
            >
              {zone.timer} s
            </span>
          </div>

          {stylePopup && (
            <span className="hud-chip" style={{ color: "var(--hud-gold)" }}>{stylePopup}</span>
          )}
        </div>

        {/* ── Derecha: vivos, kills, emotes y eliminaciones ── */}
        <div className="hud pointer-events-none flex flex-col items-end gap-3 min-w-[200px]">

          <div className="flex items-start gap-3">
            <button
              onClick={() => setShowEmotes(!showEmotes)}
              className="hud-chip pointer-events-auto cursor-pointer h-[44px] px-3"
              title="Emotes (E)"
              aria-label="Emotes"
            >
              <Smile className="w-5 h-5" style={{ color: "var(--hud-gold)" }} />
            </button>

            <div className="hud-panel flex">
              <div className="px-3 py-1.5 flex flex-col items-end">
                <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Vivos</span>
                <span className="text-[20px] leading-none tabular-nums" style={{ color: "#6ee7b7" }}>
                  {alive.alive}<span style={{ color: "var(--hud-dim)" }}>/{alive.total}</span>
                </span>
              </div>
              <div className="w-[2px] my-1.5" style={{ background: "var(--hud-ink)" }} />
              <div className="px-3 py-1.5 flex items-center gap-2">
                <SpriteIcon name="efecto-tumba" w={14} h={15} />
                <div className="flex flex-col items-end">
                  <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Kills</span>
                  <span className="text-[20px] leading-none tabular-nums">{player.kills}</span>
                </div>
              </div>
            </div>
          </div>

          {showEmotes && (
            <div className="hud-panel pointer-events-auto p-2 flex items-center gap-2">
              {emotes.map((em) => (
                <button
                  key={em}
                  onClick={() => triggerEmote(em)}
                  className="hud-chip w-9 h-9 justify-center text-lg cursor-pointer"
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {player.isHidden && !player.isGhost && (
            <span className="hud-chip" style={{ color: "#6ee7b7" }}>
              <EyeOff className="w-4 h-4" />
              Oculto en el arbusto
            </span>
          )}

          {/* Eliminaciones */}
          <div className="flex flex-col gap-2 items-end">
            {killsFeed.map(k => (
              <span key={k.id} className="hud-chip">
                <span style={{ color: "var(--hud-gold)" }}>{k.killer}</span>
                <span style={{ color: "var(--hud-dim)" }}>{k.weapon}</span>
                <span style={{ color: "#fca5a5" }}>{k.victim}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Fin de la partida ── */}
      {victory && (
        <div className="hud hud-panel self-center pointer-events-auto p-6 w-[360px] flex flex-col items-center gap-4 text-center">
          {victory.isMe ? (
            <div style={{ boxShadow: "0 0 0 2px var(--hud-ink), inset 0 0 0 2px var(--hud-gold)", background: "#120e18" }}>
              <PixelPortrait name={(SKINS[playerConfig?.skin ?? 0] ?? SKINS[0]).portrait} scale={2} />
            </div>
          ) : (
            <Trophy className="w-10 h-10" style={{ color: "var(--hud-gold)" }} />
          )}

          <div className="flex flex-col gap-1">
            <h2 className="text-[34px] leading-none" style={{ color: "var(--hud-gold)" }}>
              {victory.isMe ? "Ganaste" : "Partida terminada"}
            </h2>
            <p className="text-[15px]" style={{ color: "var(--hud-dim)" }}>
              {victory.isMe ? "Sos el último gato en pie." : `Ganó ${victory.winnerName}.`}
            </p>
          </div>

          <div className="flex w-full" style={{ background: "#120e18", boxShadow: "0 0 0 2px var(--hud-ink)" }}>
            <div className="flex-1 py-2 flex flex-col">
              <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Kills</span>
              <span className="text-[24px] leading-none tabular-nums">{player.kills}</span>
            </div>
            <div className="w-[2px]" style={{ background: "var(--hud-ink)" }} />
            <div className="flex-1 py-2 flex flex-col">
              <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Rango de estilo</span>
              <span className="text-[24px] leading-none" style={{ color: "var(--hud-gold)" }}>{styleInfo.rank.replace("RANGO ", "")}</span>
            </div>
          </div>

          <button onClick={handleRestart} className="hud-btn w-full py-2.5 cursor-pointer">
            {redirectCountdown !== null ? `Volver al menú (${redirectCountdown} s)` : "Volver al menú"}
          </button>
        </div>
      )}

      {/* ── Fantasma: recarga de la trampa ── */}
      {player.isGhost && !victory && !spectatorQueue && (() => {
        const TRAP_COOLDOWN = 6.0; // igual que el servidor (JungleRoom: trapCooldown = 6.0)
        const cooldown = player.trapCooldown ?? 0;
        const ready = cooldown <= 0;
        const progress = ready ? 1 : Math.max(0, Math.min(1, 1 - cooldown / TRAP_COOLDOWN));
        return (
          <div className="hud hud-panel absolute left-1/2 -translate-x-1/2 top-32 pointer-events-auto px-4 py-2.5 flex items-center gap-3 w-[min(92vw,400px)]">
            <SpriteIcon name="efecto-trampa" w={22} h={22} />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex justify-between text-[14px]">
                <span className="flex items-center gap-1.5 truncate" style={{ color: "var(--hud-shield)" }}>
                  <span className="hud-key">Clic der.</span> Trampa
                </span>
                <span className="tabular-nums whitespace-nowrap" style={{ color: ready ? "#6ee7b7" : "var(--hud-gold)" }}>
                  {ready ? "Lista" : `${cooldown.toFixed(1)} s`}
                </span>
              </div>
              <div className="flex">
                <HudBar
                  pct={progress * 100}
                  light={ready ? "#a7f3d0" : "#fde68a"}
                  base={ready ? "#10b981" : "#f59e0b"}
                  height={8}
                />
              </div>
            </div>
            <button onClick={handleRestart} className="hud-chip cursor-pointer whitespace-nowrap" title="Salir de la partida y volver al menú">
              Volver al menú
            </button>
          </div>
        );
      })()}

      {/* ── Fila inferior: dash, arma equipada, slots y controles ── */}
      <div className="hud flex items-end justify-between gap-4 pointer-events-none">

        {/* Dash / rodar con su recarga */}
        {(() => {
          const isMelee = player.equippedWeapon === "MELEE";
          const maxCd = isMelee ? 1.8 : 2.5;
          const cdPct = Math.min(100, (player.dashCooldown / maxCd) * 100);
          return (
            <div className="hud-panel flex items-center gap-3 px-3 py-2.5">
              <div className="relative w-11 h-11 flex items-center justify-center overflow-hidden" style={{ background: "#120e18", boxShadow: "0 0 0 2px var(--hud-ink)" }}>
                <Zap className="w-6 h-6" style={{ color: isMelee ? "var(--hud-gold)" : "var(--hud-shield)" }} />
                {player.dashCooldown > 0 && (
                  <>
                    <div className="absolute inset-x-0 bottom-0" style={{ height: `${cdPct}%`, background: "rgba(11,8,16,0.82)" }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[15px] tabular-nums" style={{ color: "var(--hud-gold)" }}>
                      {player.dashCooldown.toFixed(1)}
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[16px] leading-none">{isMelee ? "Dash" : "Rodar"}</span>
                <span className="flex items-center gap-2 text-[13px] whitespace-nowrap" style={{ color: "var(--hud-dim)" }}>
                  <span className="hud-key">Espacio</span>
                  {maxCd.toString().replace(".", ",")} s
                </span>
              </div>
            </div>
          );
        })()}

        {/* Arma equipada + slots */}
        {!player.isGhost && (
          <div className="flex flex-col items-center gap-3 pointer-events-none">
            {(() => {
              const w = player.equippedWeapon || "MELEE";
              const detail: Record<string, string> = {
                MELEE: "Zarpazo cada 0,5 s",
                GRENADE: "100 de daño al centro, 70 en el borde",
                SHOTGUN: "5 perdigones de 15",
                SNIPER: "50 de daño por tiro",
                LASER: "20 de daño por tiro",
              };
              const canReload = (player.ammo ?? 0) < (player.maxAmmo ?? 12) && (player.reserveAmmo ?? 0) > 0;
              return (
                <div className="hud-panel flex items-center gap-4 px-4 py-2">
                  <div className="flex items-center gap-3">
                    <WeaponSprite id={w} />
                    <div className="flex flex-col">
                      <span className="text-[16px] leading-tight">{WEAPON_DEFS[w]?.name || "Garras"}</span>
                      <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>{detail[w] || ""}</span>
                    </div>
                  </div>

                  {w === "MELEE" ? null : w === "GRENADE" ? (
                    <span className="text-[22px] leading-none tabular-nums">
                      {player.ammo ?? 3}<span className="text-[14px]" style={{ color: "var(--hud-dim)" }}>/3</span>
                    </span>
                  ) : (
                    <span className="text-[24px] leading-none tabular-nums" style={{ color: (player.ammo || 0) === 0 ? "#ef4444" : undefined }}>
                      {player.ammo ?? 12}
                      <span className="text-[15px]" style={{ color: "var(--hud-dim)" }}> / {player.reserveAmmo ?? 24}</span>
                    </span>
                  )}

                  {player.isReloading ? (
                    <span className="hud-chip hud-blink" style={{ color: "var(--hud-gold)" }}>
                      Recargando {(player.reloadTimer || 0).toFixed(1)} s
                    </span>
                  ) : (
                    w !== "MELEE" && w !== "GRENADE" && (
                      <button
                        onClick={triggerReload}
                        disabled={!canReload}
                        className="hud-chip pointer-events-auto cursor-pointer disabled:cursor-not-allowed"
                        style={{ opacity: canReload ? 1 : 0.45 }}
                        title="Recargar (R)"
                      >
                        <span className="hud-key">R</span>
                        Recargar
                      </button>
                    )
                  )}
                </div>
              );
            })()}

            <div className="hud-panel flex items-center gap-3 p-3">
              {weaponSlots.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  tabIndex={-1}
                  disabled={!w.available}
                  data-active={w.active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => w.available && selectWeapon(w.id)}
                  title={w.available ? `Equipar ${w.name} (${w.key})` : `Slot ${w.key} vacío: agarrá un arma del mapa`}
                  className="hud-slot pointer-events-auto cursor-pointer disabled:cursor-default focus:outline-none"
                >
                  <span className="absolute top-1 left-1.5 text-[12px] leading-none" style={{ color: w.active ? "var(--hud-gold)" : "var(--hud-dim)" }}>
                    {w.key}
                  </span>
                  <span className="flex-1 flex items-center">
                    {w.available ? <WeaponSprite id={w.id} /> : null}
                  </span>
                  <span className="text-[12px] leading-none" style={{ color: w.available ? "var(--hud-text)" : "var(--hud-dim)", opacity: w.available ? 1 : 0.6 }}>
                    {w.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Controles */}
        <div className="hud-panel hidden lg:flex items-center gap-4 px-4 py-2.5 text-[13px] whitespace-nowrap" style={{ color: "var(--hud-dim)" }}>
          <span className="flex items-center gap-1.5"><span className="hud-key">WASD</span> Moverse</span>
          <span className="flex items-center gap-1.5"><span className="hud-key">F</span> Agarrar</span>
          <span className="flex items-center gap-1.5"><span className="hud-key">R</span> Recargar</span>
          <span className="flex items-center gap-1.5"><span className="hud-key">1-3</span> Armas</span>
          <span className="flex items-center gap-1.5"><span className="hud-key">E</span> Emotes</span>
        </div>
      </div>
    </div>
  );
};
