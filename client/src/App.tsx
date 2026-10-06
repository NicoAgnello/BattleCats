import React, { useState } from "react";
import { StartScreen, PlayerConfig } from "./components/StartScreen";
import { GameCanvas } from "./components/GameCanvas";
import { UIOverlay } from "./components/UIOverlay";
import { DebugOverlay } from "./components/DebugOverlay";

export const App: React.FC = () => {
  const [inGame, setInGame] = useState(false);
  const [playerConfig, setPlayerConfig] = useState<PlayerConfig | null>(null);

  const handleStartGame = (config: PlayerConfig) => {
    setPlayerConfig(config);
    setInGame(true);
  };

  const handleOpenMenu = () => {
    setInGame(false);
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 font-game">
      {!inGame || !playerConfig ? (
        <StartScreen onStartGame={handleStartGame} />
      ) : (
        <>
          {/* Phaser Canvas */}
          <GameCanvas playerConfig={{ name: playerConfig.name, skin: playerConfig.skin }} />

          {/* External React UI Overlay */}
          <UIOverlay onOpenMenu={handleOpenMenu} />

          {/* Debug console — visible in any browser without DevTools */}
          <DebugOverlay />
        </>
      )}
    </main>
  );
};

export default App;
