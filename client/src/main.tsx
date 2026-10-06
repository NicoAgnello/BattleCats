import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Note: React.StrictMode is omitted for Phaser WebGL game canvas to prevent double WebGL context and double WebSocket initialization
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
