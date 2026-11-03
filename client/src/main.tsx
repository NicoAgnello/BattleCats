import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Letra pixel del HUD incluida en el bundle: funciona en una LAN sin internet
import "@fontsource-variable/pixelify-sans";
import "./index.css";

// Note: React.StrictMode is omitted for Phaser WebGL game canvas to prevent double WebGL context and double WebSocket initialization
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
