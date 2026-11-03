import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Letra pixel del HUD incluida en el bundle: funciona en una LAN sin internet
import "@fontsource-variable/pixelify-sans";
import "./index.css";

// Phaser dibuja cada texto una sola vez: si la letra no cargó todavía, ese texto queda
// con la letra de reemplazo. Se pide apenas arranca la página (el menú tarda más).
document.fonts?.load("16px 'Pixelify Sans Variable'").catch(() => {});
document.fonts?.load("bold 16px 'Pixelify Sans Variable'").catch(() => {});

// Note: React.StrictMode is omitted for Phaser WebGL game canvas to prevent double WebGL context and double WebSocket initialization
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
