import React from "react";
import { GameCanvas } from "./components/GameCanvas";
import { UIOverlay } from "./components/UIOverlay";
import { DebugOverlay } from "./components/DebugOverlay";

export const App: React.FC = () => {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 font-game">
      {/* Phaser Canvas */}
      <GameCanvas />

      {/* External React UI Overlay */}
      <UIOverlay />

      {/* Debug console — visible in any browser without DevTools */}
      <DebugOverlay />
    </main>
  );
};

export default App;
