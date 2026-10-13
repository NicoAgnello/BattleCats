/**
 * Dirección del servidor de juego. Por defecto es el mismo host desde el que se abrió
 * la página, en el puerto 2567: así funciona en la red local entrando por la IP de la
 * máquina (ej. http://192.168.0.10:3000). Para otro servidor se define VITE_SERVER_URL
 * (ej. VITE_SERVER_URL=http://192.168.0.10:2567 npm run dev).
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const hostname = window.location.hostname || "localhost";
const secure = window.location.protocol === "https:";

export const SERVER_HTTP = (env?.VITE_SERVER_URL || `${secure ? "https" : "http"}://${hostname}:2567`).replace(/\/$/, "");
export const SERVER_WS = SERVER_HTTP.replace(/^http/, "ws");
