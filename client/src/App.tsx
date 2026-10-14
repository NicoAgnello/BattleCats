import React, { useState, useEffect } from "react";
import { StartScreen, PlayerConfig } from "./components/StartScreen";
import { GameCanvas } from "./components/GameCanvas";
import { UIOverlay } from "./components/UIOverlay";
import { DebugOverlay } from "./components/DebugOverlay";
import { LoadingScreen } from "./components/LoadingScreen";

export const App: React.FC = () => {
  const [inGame, setInGame] = useState(false);
  const [playerConfig, setPlayerConfig] = useState<PlayerConfig | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  const handleStartGame = (config: PlayerConfig) => {
    setPlayerConfig(config);
    setInGame(true);
  };

  const handleOpenMenu = () => {
    setInGame(false);
  };

  // Phaser construye el mapa de forma sincrónica dentro de un rAF, y los rAF corren antes
  // del paint: si se monta en el mismo frame, bloquea el hilo antes de que la pantalla de
  // carga llegue a pintarse y su spinner nunca pasa al compositor. Con dos frames de
  // margen la pantalla ya está pintada y la animación sigue corriendo durante el bloqueo.
  useEffect(() => {
    if (!inGame) {
      setCanvasReady(false);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setCanvasReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [inGame]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 font-game">
      {!inGame || !playerConfig ? (
        <StartScreen onStartGame={handleStartGame} />
      ) : (
        <>
          {/* Phaser Canvas */}
          {canvasReady && <GameCanvas playerConfig={playerConfig} />}

          {/* External React UI Overlay */}
          <UIOverlay onOpenMenu={handleOpenMenu} />

          {/* Debug console — visible in any browser without DevTools */}
          <DebugOverlay />

          {/* Pantalla de carga: tapa el canvas hasta que la sala está conectada */}
          <LoadingScreen playerConfig={playerConfig} onExit={handleOpenMenu} />
        </>
      )}
    </main>
  );
};

export default App;
