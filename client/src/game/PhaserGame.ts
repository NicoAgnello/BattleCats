import Phaser from "phaser";

export const WORLD_W = 4800;
export const WORLD_H = 4800;

export function createPhaserConfig(parentId: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.WEBGL,          // Forzar WebGL (nunca Canvas2D)
    parent: parentId,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0a160f",
    banner: false,               // No consola de Phaser
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,    // Usar requestAnimationFrame nativo
      smoothStep: true,          // Delta suavizado para evitar micro-stutters
    },
    render: {
      antialias: false,          // OFF: reduce carga GPU en gráficos vectoriales
      roundPixels: true,         // Elimina subpixel jitter visual
      powerPreference: "high-performance",
      batchSize: 2048,           // Más objetos por batch de WebGL
      mipmapFilter: "NEAREST",
    },
    input: {
      activePointers: 2,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
  };
}
