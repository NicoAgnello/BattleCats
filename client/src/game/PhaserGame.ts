import Phaser from "phaser";

export const WORLD_W = 8000;
export const WORLD_H = 8000;

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
      antialias: true,           // ON: bordes y curvas ultra suaves
      roundPixels: false,        // OFF: precisión subpixel para fluidez de cámara perfecta estilo Suroi
      powerPreference: "high-performance",
      batchSize: 4096,           // Más sprites por draw call de WebGL
      mipmapFilter: "LINEAR",
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
