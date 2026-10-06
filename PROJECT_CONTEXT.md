# 🎮 PROJECT CONTEXT: 2D Top-Down Battle Royale Multiplayer

> **Documento de Contexto Técnico para Continuidad de Desarrollo con IA**  
> *Versión: 1.0.0 | Fecha: Octubre 2026*

---

## 📌 1. Visión General del Proyecto

Este proyecto es una base sólida y funcional para un videojuego multijugador **Battle Royale 2D Top-Down** desarrollado en **TypeScript estricto**.  
El servidor es autoritativo (dicta físicas, colisiones y estado global) y el cliente realiza interpolación visual (LERP) y renderizado de interfaz React en tiempo real.

⚠️ **IMPORTANTE**: No se utiliza ninguna base de datos (ni PostgreSQL ni MongoDB). Todo el estado del juego se mantiene estrictamente en la **memoria RAM del servidor**.

---

## 🛠️ 2. Stack Tecnológico

| Capa | Tecnología | Descripción / Roles |
| :--- | :--- | :--- |
| **Lenguaje** | **TypeScript** | Modo estricto habilitado en servidor y cliente. |
| **Backend Multijugador** | **Node.js + Express + Colyseus** | Servidor WebSocket autoritativo (60 FPS tick). |
| **Motor Gráfico (Client)** | **Phaser 3** | Renderizado WebGL/Canvas 2D, cámaras e interpolación de físicas. |
| **Interfaz UI (Client)** | **React 18 + Vite + Tailwind CSS** | UI externa glassmorphic (Vida, Zona, Barra de Estilo, Estado). |
| **Iconografía** | **Lucide React** | Iconos SVG optimizados. |

---

## 📂 3. Estructura del Monorepo

```
/Juego
├── package.json                   # Scripts raíz (npm run dev:server, dev:client, build)
├── PROJECT_CONTEXT.md             # Este documento de contexto técnico
├── server/                        # Backend (Colyseus + Express)
│   ├── package.json
│   ├── tsconfig.json              # experimentalDecorators: true (Requerido por Colyseus Schema v2)
│   └── src/
│       ├── index.ts               # Servidor Express + Colyseus en puerto 2567
│       └── rooms/
│           ├── JungleRoom.ts      # Lógica autoritativa, loop 60 FPS, colisiones e inputs
│           └── schema/
│               └── GameState.ts   # Schemas de Colyseus (Player, Projectile, Trap, Bush, ZoneState)
└── client/                        # Frontend (React + Vite + Tailwind CSS + Phaser 3)
    ├── package.json
    ├── vite.config.ts             # Servidor Vite en puerto 3000
    ├── tailwind.config.js         # Tema visual jungle (tokens neón esmeralda y glassmorphism)
    └── src/
        ├── main.tsx               # Entrada React (Sin StrictMode para evitar dobles sockets)
        ├── App.tsx                # Integración de Canvas y UI Overlay
        ├── index.css              # Estilos globales y utilidades glassmorphic
        ├── components/
        │   ├── GameCanvas.tsx     # Contenedor e inicializador de la instancia Phaser 3
        │   └── UIOverlay.tsx      # Interfaz de React superpuesta en tiempo real
        └── game/
            ├── NetworkManager.ts  # Singleton de conexión WebSocket con Colyseus
            ├── PhaserGame.ts      # Configuración de Phaser 3 Arcade Physics
            └── scenes/
                └── MainScene.ts   # Escena Phaser 3 (Grid, LERP, zona, disparo, trampas)
```

---

## 🛰️ 4. Modelos de Datos (Colyseus Schemas)

Ubicados en [`/server/src/rooms/schema/GameState.ts`](file:///home/luca/Escritorio/Juego/server/src/rooms/schema/GameState.ts):

### `Player`
- `id`: `string` (Session ID de Colyseus).
- `x`, `y`: `number` (Posición actual en mapa 2000x2000).
- `rotation`: `number` (Ángulo de apuntado en radianes).
- `hp`: `number` (Salud actual, inicial: 100).
- `maxHp`: `number` (Salud máxima: 100).
- `isGhost`: `boolean` (Verdadero cuando `hp <= 0`).
- `isHidden`: `boolean` (Verdadero dentro de un arbusto).
- `dashCooldown`: `number` (Tiempo restante en segundos para el Dash).
- `trapCooldown`: `number` (Tiempo restante en segundos para colocar Trampa Fantasma).
- `shootCooldown`: `number` (Cooldown entre disparos).
- `kills`: `number` (Contador de eliminaciones).

### `Projectile`
- `id`: `string` (ID único de bala).
- `x`, `y`: `number` (Posición).
- `vx`, `vy`: `number` (Velocidad vectorial).
- `ownerId`: `string` (Session ID del jugador que disparó).
- `damage`: `number` (Daño por impacto: 25).
- `lifetime`: `number` (Tiempo de vida restante: 2.5s).

### `Trap`
- `id`: `string` (ID único de trampa post-mortem).
- `x`, `y`: `number` (Posición colocada por un fantasma).
- `ownerId`: `string` (Session ID del creador).
- `active`: `boolean` (Estado de activación).
- `damage`: `number` (Daño por activación: 35).

### `Bush`
- `id`: `string` (Identificador del arbusto estático).
- `x`, `y`, `width`, `height`: `number` (Límites rectangulares de sigilo).

### `ZoneState`
- `x`, `y`: `number` (Centro del mapa: 1000, 1000).
- `currentRadius`: `number` (Radio actual del círculo seguro).
- `targetRadius`: `number` (Radio objetivo en encogimiento).
- `phase`: `number` (Número de fase actual).
- `timer`: `number` (Cuenta regresiva en segundos).
- `isShrinking`: `boolean` (Verdadero si está reduciéndose en tiempo real).

---

## ⚡ 5. Mecánicas del Juego Implementadas

1. **Movimiento y Rotación Autoritativa**:
   - El cliente envía vectores normales `(dx, dy)` mediante WASD y la rotación en radianes hacia el puntero del mouse (`this.network.sendMove(dx, dy, rotation)`).
   - El servidor calcula la posición a 220 unidades/seg (o 280 para fantasmas) y valida los bordes del mapa.

2. **Acción - Dash (Barra Espaciadora)**:
   - Al presionar `ESPACIO`, se envía un impulso instantáneo de 140 unidades hacia el ángulo de rotación actual del personaje.
   - Manejado por el servidor con un cooldown estricto de 2.0 segundos.

3. **Acción - Disparo (Clic Izquierdo)**:
   - Instancia un proyectil neón rosado en la dirección del puntero del mouse (velocidad 650 un/s, cooldown 250ms).
   - El servidor simula el movimiento del proyectil a 60 FPS y detecta colisiones con jugadores vivos. Al impactar, inflige 25 HP de daño.

4. **Mecánica - Arbustos (Sigilo)**:
   - Existen 8 zonas rectangulares verdes estáticas en el mapa.
   - En cada tick, el servidor verifica la intersección de los jugadores con los arbustos. Si está dentro, asigna `player.isHidden = true`.
   - **Renderizado en Cliente**: Los clientes remotos ocultan completamente al jugador (`setVisible(false)`). El cliente local lo renderiza con transparencia verde (`alpha = 0.45`) para notificarle que está oculto.

5. **Mecánica - Trampas Post-Mortem (Fantasmas)**:
   - Al llegar el HP a 0, el jugador no se desconecta; se convierte en `isGhost = true`.
   - La cámara continúa siguiendo al fantasma. No puede disparar, pero puede hacer **Clic Derecho** para colocar un objeto `Trap` en el mapa (cooldown de 6s).
   - Si un jugador vivo pasa a menos de 30 unidades de una trampa activa, sufre 35 HP de daño y la trampa explota.

6. **Mecánica - Zona Segura (Battle Royale Circle)**:
   - Círculo central controlado por el temporizador del servidor (fases de 15s de espera y 10s de reducción de radio al 65%).
   - Jugadores fuera del radio seguro sufren daño continuo (6 HP/s + escalado por fase).
   - Renderizado en Phaser: Dibuja un área carmesí de peligro fuera del círculo y un anillo esmeralda neón de 8px en el borde seguro.

---

## 📐 6. Arquitectura del Cliente (Phaser 3 + React)

- **`GameCanvas.tsx`**: Renderiza el contenedor `#game-container` y monta la instancia Phaser limpiamente.
- **`MainScene.ts`**:
  - Renderiza el mapa de terreno verde jungla (`#0d2417`) con retícula de 100x100px.
  - Mantiene un factor de interpolación suave (LERP = 0.25 para jugadores, 0.4 para proyectiles).
  - Profundidades de capas (Depths):
    - `0`: Terreno y rejilla de mapa.
    - `5`: Zona de peligro y anillo seguro.
    - `15`: Arbustos de vegetación.
    - `30`: Trampas espectrales.
    - `50`: Avatares de jugadores y barras de salud.
    - `60`: Proyectiles láser.
- **`UIOverlay.tsx`**: Interfaz de usuario externa sobrepuesta en React con glassmorphic blur:
  - Estado de Conexión (`Servidor Conectado`, `Conectando...`, `Error`).
  - Barra de Salud dinámica.
  - **Barra de Estilo** vacía (Rango C) lista para extender.
  - Temporizador de Zona Segura.
  - Contador de eliminaciones (Kills).
  - Banner interactivo en **Modo Fantasma**.

---

## 🚀 7. Comandos de Ejecución

Desde la raíz del proyecto `/Juego`:

```bash
# Iniciar Servidor Colyseus (Puerto 2567)
npm run dev:server

# Iniciar Cliente React + Vite (Puerto 3000)
npm run dev:client

# Compilar proyecto completo
npm run build
```

---

## 🗺️ 8. Roadmap y Próximos Pasos para Continuar

1. **Loot y Armamento**:
   - Crear un Schema `ItemPickup` (Escopetas, Rifles de Francotirador, Medkits) que aparezcan aleatoriamente en el mapa.
2. **Sistema de Barra de Estilo (Style Bar)**:
   - Llenar dinámicamente la "Barra de Estilo" en React al realizar eliminaciones, esquivas con Dash a corta distancia o detonación de trampas, subiendo de Rango (C ➔ B ➔ A ➔ S).
3. **Efectos Visuales y Sonoros**:
   - Agregar emisores de partículas en Phaser 3 para estelas de balas, explosiones de trampas y efectos de audio HTML5 / WebAudio.
4. **Pantalla de Victoria y Re-Partida**:
   - Detectar al último jugador vivo en la sala (`isGhost === false`) y desplegar la pantalla de "VICTORIA ROYALE" con opción de reiniciar la partida.
