import Phaser from "phaser";

export const WORLD_W = 2000;
export const WORLD_H = 2000;

export function createPhaserConfig(parentId: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: parentId,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0a160f",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
  };
}
