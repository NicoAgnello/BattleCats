import React, { useState, useEffect } from "react";
import { soundManager } from "../game/SoundManager";
import { GameplayBackground } from "./GameplayBackground";

export interface PlayerConfig {
  name: string;
  skin: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

interface StartScreenProps {
  onStartGame: (config: PlayerConfig) => void;
}

export interface SkinItem {
  id: number;
  name: string;
  title: string;
  rarity: "Común" | "Rara" | "Épica" | "Legendaria";
  rarityColor: string;
  color: string;
  earInner: string;
  discount?: string;
  glow: string;
}

export const SKINS: SkinItem[] = [
  {
    id: 0,
    name: "Esmeralda",
    title: "Battle Cat Táctico",
    rarity: "Común",
    rarityColor: "#10b981",
    color: "#10b981",
    earInner: "#f472b6",
    glow: "rgba(16, 185, 129, 0.45)",
  },
  {
    id: 1,
    name: "Carmesí",
    title: "Ninja Sangriento",
    rarity: "Rara",
    rarityColor: "#ef4444",
    color: "#ef4444",
    earInner: "#f43f5e",
    discount: "-25%",
    glow: "rgba(239, 68, 68, 0.45)",
  },
  {
    id: 2,
    name: "Violeta",
    title: "Sombra Real",
    rarity: "Épica",
    rarityColor: "#8b5cf6",
    color: "#8b5cf6",
    earInner: "#f472b6",
    glow: "rgba(139, 92, 246, 0.45)",
  },
  {
    id: 3,
    name: "Garfield",
    title: "Michi Fuego",
    rarity: "Rara",
    rarityColor: "#f97316",
    color: "#f97316",
    earInner: "#fb7185",
    discount: "-15%",
    glow: "rgba(249, 115, 22, 0.45)",
  },
  {
    id: 4,
    name: "Neón",
    title: "Ciber Azul",
    rarity: "Épica",
    rarityColor: "#06b6d4",
    color: "#06b6d4",
    earInner: "#f472b6",
    glow: "rgba(6, 182, 212, 0.45)",
  },
  {
    id: 5,
    name: "Leyenda",
    title: "Gato Dorado Mítico",
    rarity: "Legendaria",
    rarityColor: "#eab308",
    color: "#eab308",
    earInner: "#f43f5e",
    discount: "VIP",
    glow: "rgba(234, 179, 8, 0.55)",
  },
];

// Diep.io / Suroi Style 3D Cat Avatar Preview
const CatAvatar3D: React.FC<{
  colorHex: string;
  earInnerHex: string;
  size?: number;
  isSelected?: boolean;
}> = ({ colorHex, earInnerHex, size = 80, isSelected }) => (
  <div
    style={{ width: size, height: size }}
    className="relative flex items-center justify-center select-none"
  >
    <svg
      viewBox="0 0 100 100"
      style={{ width: size, height: size }}
      className={`drop-shadow-xl transition-transform duration-200 ${
        isSelected ? "animate-float-3d scale-110" : "hover:scale-105"
      }`}
    >
      <defs>
        <radialGradient id={`cat-grad-${colorHex.replace("#", "")}`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="50%" stopColor={colorHex} />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>

      {/* Sombra proyectada */}
      <ellipse cx="50" cy="88" rx="26" ry="6" fill="#000000" opacity="0.35" />

      {/* Manos / Patas Suroi */}
      <circle cx="24" cy="62" r="7.5" fill={colorHex} stroke="#1e293b" strokeWidth="2.5" />
      <circle cx="76" cy="62" r="7.5" fill={colorHex} stroke="#1e293b" strokeWidth="2.5" />

      {/* Oreja Izquierda */}
      <polygon
        points="26,45 14,14 46,28"
        fill={`url(#cat-grad-${colorHex.replace("#", "")})`}
        stroke="#1e293b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon points="27,42 18,20 42,30" fill={earInnerHex} />

      {/* Oreja Derecha */}
      <polygon
        points="74,45 86,14 54,28"
        fill={`url(#cat-grad-${colorHex.replace("#", "")})`}
        stroke="#1e293b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <polygon points="73,42 82,20 58,30" fill={earInnerHex} />

      {/* Cuerpo Circular */}
      <circle
        cx="50"
        cy="55"
        r="31"
        fill={`url(#cat-grad-${colorHex.replace("#", "")})`}
        stroke="#1e293b"
        strokeWidth="3.5"
      />

      {/* Ojos */}
      <ellipse cx="38" cy="51" rx="6" ry="8" fill="#ffffff" />
      <ellipse cx="62" cy="51" rx="6" ry="8" fill="#ffffff" />
      <circle cx="38" cy="51" r="3.6" fill="#030712" />
      <circle cx="62" cy="51" r="3.6" fill="#030712" />
      <circle cx="36" cy="48" r="1.5" fill="#ffffff" />
      <circle cx="60" cy="48" r="1.5" fill="#ffffff" />

      {/* Hocico */}
      <polygon points="47,60 53,60 50,64" fill="#f472b6" />
      <path
        d="M 45 65 Q 50 69 50 65 Q 50 69 55 65"
        fill="none"
        stroke="#030712"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

export const StartScreen: React.FC<StartScreenProps> = ({ onStartGame }) => {
  const [name, setName] = useState<string>(() => {
    return localStorage.getItem("michi_player_name") || "Michi Alfa";
  });

  const [selectedSkin, setSelectedSkin] = useState<number>(() => {
    const saved = localStorage.getItem("michi_player_skin");
    return saved !== null ? parseInt(saved, 10) : 0;
  });

  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("michi_music_enabled");
    return saved !== null ? saved === "true" : true;
  });

  const [sfxEnabled, setSfxEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("michi_sfx_enabled");
    return saved !== null ? saved === "true" : true;
  });

  // Modals state (diep.io style shop & rules)
  const [showShopModal, setShowShopModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [partyLinkCopied, setPartyLinkCopied] = useState(false);

  useEffect(() => {
    soundManager.setMusicMuted(!musicEnabled);
    soundManager.setMuted(!sfxEnabled);
  }, [musicEnabled, sfxEnabled]);

  const handleToggleMusic = () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    localStorage.setItem("michi_music_enabled", String(next));
    soundManager.setMusicMuted(!next);
  };

  const handleToggleSfx = () => {
    const next = !sfxEnabled;
    setSfxEnabled(next);
    localStorage.setItem("michi_sfx_enabled", String(next));
    soundManager.setMuted(!next);
  };

  const cycleSkin = (dir: number) => {
    const newIdx = (selectedSkin + dir + SKINS.length) % SKINS.length;
    setSelectedSkin(newIdx);
    localStorage.setItem("michi_player_skin", String(newIdx));
    soundManager.playClick();
  };

  const handleCopyPartyLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    setPartyLinkCopied(true);
    soundManager.playClick();
    setTimeout(() => setPartyLinkCopied(false), 2000);
  };

  const handlePlay = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalName = name.trim() || "Michi Campeón";

    localStorage.setItem("michi_player_name", finalName);
    localStorage.setItem("michi_player_skin", String(selectedSkin));

    if (musicEnabled) {
      soundManager.startBGM();
    }
    soundManager.playClick();

    onStartGame({
      name: finalName,
      skin: selectedSkin,
      musicEnabled,
      sfxEnabled,
    });
  };

  const activeSkinObj = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col justify-between p-4 sm:p-6 select-none font-game">
      {/* ── 1. Fondo de Gameplay en Vivo / Video Estilo Diep.io ──── */}
      <GameplayBackground />

      {/* ── 2. Barra Superior (Diep.io Style Buttons) ─────────────── */}
      <header className="relative z-10 flex items-center justify-between w-full max-w-7xl mx-auto">
        {/* Botones Izquierda: Shop, VIP, Audio */}
        <div className="flex items-center gap-2.5">
          {/* Botón Tienda / Skins */}
          <button
            onClick={() => {
              setShowShopModal(true);
              soundManager.playClick();
            }}
            className="diep-btn-pill flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#00b2e1] text-white font-bold text-xs tracking-wide shadow-md"
          >
            <span className="text-sm">🛍️</span>
            <span>Shop & Skins</span>
          </button>

          {/* Botón Pase Felino */}
          <button
            onClick={() => {
              setShowShopModal(true);
              soundManager.playClick();
            }}
            className="diep-btn-pill hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#eab308] text-slate-950 font-black text-xs tracking-wide shadow-md"
          >
            <span>👑</span>
            <span>Pase Felino</span>
          </button>

          {/* Toggle Audio BGM */}
          <button
            onClick={handleToggleMusic}
            title={musicEnabled ? "Silenciar Música" : "Activar Música"}
            className={`diep-btn-pill flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold ${
              musicEnabled ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"
            }`}
          >
            <span>{musicEnabled ? "🎵" : "🔇"}</span>
            <span className="hidden md:inline">{musicEnabled ? "Música ON" : "Música OFF"}</span>
          </button>

          {/* Toggle SFX */}
          <button
            onClick={handleToggleSfx}
            title={sfxEnabled ? "Silenciar Efectos" : "Activar Efectos"}
            className={`diep-btn-pill flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold ${
              sfxEnabled ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-400"
            }`}
          >
            <span>{sfxEnabled ? "🔊" : "🔈"}</span>
            <span className="hidden md:inline">{sfxEnabled ? "SFX ON" : "SFX OFF"}</span>
          </button>
        </div>

        {/* Botones Derecha: Custom Games & Menú */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setShowRulesModal(true);
              soundManager.playClick();
            }}
            className="diep-btn-pill flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ec4899] text-white font-bold text-xs tracking-wide shadow-md"
          >
            <span>🎮</span>
            <span>Controles</span>
          </button>

          <div className="px-3 py-1.5 rounded-lg bg-slate-900/80 border-2 border-slate-700/80 text-emerald-400 text-xs font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="hidden sm:inline">Servidor 60Hz</span>
          </div>
        </div>
      </header>

      {/* ── 3. Panel Central Flotante Estilo Diep.io ─────────────── */}
      <main className="relative z-10 flex flex-col items-center justify-center my-auto w-full max-w-lg mx-auto space-y-4">
        
        {/* Logo Gigante Estilo Diep.io */}
        <div className="text-center relative">
          <div className="inline-block relative">
            <h1 className="diep-title text-5xl sm:text-6xl md:text-7xl font-black tracking-tight select-none flex items-center justify-center gap-1">
              <span>BATTLE</span>
              <span className="text-[#00b2e1]">CATS</span>
              <span className="text-emerald-400 text-4xl sm:text-5xl font-mono">.io</span>
            </h1>
            {/* Orejitas felinas decorativas arriba del logo */}
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-14 pointer-events-none opacity-90">
              <span className="text-2xl transform -rotate-12">🐱</span>
              <span className="text-2xl transform rotate-12">🐾</span>
            </div>
          </div>
          <p className="text-[11px] sm:text-xs font-bold tracking-widest text-slate-300 uppercase mt-1 drop-shadow-md">
            TOP-DOWN BATTLE ROYALE • MEGA-MAPA 8000x8000
          </p>
        </div>

        {/* Fila de Selectores Superiores: Game Mode & Region */}
        <div className="grid grid-cols-2 gap-2.5 w-full">
          {/* Game Mode */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-300 drop-shadow">Game Mode</span>
            <div className="diep-btn-pill flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#84cc16] text-slate-950 font-bold text-xs cursor-pointer shadow">
              <span>Battle Royale (Solo)</span>
              <span className="text-xs">▾</span>
            </div>
          </div>

          {/* Region */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-300 drop-shadow">Región / Servidor</span>
            <div className="diep-btn-pill flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-800 text-slate-100 border-slate-900 font-bold text-xs cursor-pointer shadow">
              <span className="flex items-center gap-1.5 truncate">
                <span>🌎</span>
                <span>LATAM (Local)</span>
              </span>
              <span className="text-emerald-400 text-[10px] whitespace-nowrap">🟢 14ms</span>
            </div>
          </div>
        </div>

        {/* ── Spotlight de Skin con Navegación Rápida & Grid Diep.io ── */}
        <div className="w-full diep-grid-blueprint rounded-2xl border-4 border-slate-950 p-3.5 shadow-2xl relative overflow-hidden flex flex-col items-center">
          
          {/* Badge de Rareza en esquina */}
          <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
            <span
              style={{ backgroundColor: activeSkinObj.rarityColor }}
              className="text-[10px] font-black uppercase text-slate-950 px-2 py-0.5 rounded-md shadow"
            >
              {activeSkinObj.rarity}
            </span>
            <button
              onClick={() => setShowShopModal(true)}
              className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 underline"
            >
              Armario ➔
            </button>
          </div>

          {/* Carrusel de Skin con Flechas Diep.io */}
          <div className="flex items-center justify-between w-full px-2 py-1">
            {/* Flecha Izquierda */}
            <button
              type="button"
              onClick={() => cycleSkin(-1)}
              className="diep-btn-pill w-9 h-9 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-white flex items-center justify-center font-black text-lg"
              title="Skin Anterior"
            >
              ◀
            </button>

            {/* Avatar Central en Escenario 3D */}
            <div className="flex flex-col items-center cursor-pointer" onClick={() => cycleSkin(1)}>
              <div
                style={{ filter: `drop-shadow(0 0 16px ${activeSkinObj.glow})` }}
                className="transition-transform duration-200 hover:scale-105"
              >
                <CatAvatar3D
                  colorHex={activeSkinObj.color}
                  earInnerHex={activeSkinObj.earInner}
                  size={84}
                  isSelected={true}
                />
              </div>

              <div className="text-center mt-1">
                <span className="font-black text-sm text-white tracking-wide block">
                  {activeSkinObj.name}
                </span>
                <span className="text-[11px] font-medium text-slate-300 block">
                  {activeSkinObj.title}
                </span>
              </div>
            </div>

            {/* Flecha Derecha */}
            <button
              type="button"
              onClick={() => cycleSkin(1)}
              className="diep-btn-pill w-9 h-9 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-white flex items-center justify-center font-black text-lg"
              title="Siguiente Skin"
            >
              ▶
            </button>
          </div>

          {/* Paleta rápida de 6 puntos de color para cambio con 1 click */}
          <div className="flex items-center justify-center gap-2 pt-2 border-t border-slate-700/60 w-full mt-2">
            {SKINS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelectedSkin(s.id);
                  soundManager.playClick();
                }}
                style={{ backgroundColor: s.color }}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  selectedSkin === s.id
                    ? "border-white scale-125 shadow-[0_0_10px_white]"
                    : "border-slate-900 opacity-60 hover:opacity-100"
                }`}
                title={`${s.name} (${s.rarity})`}
              />
            ))}
          </div>
        </div>

        {/* ── Input de Apodo Estilo Diep.io ───────────────────────── */}
        <form onSubmit={handlePlay} className="w-full space-y-2.5">
          <div className="relative flex items-center w-full">
            <span className="absolute left-4 text-slate-500 text-base pointer-events-none">
              🐾
            </span>
            <input
              type="text"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="This is the tale of..."
              className="w-full pl-11 pr-14 py-3.5 rounded-xl border-4 border-slate-950 bg-white text-slate-950 placeholder-slate-400 font-bold text-sm sm:text-base outline-none shadow-xl focus:ring-4 focus:ring-cyan-400/50"
            />
            <span className="absolute right-4 text-[11px] font-mono font-bold text-slate-400 pointer-events-none">
              {name.length}/16
            </span>
          </div>

          {/* Botón ¡Jugar! Icónico Diep.io */}
          <button
            type="submit"
            className="diep-btn-play w-full py-3.5 px-6 rounded-xl text-white font-black text-lg sm:text-xl tracking-wider uppercase cursor-pointer shadow-2xl flex items-center justify-center gap-2"
          >
            <span>Play!</span>
            <span>⚔️</span>
          </button>
        </form>

        {/* Botón Secundario: Copy Party Link */}
        <button
          type="button"
          onClick={handleCopyPartyLink}
          className="diep-btn-pill w-full py-2.5 px-4 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-xs tracking-wide shadow flex items-center justify-center gap-2"
        >
          <span>🔗</span>
          <span>{partyLinkCopied ? "¡Enlace Copiado al Portapapeles!" : "Copy Party Link"}</span>
        </button>

      </main>

      {/* ── 4. Pie de Página & Widgets de Esquina (Diep.io Style) ─── */}
      <footer className="relative z-10 flex items-end justify-between w-full max-w-7xl mx-auto">
        {/* Esquina Inferior Izquierda: Idioma & Reglas */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button className="diep-btn-pill px-3 py-1 rounded-md bg-slate-900 border-slate-800 text-white text-xs font-bold">
              🇪🇸 ES ▾
            </button>
            <button
              onClick={() => setShowRulesModal(true)}
              className="diep-btn-pill px-3 py-1 rounded-md bg-slate-900 border-slate-800 text-slate-200 text-xs font-bold"
            >
              📜 Reglas
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 font-medium">
            <span>WASD para mover</span>
            <span>•</span>
            <span>Mouse para apuntar y disparar</span>
            <span>•</span>
            <span>Espacio para Roll/Dash</span>
          </div>
        </div>

        {/* Esquina Inferior Derecha: Notificación de Actualización & Radar */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden md:block">
            <div className="inline-block bg-emerald-500 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider mb-0.5">
              ¡NUEVO!
            </div>
            <div className="text-xs font-bold text-slate-200">
              Mega-Mapa 8000x8000 & Edificios
            </div>
            <div className="text-[10px] text-slate-400">
              Oclusión de tejados y sigilo táctico
            </div>
          </div>

          {/* Minimapa Decorativo Diep.io */}
          <div className="w-14 h-14 rounded-lg border-2 border-cyan-400/80 bg-slate-950/80 p-1 flex items-center justify-center shadow-lg relative overflow-hidden">
            <div className="w-10 h-10 rounded-full border border-red-500/80 border-dashed animate-spin" />
            <div className="w-2 h-2 rounded-full bg-emerald-400 absolute" />
          </div>
        </div>
      </footer>

      {/* ── 5. Modal de Tienda / Armario de Skins Estilo Diep.io ───── */}
      {showShopModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-slate-900 border-4 border-slate-950 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header del Modal */}
            <div className="bg-slate-950 p-4 flex items-center justify-between border-b-2 border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xl">🛍️</span>
                <span className="font-black text-lg tracking-wider text-white uppercase">
                  Armario de Skins Felinas
                </span>
              </div>
              <button
                onClick={() => setShowShopModal(false)}
                className="diep-btn-pill w-8 h-8 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            {/* Grid de Skins */}
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Selecciona tu Michi de Combate
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {SKINS.map((skin) => {
                  const isSelected = selectedSkin === skin.id;
                  return (
                    <div
                      key={skin.id}
                      onClick={() => {
                        setSelectedSkin(skin.id);
                        soundManager.playClick();
                      }}
                      className={`diep-grid-blueprint relative rounded-xl border-3 transition-all cursor-pointer p-3 flex flex-col items-center justify-between h-56 ${
                        isSelected
                          ? "border-emerald-400 ring-2 ring-emerald-400/50 scale-[1.02]"
                          : "border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      {/* Badge superior */}
                      <div className="w-full flex items-center justify-between">
                        <span
                          style={{ backgroundColor: skin.rarityColor }}
                          className="text-[9px] font-black uppercase text-slate-950 px-2 py-0.5 rounded shadow"
                        >
                          {skin.rarity}
                        </span>
                        {skin.discount && (
                          <span className="text-[10px] font-black text-red-400 bg-red-950/80 px-1.5 py-0.5 rounded border border-red-500/40">
                            {skin.discount}
                          </span>
                        )}
                      </div>

                      {/* Avatar 3D */}
                      <div className="py-2">
                        <CatAvatar3D
                          colorHex={skin.color}
                          earInnerHex={skin.earInner}
                          size={78}
                          isSelected={isSelected}
                        />
                      </div>

                      {/* Info y Botón Equipar */}
                      <div className="w-full space-y-2 text-center">
                        <div>
                          <div className="font-black text-sm text-white">{skin.name}</div>
                          <div className="text-[10px] text-slate-300 truncate">{skin.title}</div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSkin(skin.id);
                            soundManager.playClick();
                          }}
                          className={`w-full py-1.5 rounded-lg font-black text-xs uppercase tracking-wider transition-all ${
                            isSelected
                              ? "bg-emerald-500 text-slate-950 shadow"
                              : "diep-btn-pill bg-[#00b2e1] text-white"
                          }`}
                        >
                          {isSelected ? "Equipado ✓" : "Equipar"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Modal */}
            <div className="bg-slate-950 p-3.5 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Skin activa: <b className="text-white">{activeSkinObj.name}</b> ({activeSkinObj.title})
              </span>
              <button
                onClick={() => setShowShopModal(false)}
                className="diep-btn-pill px-5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-xs uppercase"
              >
                Listo
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── 6. Modal de Reglas y Controles ───────────────────────── */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border-4 border-slate-950 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <span className="font-black text-base text-white uppercase tracking-wider">
                  Guía de Combate Felino
                </span>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="diep-btn-pill w-8 h-8 rounded-lg bg-red-600 text-white font-black text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                <span className="font-black text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded">WASD</span>
                <div>
                  <b className="text-white">Movimiento Ágil:</b> Desplázate por el mapa de 8000x8000. Cruzar el río reduce la velocidad un 25% salvo en los puentes.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                <span className="font-black text-cyan-400 bg-cyan-950/60 px-2 py-1 rounded">MOUSE</span>
                <div>
                  <b className="text-white">Apuntar y Disparar:</b> Click izquierdo para disparar armas. Las balas tienen retroceso táctico de retroceso.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                <span className="font-black text-amber-400 bg-amber-950/60 px-2 py-1 rounded">ESPACIO</span>
                <div>
                  <b className="text-white">Roll Acrobático / Dash:</b> Rueda 120px con armas de fuego o haz un Dash veloz de 160px con garras.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                <span className="font-black text-purple-400 bg-purple-950/60 px-2 py-1 rounded">F / R</span>
                <div>
                  <b className="text-white">Recoger & Recargar:</b> Pulsa F sobre botín para equipar armas. Pulsa R para recargar munición.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                <span className="font-black text-rose-400 bg-rose-950/60 px-2 py-1 rounded">🏠 SIGILO</span>
                <div>
                  <b className="text-white">Edificios Tácticos:</b> Entra a casas, búnkeres o almacenes. El techo se desvanece para ti y te oculta de los enemigos exteriores.
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowRulesModal(false)}
              className="diep-btn-play w-full py-2.5 rounded-xl text-white font-black text-sm uppercase"
            >
              ¡Entendido, a Luchar!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
