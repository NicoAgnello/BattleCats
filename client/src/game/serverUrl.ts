/**
 * Dirección del servidor de juego. Por defecto es el mismo host desde el que se abrió
 * la página, en el puerto 2567: así funciona en la red local entrando por la IP de la
 * máquina (ej. http://192.168.0.10:3000). Para otro servidor se define VITE_SERVER_URL
 * (ej. VITE_SERVER_URL=http://192.168.0.10:2567 npm run dev).
 */
const env = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string; PROD?: boolean } }).env;
const hostname = window.location.hostname || "localhost";
const secure = window.location.protocol === "https:";

// Versión compilada (npm run jugar): la página la sirve el mismo servidor del juego,
// así que se usa el mismo origen (sirve en cualquier puerto). En desarrollo la página
// viene de Vite (3000) y el juego está en el 2567.
const defaultUrl = env?.PROD ? window.location.origin : `${secure ? "https" : "http"}://${hostname}:2567`;

export const SERVER_HTTP = (env?.VITE_SERVER_URL || defaultUrl).replace(/\/$/, "");
export const SERVER_WS = SERVER_HTTP.replace(/^http/, "ws");
