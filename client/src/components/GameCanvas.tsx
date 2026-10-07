import React, { useEffect, useRef } from "react";
import Phaser from "phaser";
import { MainScene } from "../game/scenes/MainScene";
import { NetworkClient } from "../game/NetworkManager";
import { createPhaserConfig } from "../game/PhaserGame";

interface GameCanvasProps {
  playerConfig?: {
    name: string;
    skin: number;
  };
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ playerConfig }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef  = useRef<Phaser.Game | null>(null);
  const netRef   = useRef<NetworkClient | null>(null);

  useEffect(() => {
    if (!mountRef.current || gameRef.current) return;

    /* 1. Crear cliente de red */
    const net = new NetworkClient();
    netRef.current = net;

    /* 2. Crear escena con referencia al cliente */
    const scene = new MainScene();
    scene.net   = net;            // inyección directa antes de que Phaser llame a create()
    if (playerConfig) {
      scene.playerOptions = { name: playerConfig.name, skin: playerConfig.skin };
    }

    /* 3. Arrancar Phaser */
    const config: Phaser.Types.Core.GameConfig = {
      ...createPhaserConfig("phaser-root"),
      scene: [scene],
    };

    gameRef.current = new Phaser.Game(config);
    (window as any).__PHASER_GAME__ = gameRef.current;
    (window as any).__MAIN_SCENE__ = scene;

    /* 4. Limpieza al desmontar */
    return () => {
      delete (window as any).__PHASER_GAME__;
      delete (window as any).__MAIN_SCENE__;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      netRef.current?.disconnect();
      netRef.current = null;
    };

  }, []);  // [] → ejecutar solo una vez

  return (
    <div
      id="phaser-root"
      ref={mountRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
};
