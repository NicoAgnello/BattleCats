import React, { useState, useEffect, useCallback } from "react";
import { Loader2, WifiOff, LogOut } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-slate-950 via-jungle-900 to-slate-950 font-game select-none">
      {/* Sin backdrop-blur a propósito: el fondo es opaco, así que no aportaría nada
          visualmente y obliga a recomponer cada frame mientras Phaser bloquea el hilo. */}
      <div className="border-2 border-emerald-500/40 bg-slate-900 p-8 rounded-3xl text-center max-w-md w-full mx-5 shadow-2xl space-y-5">
        <div
          className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center border-2 ${
            failed ? "bg-red-500/20 border-red-400" : "bg-emerald-500/20 border-emerald-400"
          }`}
        >
          {failed ? (
            <WifiOff className="w-9 h-9 text-red-400" />
          ) : (
            // La rotación va en un div (no en el <svg>): un elemento HTML se promueve a
            // capa propia de forma fiable, y así el compositor sigue animándola aunque
            // Phaser tenga bloqueado el hilo principal construyendo el mapa.
            <div className="animate-spin" style={{ willChange: "transform" }}>
              <Loader2 className="w-9 h-9 text-emerald-400" />
            </div>
          )}
        </div>

        <div>
          <h2
            className={`text-2xl font-black tracking-wider uppercase drop-shadow-md ${
              failed ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {titulo}
          </h2>
          <p className="text-sm text-slate-300 mt-2">{subtitulo}</p>
        </div>

        <div className="px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800 text-xs font-bold text-slate-300 inline-block">
          {salaLabel}
        </div>

        <button
          onClick={handleExit}
          className="w-full py-3.5 px-6 rounded-2xl font-black tracking-wider text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 hover:border-cyan-500/50 active:scale-95 transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{failed ? "VOLVER AL MENÚ" : "SALIR AL MENÚ"}</span>
        </button>
      </div>
    </div>
  );
};
