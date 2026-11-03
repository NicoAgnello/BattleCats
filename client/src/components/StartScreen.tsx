import React, { useState, useEffect } from "react";
import { soundManager } from "../game/SoundManager";
import { getMoveMode, setMoveMode, MOVE_MODE_LABEL, type MoveMode } from "../game/controls";
import { GameplayBackground } from "./GameplayBackground";
import { PixelPortrait } from "./PixelPortrait";
import { SERVER_HTTP } from "../game/serverUrl";

export interface PlayerConfig {
  name: string;
  skin: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  isCustom?: boolean;
  roomCode?: string;
  isHost?: boolean;
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
  portrait: string;   // retrato pixel art animado (public/sprites/<portrait>.png)
}

// El índice (id) es el número de skin que usa el juego: coincide con el orden
// de "cats" y "portraits" en public/sprites/manifest.json (ver /sprites).
export const SKINS: SkinItem[] = [
  {
    id: 0,
    name: "Sargento",
    title: "Líder de escuadrón veterano",
    rarity: "Legendaria",
    rarityColor: "#eab308",
    color: "#e07a2e",
    earInner: "#f472b6",
    glow: "rgba(224, 122, 46, 0.5)",
    portrait: "retrato-sargento",
  },
  {
    id: 1,
    name: "Ceniza",
    title: "Francotirador melancólico",
    rarity: "Épica",
    rarityColor: "#8b5cf6",
    color: "#7c8292",
    earInner: "#f472b6",
    glow: "rgba(124, 130, 146, 0.5)",
    portrait: "retrato-ceniza",
  },
  {
    id: 2,
    name: "Sombra",
    title: "Comando de jungla",
    rarity: "Épica",
    rarityColor: "#8b5cf6",
    color: "#4a4656",
    earInner: "#f472b6",
    discount: "-25%",
    glow: "rgba(234, 179, 8, 0.4)",
    portrait: "retrato-sombra",
  },
  {
    id: 3,
    name: "Duna",
    title: "Piloto del desierto",
    rarity: "Rara",
    rarityColor: "#06b6d4",
    color: "#ead8a4",
    earInner: "#f472b6",
    glow: "rgba(234, 216, 164, 0.5)",
    portrait: "retrato-duna",
  },
  {
    id: 4,
    name: "Copito",
    title: "El novato del equipo",
    rarity: "Común",
    rarityColor: "#10b981",
    color: "#e6ddd0",
    earInner: "#f472b6",
    glow: "rgba(93, 155, 230, 0.5)",
    portrait: "retrato-copito",
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
    const n = saved !== null ? parseInt(saved, 10) : 0;
    return Number.isInteger(n) && n >= 0 && n < SKINS.length ? n : 0;
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
  const [moveMode, setMoveModeState] = useState<MoveMode>(getMoveMode);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [partyLinkCopied, setPartyLinkCopied] = useState(false);

  // Modo de Juego: CLASSIC (con bots) vs CUSTOM (sala privada sin bots)
  // La sala privada es el modo principal (jugar con amigos en la red); la partida
  // rápida con bots queda como segunda opción
  const [gameMode, setGameMode] = useState<"CLASSIC" | "CUSTOM">("CUSTOM");
  const [customTab, setCustomTab] = useState<"CREATE" | "JOIN">("CREATE");
  const [generatedCode, setGeneratedCode] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [joinCode, setJoinCode] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [checkingRoom, setCheckingRoom] = useState(false);

  useEffect(() => {
    soundManager.setMusicMuted(!musicEnabled);
    soundManager.setMuted(!sfxEnabled);
  }, [musicEnabled, sfxEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam && /^\d{4}$/.test(roomParam)) {
      setGameMode("CUSTOM");
      setCustomTab("JOIN");
      setJoinCode(roomParam);
    }
  }, []);

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

  const regenerateCode = () => {
    const newCode = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedCode(newCode);
    soundManager.playClick();
  };

  const handleCopyPartyLink = () => {
    let link = window.location.origin;
    if (gameMode === "CUSTOM") {
      const code = customTab === "CREATE" ? generatedCode : (joinCode.trim() || generatedCode);
      link += `/?room=${code}`;
    }
    navigator.clipboard.writeText(link);
    setPartyLinkCopied(true);
    soundManager.playClick();
    setTimeout(() => setPartyLinkCopied(false), 2000);
  };

  const handlePlayClassic = (e?: React.FormEvent) => {
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
      isCustom: false,
    });
  };

  const handleCreateRoom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalName = name.trim() || "Michi Anfitrión";

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
      isCustom: true,
      roomCode: generatedCode,
      isHost: true,
    });
  };

  const handleJoinRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = joinCode.trim();
    if (!/^\d{4}$/.test(cleanCode)) {
      setRoomError("El código debe tener exactamente 4 números (ej. 4582).");
      return;
    }
    setRoomError(null);
    setCheckingRoom(true);

    try {
      const res = await fetch(`${SERVER_HTTP}/api/room/${cleanCode}`);
      const data = await res.json();
      if (!data.exists) {
        setRoomError(`No se encontró ninguna sala con el código "${cleanCode}".`);
        setCheckingRoom(false);
        return;
      }
      if (data.status && data.status !== "WAITING") {
        setRoomError(`La partida de la sala "${cleanCode}" ya empezó. Pedile al anfitrión que cree una sala nueva.`);
        setCheckingRoom(false);
        return;
      }
      if (data.clients >= (data.maxClients || 20)) {
        setRoomError(`La sala "${cleanCode}" está llena (límite de 20 jugadores alcanzado).`);
        setCheckingRoom(false);
        return;
      }
    } catch {
      // Ignorar si la llamada fetch falla y permitir el intento de conexión directa
    }

    setCheckingRoom(false);
    const finalName = name.trim() || "Michi Invitado";

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
      isCustom: true,
      roomCode: cleanCode,
      isHost: false,
    });
  };

  const activeSkinObj = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];

  return (
    <div className="hud relative w-screen h-screen overflow-x-hidden overflow-y-auto flex flex-col gap-4 p-4 sm:p-6 select-none">
      <GameplayBackground />

      {/* ── Barra superior: armario, controles y sonido ── */}
      <header className="relative z-10 flex flex-wrap items-center justify-end gap-3 w-full max-w-5xl mx-auto">
        <button
          onClick={() => { setShowShopModal(true); soundManager.playClick(); }}
          className="hud-chip h-[30px] px-3 text-[14px] cursor-pointer"
        >
          Armario
        </button>
        <button
          onClick={() => { setShowRulesModal(true); soundManager.playClick(); }}
          className="hud-chip h-[30px] px-3 text-[14px] cursor-pointer"
        >
          Controles
        </button>
        <button
          onClick={() => {
            const next: MoveMode = moveMode === "AIM" ? "CLASSIC" : "AIM";
            setMoveMode(next);
            setMoveModeState(next);
            soundManager.playClick();
          }}
          className="hud-chip h-[30px] px-3 text-[14px] cursor-pointer"
          title="Clásico: W va hacia arriba de la pantalla. Hacia la mira: W avanza hacia el mouse y A/D se mueven de costado."
        >
          Movimiento: <span style={{ color: "var(--hud-gold)" }}>{MOVE_MODE_LABEL[moveMode]}</span>
        </button>
        <button
          onClick={handleToggleMusic}
          aria-pressed={musicEnabled}
          className="hud-chip h-[30px] px-3 text-[14px] cursor-pointer"
          style={{ color: musicEnabled ? "#6ee7b7" : "var(--hud-dim)" }}
        >
          Música {musicEnabled ? "sí" : "no"}
        </button>
        <button
          onClick={handleToggleSfx}
          aria-pressed={sfxEnabled}
          className="hud-chip h-[30px] px-3 text-[14px] cursor-pointer"
          style={{ color: sfxEnabled ? "#6ee7b7" : "var(--hud-dim)" }}
        >
          Efectos {sfxEnabled ? "sí" : "no"}
        </button>
      </header>

      {/* ── Dos columnas en pantallas anchas: personaje | cómo jugar. Una sola en el celular ── */}
      <main className="relative z-10 my-auto w-full max-w-5xl mx-auto grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center">

        {/* Izquierda: logo y personaje */}
        <section className="flex flex-col items-center gap-6">
          <div className="text-center">
            <h1 className="diep-title text-5xl sm:text-6xl xl:text-7xl flex items-center justify-center gap-1">
              <span>BATTLE</span>
              <span className="text-[#00b2e1]">CATS</span>
            </h1>
            <p className="text-[15px] mt-3" style={{ color: "var(--hud-dim)" }}>
              Battle royale de gatos para jugar con amigos en la red.
            </p>
          </div>

          <div className="diep-grid-blueprint w-full max-w-md px-4 pt-4 pb-3 flex flex-col items-center gap-3">
            <div className="flex items-center justify-between w-full">
              <span
                style={{ backgroundColor: activeSkinObj.rarityColor }}
                className="text-[13px] text-slate-950 px-2 py-0.5"
              >
                {activeSkinObj.rarity}
              </span>
              <button
                onClick={() => setShowShopModal(true)}
                className="text-[14px] underline cursor-pointer"
                style={{ color: "var(--hud-shield)" }}
              >
                Ver todos
              </button>
            </div>

            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => cycleSkin(-1)}
                className="hud-chip w-10 h-10 justify-center text-[18px] cursor-pointer"
                aria-label="Personaje anterior"
              >
                ◀
              </button>

              <button type="button" className="flex flex-col items-center cursor-pointer" onClick={() => cycleSkin(1)} aria-label="Siguiente personaje">
                <div className="lg:hidden">
                  <PixelPortrait
                    name={activeSkinObj.portrait}
                    scale={2}
                    fallback={<CatAvatar3D colorHex={activeSkinObj.color} earInnerHex={activeSkinObj.earInner} size={84} isSelected={true} />}
                  />
                </div>
                <div className="hidden lg:block">
                  <PixelPortrait
                    name={activeSkinObj.portrait}
                    scale={3}
                    fallback={<CatAvatar3D colorHex={activeSkinObj.color} earInnerHex={activeSkinObj.earInner} size={120} isSelected={true} />}
                  />
                </div>
              </button>

              <button
                type="button"
                onClick={() => cycleSkin(1)}
                className="hud-chip w-10 h-10 justify-center text-[18px] cursor-pointer"
                aria-label="Personaje siguiente"
              >
                ▶
              </button>
            </div>

            <div className="text-center">
              <span className="text-[20px] block leading-tight">{activeSkinObj.name}</span>
              <span className="text-[14px] block" style={{ color: "var(--hud-dim)" }}>{activeSkinObj.title}</span>
            </div>

            <div className="flex items-center justify-center gap-2.5 pt-1">
              {SKINS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedSkin(s.id);
                    soundManager.playClick();
                  }}
                  style={{
                    backgroundColor: s.color,
                    boxShadow: selectedSkin === s.id
                      ? "0 0 0 2px var(--hud-ink), 0 0 0 4px var(--hud-gold)"
                      : "0 0 0 2px var(--hud-ink)",
                    opacity: selectedSkin === s.id ? 1 : 0.6,
                  }}
                  className="w-4 h-4 cursor-pointer hover:opacity-100"
                  title={`${s.name} (${s.rarity})`}
                  aria-label={s.name}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Derecha: nombre, modo y arranque */}
        <form
          onSubmit={
            gameMode === "CLASSIC"
              ? handlePlayClassic
              : customTab === "CREATE"
              ? handleCreateRoom
              : handleJoinRoom
          }
          className="flex flex-col gap-4 w-full max-w-md mx-auto"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px]" style={{ color: "var(--hud-dim)" }}>Tu nombre</span>
            <div className="relative">
              <input
                type="text"
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Michi Alfa"
                className="w-full h-[44px] pl-3 pr-14 text-[17px] outline-none"
                style={{ background: "#120e18", color: "var(--hud-text)", boxShadow: "0 0 0 2px var(--hud-ink), inset 0 2px 0 var(--hud-shade), 0 0 0 4px var(--hud-bevel)" }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] pointer-events-none" style={{ color: "var(--hud-dim)" }}>
                {name.length}/16
              </span>
            </div>
          </label>

          {/* Modo: sala privada (principal) o partida rápida con bots */}
          <div className="hud-panel p-2 flex items-center gap-2">
            {([
              { id: "CUSTOM", label: "Sala privada", sub: "con amigos" },
              { id: "CLASSIC", label: "Partida rápida", sub: "con bots" },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setGameMode(m.id);
                  soundManager.playClick();
                  setRoomError(null);
                }}
                aria-pressed={gameMode === m.id}
                className="flex-1 py-2 px-3 flex flex-col items-center cursor-pointer"
                style={gameMode === m.id
                  ? { background: m.id === "CUSTOM" ? "#10b981" : "#0ea5e9", color: "var(--hud-ink)", boxShadow: "inset 0 2px 0 rgba(255,255,255,0.35)" }
                  : { color: "var(--hud-dim)" }}
              >
                <span className="text-[16px] leading-tight">{m.label}</span>
                <span className="text-[13px] leading-tight opacity-80">{m.sub}</span>
              </button>
            ))}
          </div>

          {gameMode === "CUSTOM" && (
            <div className="hud-panel flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                {([
                  { id: "CREATE", label: "Crear sala" },
                  { id: "JOIN", label: "Unirme con código" },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setCustomTab(tab.id);
                      soundManager.playClick();
                      setRoomError(null);
                    }}
                    aria-pressed={customTab === tab.id}
                    className="hud-chip flex-1 justify-center h-[30px] text-[14px] cursor-pointer"
                    style={customTab === tab.id
                      ? { color: "var(--hud-gold)", boxShadow: "0 0 0 2px var(--hud-ink), inset 0 0 0 2px var(--hud-gold)" }
                      : { color: "var(--hud-dim)" }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {customTab === "CREATE" ? (
                <div className="flex items-center justify-between px-3 py-2" style={{ background: "#120e18", boxShadow: "0 0 0 2px var(--hud-ink)" }}>
                  <div className="flex flex-col">
                    <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Código de tu sala</span>
                    <span className="room-code text-[28px] leading-tight" style={{ color: "var(--hud-gold)" }}>{generatedCode}</span>
                  </div>
                  <button
                    type="button"
                    onClick={regenerateCode}
                    className="hud-chip h-[30px] cursor-pointer"
                    title="Generar otro código de 4 números"
                  >
                    Otro código
                  </button>
                </div>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px]" style={{ color: "var(--hud-dim)" }}>Código de 4 números que te pasaron</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                      setRoomError(null);
                    }}
                    placeholder="4582"
                    className="room-code w-full h-[48px] text-center text-[28px] outline-none"
                    style={{ background: "#120e18", color: "var(--hud-gold)", boxShadow: "0 0 0 2px var(--hud-ink), inset 0 2px 0 var(--hud-shade)" }}
                  />
                </label>
              )}

              <p className="text-[13px] text-center" style={{ color: "var(--hud-dim)" }}>
                Hasta 20 jugadores, sin bots. {customTab === "CREATE" ? "Arrancás la partida cuando quieras." : "Arranca cuando el anfitrión quiera."}
              </p>

              {roomError && (
                <p role="alert" className="text-[14px] text-center px-3 py-2" style={{ color: "#fca5a5", background: "#3a1218", boxShadow: "0 0 0 2px var(--hud-ink)" }}>
                  {roomError}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={checkingRoom}
            className={`w-full h-[60px] px-6 cursor-pointer flex items-center justify-center gap-2 ${
              gameMode === "CUSTOM" && customTab === "CREATE" ? "hud-btn" : "hud-btn hud-btn-blue"
            } !text-[22px]`}
          >
            {checkingRoom
              ? "Conectando…"
              : gameMode === "CLASSIC"
              ? "Jugar"
              : customTab === "CREATE"
              ? <>Crear sala <span className="room-code">{generatedCode}</span></>
              : "Unirme a la sala"}
          </button>

          {gameMode === "CUSTOM" && (
            <button
              type="button"
              onClick={handleCopyPartyLink}
              className="hud-chip w-full justify-center h-[34px] text-[14px] cursor-pointer"
            >
              {partyLinkCopied ? "Enlace copiado" : "Copiar enlace para invitar"}
            </button>
          )}
        </form>
      </main>

      {/* ── Pie: lo básico para jugar ── */}
      <footer className="relative z-10 hidden sm:flex flex-wrap items-center justify-center gap-5 w-full max-w-5xl mx-auto text-[13px]" style={{ color: "var(--hud-dim)" }}>
        <span className="flex items-center gap-1.5"><span className="hud-key">WASD</span> Moverse</span>
        <span className="flex items-center gap-1.5"><span className="hud-key">Mouse</span> Apuntar y disparar</span>
        <span className="flex items-center gap-1.5"><span className="hud-key">Espacio</span> Dash</span>
        <span className="flex items-center gap-1.5"><span className="hud-key">F</span> Agarrar</span>
      </footer>

      {/* ── 5. Modal de Tienda / Armario de Skins Estilo Diep.io ───── */}
      {showShopModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4">
          <div className="hud-panel relative w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header del Modal */}
            <div className="bg-slate-950 p-4 flex items-center justify-between border-b-2 border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xl">🛍️</span>
                <span className="font-black text-lg text-white ">
                  Armario de Skins Felinas
                </span>
              </div>
              <button
                onClick={() => setShowShopModal(false)}
                className="diep-btn-pill w-8 h-8 bg-red-600 hover:bg-red-500 text-white font-black flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            {/* Grid de Skins */}
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="text-[13px] font-bold text-slate-400  ">
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
                      className={`diep-grid-blueprint relative border-3 transition-all cursor-pointer p-3 flex flex-col items-center justify-between ${
                        isSelected
                          ? "border-emerald-400 ring-2 ring-emerald-400/50 scale-[1.02]"
                          : "border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      {/* Badge superior */}
                      <div className="w-full flex items-center justify-between">
                        <span
                          style={{ backgroundColor: skin.rarityColor }}
                          className="text-[12px] font-black text-slate-950 px-2 py-0.5  "
                        >
                          {skin.rarity}
                        </span>
                        {skin.discount && (
                          <span className="text-[12px] font-black text-red-400 bg-red-950/80 px-1.5 py-0.5 border border-red-500/40">
                            {skin.discount}
                          </span>
                        )}
                      </div>

                      {/* Avatar 3D */}
                      <div className="py-2">
                        <PixelPortrait
                          name={skin.portrait}
                          scale={2}
                          fallback={
                            <CatAvatar3D
                              colorHex={skin.color}
                              earInnerHex={skin.earInner}
                              size={78}
                              isSelected={isSelected}
                            />
                          }
                        />
                      </div>

                      {/* Info y Botón Equipar */}
                      <div className="w-full space-y-2 text-center">
                        <div>
                          <div className="font-black text-sm text-white">{skin.name}</div>
                          <div className="text-[12px] text-slate-300 truncate">{skin.title}</div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSkin(skin.id);
                            soundManager.playClick();
                          }}
                          className={`w-full py-1.5 font-black text-[13px] transition-all ${
                            isSelected
                              ? "bg-emerald-500 text-slate-950 "
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
              <span className="text-[13px] text-slate-400">
                Skin activa: <b className="text-white">{activeSkinObj.name}</b> ({activeSkinObj.title})
              </span>
              <button
                onClick={() => setShowShopModal(false)}
                className="diep-btn-pill px-5 py-1.5 bg-emerald-500 text-slate-950 font-black text-[13px] "
              >
                Listo
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── 6. Modal de Reglas y Controles ───────────────────────── */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4">
          <div className="hud-panel relative w-full max-w-lg overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <span className="font-black text-base text-white  ">
                  Guía de Combate Felino
                </span>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="diep-btn-pill w-8 h-8 bg-red-600 text-white font-black text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[13px] text-slate-300">
              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-emerald-400 bg-emerald-950/60 px-2 py-1 ">WASD</span>
                <div>
                  <b className="text-white">Movimiento Ágil:</b> Desplázate por el mapa de 8000x8000. Cruzar el río reduce la velocidad un 25% salvo en los puentes.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-amber-400 bg-amber-950/60 px-2 py-1 whitespace-nowrap">2 MODOS</span>
                <div>
                  <b className="text-white">Cómo se mueve:</b> en <b>clásico</b>, W va siempre hacia arriba de la pantalla. En <b>hacia la mira</b>, W avanza hacia donde apunta el mouse, S retrocede y A/D se mueven de costado. Se cambia con el botón "Movimiento" del menú o de la partida.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-cyan-400 bg-cyan-950/60 px-2 py-1 ">MOUSE</span>
                <div>
                  <b className="text-white">Apuntar y Disparar:</b> Click izquierdo para disparar armas. Las balas tienen retroceso táctico de retroceso.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-amber-400 bg-amber-950/60 px-2 py-1 ">ESPACIO</span>
                <div>
                  <b className="text-white">Roll Acrobático / Dash:</b> Rueda 120px con armas de fuego o haz un Dash veloz de 160px con garras.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-purple-400 bg-purple-950/60 px-2 py-1 ">F / R</span>
                <div>
                  <b className="text-white">Recoger & Recargar:</b> Pulsa F sobre botín para equipar armas. Pulsa R para recargar munición.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-black text-rose-400 bg-rose-950/60 px-2 py-1 ">🏠 SIGILO</span>
                <div>
                  <b className="text-white">Edificios Tácticos:</b> Entra a casas, búnkeres o almacenes. El techo se desvanece para ti y te oculta de los enemigos exteriores.
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowRulesModal(false)}
              className="diep-btn-play w-full py-2.5 text-white font-black text-sm "
            >
              ¡Entendido, a Luchar!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
