/**
 * Modo de movimiento elegido por el jugador.
 *
 * - CLASSIC: WASD fijo en la pantalla (W siempre va hacia arriba).
 * - AIM: relativo a la mira. W avanza hacia el mouse, S retrocede y A/D se mueven
 *   de costado respecto de esa dirección.
 *
 * Es solo del cliente: al servidor le llega una dirección en el mapa igual que antes,
 * así que no cambia ni el protocolo ni la validación del movimiento.
 */
export type MoveMode = "CLASSIC" | "AIM";

const STORAGE_KEY = "michi_move_mode";
export const MOVE_MODE_EVENT = "move-mode-update";

export function getMoveMode(): MoveMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "AIM" ? "AIM" : "CLASSIC";
  } catch {
    return "CLASSIC";
  }
}

/** Guarda el modo y avisa (la escena y el HUD escuchan MOVE_MODE_EVENT). */
export function setMoveMode(mode: MoveMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
  window.dispatchEvent(new CustomEvent(MOVE_MODE_EVENT, { detail: mode }));
}

export const MOVE_MODE_LABEL: Record<MoveMode, string> = {
  CLASSIC: "clásico",
  AIM: "hacia la mira",
};

/**
 * Teclas → dirección en el mapa (sin normalizar).
 * @param forward W − S (1, 0 o −1)
 * @param strafe  D − A (1, 0 o −1)
 * @param aim     ángulo de la mira en radianes (0 = derecha; y crece hacia abajo)
 */
export function keysToDirection(forward: number, strafe: number, aim: number, mode: MoveMode): [number, number] {
  if (mode === "CLASSIC") return [strafe, -forward];
  const fx = Math.cos(aim), fy = Math.sin(aim);   // adelante: hacia el mouse
  const rx = -fy, ry = fx;                        // derecha: adelante girado 90° (horario en pantalla)
  return [fx * forward + rx * strafe, fy * forward + ry * strafe];
}
