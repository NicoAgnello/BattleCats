import React, { useState, useEffect, useCallback } from "react";
import { WifiOff } from "lucide-react";
import { soundManager } from "../game/SoundManager";
import { PlayerConfig } from "./StartScreen";

interface LoadingScreenProps {
  playerConfig: PlayerConfig;
  onExit: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ playerConfig, onExit }) => {
  const [conn, setConn] = useState("CONNECTING");
  // Una vez dentro de la partida no se vuelve a tapar la pantalla: si después se cae
  // la conexión, eso lo informa el badge del HUD y no esta pantalla.
  const [joined, setJoined] = useState(false);

  const onConn = useCallback((e: Event) => {
    const next = (e as CustomEvent).detail;
    setConn(next);
    if (next === "CONNECTED") setJoined(true);
  }, []);

  useEffect(() => {
    window.addEventListener("conn-update", onConn);
    return () => window.removeEventListener("conn-update", onConn);
  }, [onConn]);

  if (joined) return null;

  const failed = conn === "ERROR";

  const salaLabel = playerConfig.isCustom
    ? `Sala privada #${playerConfig.roomCode ?? "????"}`
    : "Partida rápida";

  const titulo = failed
    ? "No se pudo entrar a la sala"
    : playerConfig.isCustom && playerConfig.isHost
      ? "Creando la sala…"
      : "Entrando a la sala…";

  const subtitulo = failed
    ? playerConfig.isCustom
      ? "Puede que el código sea incorrecto, que la sala ya no exista o que el servidor no esté disponible."
      : "El servidor no responde. Revisá que esté levantado e intentá de nuevo."
    : "Generando la jungla y conectando con el servidor.";

  const handleExit = () => {
    soundManager.playClick();
    onExit();
  };

  return (
    <div className="hud fixed inset-0 z-50 flex items-center justify-center select-none" style={{ background: "#0b0810" }}>
      {/* Fondo opaco y sin blur a propósito: recomponer cada frame mientras Phaser
          bloquea el hilo no aporta nada. */}
      <div className="hud-panel w-full max-w-md mx-5 px-7 py-7 flex flex-col items-center gap-5 text-center">
        {failed ? (
          <WifiOff className="w-10 h-10" style={{ color: "#ef4444" }} />
        ) : (
          <div className="hud-hop flex items-end gap-3 h-[26px]" aria-hidden="true">
            <span style={{ background: "#10b981" }} />
            <span style={{ background: "#f5c04a" }} />
            <span style={{ background: "#5dcbfa" }} />
            <span style={{ background: "#ef4444" }} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h2 className="text-[28px] leading-none" style={{ color: failed ? "#ef4444" : "var(--hud-text)" }}>
            {titulo}
          </h2>
          <p className="text-[15px]" style={{ color: "var(--hud-dim)" }}>{subtitulo}</p>
        </div>

        <span className="hud-chip" style={{ color: "var(--hud-gold)" }}>
          {playerConfig.isCustom
            ? <>Sala privada <span className="room-code">{playerConfig.roomCode ?? "????"}</span></>
            : salaLabel}
        </span>

        <button onClick={handleExit} className={`${failed ? "hud-btn" : "hud-chip"} w-full justify-center h-[38px] text-[15px] cursor-pointer`}>
          {failed ? "Volver al menú" : "Cancelar y volver al menú"}
        </button>
      </div>
    </div>
  );
};
