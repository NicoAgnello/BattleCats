import React, { useState, useEffect } from "react";
import { soundManager } from "../game/SoundManager";

export interface PlayerConfig {
  name: string;
  skin: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

interface StartScreenProps {
  onStartGame: (config: PlayerConfig) => void;
}

export const SKINS = [
  { id: 0, name: "Esmeralda", title: "Battle Cat Táctico", color: "#10b981", earInner: "#f472b6", modelColor: "emerald", border: "border-emerald-500", glow: "rgba(16, 185, 129, 0.4)" },
  { id: 1, name: "Carmesí", title: "Ninja Sangriento", color: "#ef4444", earInner: "#f43f5e", modelColor: "crimson", border: "border-red-500", glow: "rgba(239, 68, 68, 0.4)" },
  { id: 2, name: "Violeta", title: "Sombra Real", color: "#8b5cf6", earInner: "#f472b6", modelColor: "violet", border: "border-purple-500", glow: "rgba(139, 92, 246, 0.4)" },
  { id: 3, name: "Garfield", title: "Michi Fuego", color: "#f97316", earInner: "#fb7185", modelColor: "orange", border: "border-orange-500", glow: "rgba(249, 115, 22, 0.4)" },
  { id: 4, name: "Neón", title: "Ciber Azul", color: "#06b6d4", earInner: "#f472b6", modelColor: "azure", border: "border-cyan-500", glow: "rgba(6, 182, 212, 0.4)" },
  { id: 5, name: "Leyenda", title: "Gato Dorado", color: "#eab308", earInner: "#f43f5e", modelColor: "gold", border: "border-yellow-500", glow: "rgba(234, 179, 8, 0.4)" },
];

// Google Web Model 3D Avatar Preview (Renderizado 3D / SVG estilizado M3)
const CatAvatar3D: React.FC<{ colorHex: string; earInnerHex: string; isSelected?: boolean }> = ({
  colorHex,
  earInnerHex,
  isSelected,
}) => (
  <div className="relative w-20 h-20 flex items-center justify-center perspective-1000">
    <svg viewBox="0 0 100 100" className={`w-20 h-20 drop-shadow-2xl transition-all duration-300 ${isSelected ? "animate-float-3d scale-110" : "group-hover:scale-105"}`}>
      <defs>
        <radialGradient id={`grad-${colorHex.replace("#", "")}`} cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="40%" stopColor={colorHex} />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>

      {/* Halo de luz 3D de Google Model 3 */}
      {isSelected && (
        <circle cx="50" cy="50" r="48" fill={colorHex} opacity="0.3" className="animate-pulse" />
      )}
      
      {/* Sombra proyectada */}
      <ellipse cx="50" cy="90" rx="30" ry="6" fill="#000000" opacity="0.4" />

      {/* Oreja Izquierda 3D */}
      <polygon points="25,45 12,12 45,28" fill={`url(#grad-${colorHex.replace("#", "")})`} stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="26,42 16,18 40,30" fill={earInnerHex} />

      {/* Oreja Derecha 3D */}
      <polygon points="75,45 88,12 55,28" fill={`url(#grad-${colorHex.replace("#", "")})`} stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="74,42 84,18 60,30" fill={earInnerHex} />

      {/* Esfera de Cabeza Principal Google Web Model 3 */}
      <circle cx="50" cy="55" r="32" fill={`url(#grad-${colorHex.replace("#", "")})`} stroke="#ffffff" strokeWidth="3" />

      {/* Ojos y Expresión */}
      <ellipse cx="37" cy="50" rx="6.5" ry="8.5" fill="#ffffff" />
      <ellipse cx="63" cy="50" rx="6.5" ry="8.5" fill="#ffffff" />
      <circle cx="37" cy="50" r="3.8" fill="#030712" />
      <circle cx="63" cy="50" r="3.8" fill="#030712" />
      <circle cx="35" cy="47" r="1.6" fill="#ffffff" />
      <circle cx="61" cy="47" r="1.6" fill="#ffffff" />

      {/* Hocico Felino M3 */}
      <polygon points="47,60 53,60 50,64" fill="#f472b6" />
      <path d="M 45 66 Q 50 70 50 66 Q 50 70 55 66" fill="none" stroke="#030712" strokeWidth="2.2" strokeLinecap="round" />
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

  const handlePlay = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || "Michi Campeón";

    localStorage.setItem("michi_player_name", finalName);
    localStorage.setItem("michi_player_skin", String(selectedSkin));

    if (musicEnabled) {
      soundManager.startBGM();
    }

    onStartGame({
      name: finalName,
      skin: selectedSkin,
      musicEnabled,
      sfxEnabled,
    });
  };

  const activeSkinObj = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];

  return (
    <div className="relative w-screen h-screen overflow-y-auto bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6 font-m3 select-none">
      {/* Fondo Neón Cyberpunk con M3 Lighting Stage */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-950/40 via-slate-950 to-slate-950 pointer-events-none" />
      <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#334155_1px,transparent_1px),linear-gradient(to_bottom,#334155_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] pointer-events-none" />

      {/* Contenedor M3 Glass Card */}
      <div className="relative w-full max-w-2xl m3-card p-6 sm:p-8 space-y-6 z-10 border border-slate-700/50 shadow-2xl">
        
        {/* Encabezado con Tipografía Google Fonts Orbitron & Material Symbols 3 */}
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold font-orbitron uppercase tracking-widest shadow-inner">
            <span className="material-symbols-outlined text-sm text-emerald-400">auto_awesome</span>
            Google Web Model 3 UI System
          </div>
          
          <h1 className="text-3xl sm:text-4xl font-black font-orbitron tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 drop-shadow-lg">
            BATTLE CATS JUNGLE 🐾
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-medium">
            Selecciona tu modelo de personaje 3D y configura tu apodo online
          </p>
        </div>

        <form onSubmit={handlePlay} className="space-y-6">

          {/* 1. Campo de Nombre (Material 3 Input) */}
          <div className="space-y-2">
            <label className="text-xs font-bold font-orbitron text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-400 text-base">person</span>
              Tu Apodo Online
            </label>
            <div className="relative">
              <input
                type="text"
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ingresa tu apodo..."
                className="w-full m3-input px-4 py-3.5 text-sm font-bold text-slate-100 placeholder-slate-600 font-m3"
              />
              <span className="absolute right-4 top-3.5 text-[11px] font-mono font-bold text-slate-500">
                {name.length}/16
              </span>
            </div>
          </div>

          {/* 2. Selector de Skin Felina (Google Web Model 3 Stage) */}
          <div className="space-y-3">
            <label className="text-xs font-bold font-orbitron text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-base">shield_cat</span>
                Modelos de Personajes 3D
              </span>
              <span className="text-xs font-orbitron font-bold text-emerald-400">
                {activeSkinObj.name} • {activeSkinObj.title}
              </span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              {SKINS.map((skin) => {
                const isSelected = selectedSkin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    onClick={() => setSelectedSkin(skin.id)}
                    style={{
                      boxShadow: isSelected ? `0 12px 30px ${skin.glow}` : "none",
                    }}
                    className={`group relative flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all duration-300 m3-card-interactive ${
                      isSelected
                        ? `bg-slate-950/90 border-2 ${skin.border} ring-2 ring-${skin.color}/40 scale-[1.03]`
                        : "bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60"
                    }`}
                  >
                    {/* Badge M3 de Selección */}
                    {isSelected && (
                      <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg">
                        <span className="material-symbols-outlined text-sm font-black">check</span>
                      </div>
                    )}

                    {/* Previsualización Google Web Model 3D */}
                    <CatAvatar3D
                      colorHex={skin.color}
                      earInnerHex={skin.earInner}
                      isSelected={isSelected}
                    />

                    <div className="mt-2 space-y-0.5 text-center">
                      <span className="text-xs font-black font-orbitron block text-slate-100">
                        {skin.name}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400 block truncate max-w-[110px]">
                        {skin.title}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Panel M3 de Sonido y Música */}
          <div className="grid grid-cols-2 gap-3.5 pt-1">
            {/* Toggle Música */}
            <button
              type="button"
              onClick={handleToggleMusic}
              className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                musicEnabled
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-md"
                  : "bg-slate-950/50 border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-lg">music_note</span>
                <div className="text-left font-m3">
                  <div className="text-xs font-bold">Música BGM</div>
                  <div className="text-[10px] opacity-75">{musicEnabled ? "Activada" : "Desactivada"}</div>
                </div>
              </div>
              <div className={`w-9 h-5 rounded-full relative transition-colors ${musicEnabled ? "bg-emerald-500" : "bg-slate-700"}`}>
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${musicEnabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </div>
            </button>

            {/* Toggle SFX */}
            <button
              type="button"
              onClick={handleToggleSfx}
              className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                sfxEnabled
                  ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-md"
                  : "bg-slate-950/50 border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-lg">{sfxEnabled ? "volume_up" : "volume_off"}</span>
                <div className="text-left font-m3">
                  <div className="text-xs font-bold">Efectos SFX</div>
                  <div className="text-[10px] opacity-75">{sfxEnabled ? "Activados" : "Desactivados"}</div>
                </div>
              </div>
              <div className={`w-9 h-5 rounded-full relative transition-colors ${sfxEnabled ? "bg-cyan-500" : "bg-slate-700"}`}>
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${sfxEnabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </div>
            </button>
          </div>

          {/* 4. Botón M3 de Acción Principal ¡ENTRAR AL COMBATE! */}
          <button
            type="submit"
            className="w-full py-4 px-6 m3-button-primary text-sm tracking-widest uppercase flex items-center justify-center gap-3 cursor-pointer group"
          >
            <span className="material-symbols-outlined text-xl group-hover:rotate-12 transition-transform">sports_esports</span>
            ¡ENTRAR AL COMBATE!
          </button>
        </form>

        {/* Pie de página con tipografía M3 */}
        <div className="text-center pt-2 border-t border-slate-800/80">
          <p className="text-[11px] text-slate-400 font-medium">
            Controles: <b className="text-slate-200">WASD</b> mover • <b className="text-slate-200">Mouse</b> apuntar y disparar • <b className="text-slate-200">Espacio</b> dash felino
          </p>
        </div>

      </div>
    </div>
  );
};
