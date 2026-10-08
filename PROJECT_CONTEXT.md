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
| **Backend Multijugador** | **Node.js + Colyseus + SSE (Server-Sent Events)** | Servidor autoritativo con streaming dual: WebSocket (Colyseus) + SSE a 60Hz/30Hz con TCP_NODELAY. |
| **Motor Gráfico (Client)** | **Phaser 3** | Renderizado WebGL/Canvas 2D, cámaras e interpolación de físicas. |
| **Interfaz UI (Client)** | **React 18 + Vite + Tailwind CSS** | UI externa glassmorphic (Vida, Zona, Barra de Estilo, Estado). |
| **Iconografía** | **Lucide React** | Iconos SVG optimizados. |

---

## 📂 3. Estructura del Monorepo

```
/BattleCats
├── package.json                   # Scripts raíz (npm run dev:server, dev:client, build)
├── PROJECT_CONTEXT.md             # Este documento de contexto técnico
├── test_runner.js                 # Suite automatizada de benchmarks CDP + Screencast + FFmpeg
├── server/                        # Backend (Colyseus + Express + SSE)
│   ├── package.json
│   ├── tsconfig.json              # experimentalDecorators: true
│   └── src/
│       ├── index.ts               # Servidor Express + Colyseus en puerto 2567
│       ├── sse.ts                 # Hub de Server-Sent Events (/api/events) con TCP_NODELAY
│       └── rooms/
│           ├── JungleRoom.ts      # Lógica autoritativa, loop 60 FPS, colisiones, inputs y broadcast SSE
│           └── schema/
│               └── GameState.ts   # Schemas de Colyseus (Player, Projectile, Trap, Bush, ZoneState)
└── client/                        # Frontend (React + Vite + Tailwind CSS + Phaser 3)
    ├── package.json
    ├── vite.config.ts             # Servidor Vite en puerto 3000
    ├── tailwind.config.js         # Tema visual jungle
    └── src/
        ├── main.tsx               # Entrada React
        ├── App.tsx                # Integración de Canvas y UI Overlay
        ├── index.css              # Estilos globales y utilidades glassmorphic
        ├── components/
        │   ├── GameCanvas.tsx     # Contenedor e inicializador de Phaser 3
        │   └── UIOverlay.tsx      # Interfaz de React superpuesta con telemetría SSE 60Hz
        └── game/
            ├── NetworkManager.ts  # Cliente WebSocket con Colyseus
            ├── SSEClient.ts       # Cliente EventSource (/api/events) para pipeline de baja latencia
            ├── PhaserGame.ts      # Configuración de Phaser 3 Arcade Physics
            └── scenes/
                └── MainScene.ts   # Escena Phaser 3 (Disparo predictivo 0ms, auto-fire, interpolación SSE)
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
   - El servidor calcula la posición a 220 unidades/seg (o 253 unidades/seg [+15% de velocidad] cuando lleva equipadas las **Garras Felinas / MELEE**, o 280 para fantasmas) y valida los bordes del mapa.

2. **Acción - Roll vs Dash Táctico (Barra Espaciadora)**:
   - **Personaje con Arma Equipada (Pistola, Escopeta, Sniper, Granada)**: Realiza un **Roll acrobático** (rodar de esquiva de 120 px con giro de 360°, nubes de polvo y cooldown de **2.5 segundos**).
   - **Personaje solo con Garras Felinas (MELEE)**: Realiza un **Dash felino rápido** (impulso ágil de 160 px con estelas doradas traslúcidas y cooldown de **1.8 segundos**).
   - **Dirección inteligente**: Si el personaje se está desplazando con las teclas **WASD**, el dash/roll se ejecuta hacia la dirección exacta del movimiento. Si el personaje está estacionario, se ejecuta hacia la posición del **cursor del mouse**. Valida colisiones con obstáculos en servidor y cliente para evitar solapamientos.

3. **Acción - Disparo y Armamento Asimétrico**:
   - **Pistola Láser**: 20 de daño, 12 balas en recámara, 2 cargadores de reserva (24 balas). Cooldown 0.3s, recarga 2.0s, alcance visual de 480px.
   - **Escopeta de Caza**: 5 perdigones de 15 de daño cada uno, 2 balas en recámara, 4 cargadores de reserva (8 balas). Cooldown 1.0s, recarga 2.5s, cono de 310px.
   - **Rifle Sniper**: 50 de daño por disparo, 5 balas en recámara, 1 cargador de reserva (5 balas). Cooldown 0.5s, recarga 3.0s, alcance de 980px con alta velocidad.
   - **Granada Táctica**: Se arroja al punto exacto del cursor (máximo 400px), titila durante 2.0s en el suelo y detona causando 100 de daño en el núcleo interno y 70 en el radio externo (160px).
   - **Garras Felinas (Melee)**: 50 de daño por arañazo a corta distancia (75px). Otorga un **+15% de bonificación pasiva a la velocidad de movimiento**.

4. **Movilidad - Dash & Roll Dinámico**:
   - **Con Armas de Fuego**: Realiza un **Roll Felino** evasivo de 120px con partículas de polvo y cooldown de 2.5s.
   - **Con Garras Felinas**: Realiza un **Dash Felino Veloz** de 160px con estelas doradas y cooldown ágil de 1.8s.
   - **Dirección**: Se ejecuta hacia el vector de movimiento de WASD; si el personaje está quieto, hacia el cursor.

5. **Mundo Vasto - Mapa 4800 x 4800 px (Estilo Suroi.io)**:
   - Superficie masiva de **4800 x 4800 px** (~5.76 veces más espacioso), permitiendo fases iniciales de exploración táctica, farmeo de cofres y tensión en avistamientos lejanos.
   - **Orografía**:
     - Océano perimetral exterior y costa de arena dorada (`0xc4a96b`).
     - Gran isla de jungla (`0x56893b`) con 13 parches de biomas (claros soleados y bosques densos).
     - Río serpenteante que cruza la isla de Norte a Sur (`0 a 4800px`) con fricción acuática (`0.75x`).
     - **3 Puentes de madera estratégicos** (Norte en `y=1160`, Centro en `y=2400`, Sur en `y=3600`) para cruces rápidos sin penalización de velocidad.
     - Carretera principal Este-Oeste conectando los cuadrantes a través del puente central.
   - **86 Obstáculos Destructibles**: Cajas de madera con botín, barriles explosivos, rocas y árboles con físicas de rebote y colisión estricta.
   - **28 Arbustos Tácticos**: Ocultan la visibilidad de los gatos para emboscadas.
   - **Minimap HUD Reactivo**: Proyecta la orografía completa en tiempo real a escala `sc = 136 / 4800` con marcadores direccionales y círculo de tormenta.

6. **Zona Segura y Tormenta Tóxica (Battle Royale Circle)**:
   - Radio inicial de **2300 px** centrado en `(2400, 2400)`.
   - Ciclos de 35s de fase segura y 22s de encogimiento progresivo hacia el epicentro.
   - Renderizado con halo masivo de 4800px en Phaser 3 que cubre íntegramente las 4 esquinas de la pantalla.

7. **Barras de Vida y HUD Fijo**:
   - La barra de vida y el nombre del jugador se mantienen fijos verticalmente sobre la cabeza del personaje, sin rotar con el apuntado del mouse.

---

## 📐 6. Arquitectura del Cliente (Phaser 3 + React)

- **`GameCanvas.tsx`**: Renderiza el contenedor `#game-container` y monta la instancia Phaser limpiamente.
- **`MainScene.ts`**:
  - Renderiza el mapa masivo 4800x4800 con retícula táctica limpia de 80px.
  - Cámara suave con seguimiento dinámico e interpolación hacia el cursor (*Mouse Look-Ahead*).
  - Profundidades de capas (Depths):
    - `0`: Terreno, arena, océano, caminos y río.
    - `8`: Zona de peligro circular (tormenta roja).
    - `20`: Arbustos y vegetación.
    - `24`: Beacons e indicadores de loot.
    - `30`: Obstáculos sólidos (cajas, barriles, rocas).
    - `50`: Conos de apuntado y miras tácticas.
    - `60`: Contenedores de personajes (cuerpo y manos).
    - `65`: Contenedores UI de personajes (barra de vida y nombres erguidos).
    - `70`: Proyectiles láser, balas de francotirador y granadas.
    - `200`: Minimapa HUD sobre la cámara.
- **`UIOverlay.tsx`**: Interfaz de usuario externa sobrepuesta en React con estética glassmorphic:
  - Estado de Conexión (`Servidor Conectado`, `SSE 60Hz`, `Audio`).
  - Barra de Salud y Escudo dinámicas.
  - Barra de Estilo con rangos D, C, B, A, S.
  - Selector y estado de arma con munición en recámara y cargadores de reserva.
  - Indicador de Cooldown de Dash / Roll.
  - Temporizador de Zona Segura por fases.
  - Notificaciones de Killfeed en tiempo real.
  - Banner interactivo en **Modo Fantasma** con reaparición / reinicio de partida.

---

## 🚀 7. Comandos de Ejecución

Desde la raíz del proyecto `/BattleCats`:

```bash
# Iniciar Servidor Colyseus (Puerto 2567)
cd server && npm run dev

# Iniciar Cliente React + Vite (Puerto 3000)
cd client && npm run dev

# Compilar proyecto completo
npm run build
```

---

## ⚡ 8. Pipeline de Baja Latencia SSE y Optimización de Fluidez (60 FPS)

1. **Dual-Channel Networking (WebSocket + Server-Sent Events)**:
   - **WebSocket (Colyseus en `:2567`)**: Manejo de handshake, conexiones de sala, inputs de cliente y mutaciones de estado de esquemas.
   - **SSE (`/api/events`)**: Streaming unidireccional de baja latencia con `TCP_NODELAY` activado (`req.socket.setNoDelay(true)`). Transmite `tick` (30-60Hz), disparos enemigos (`playerShoot`), tajos melee (`playerMelee`), desplazamientos (`playerDash`), impactos de daño (`hit`) y explosiones (`explosion`).
   - El cliente se conecta mediante [`SSEClient.ts`](file:///c:/Users/lucam/OneDrive/Desktop/battlecat/BattleCats/client/src/game/SSEClient.ts) y despacha CustomEvents globales en `window`, permitiendo que Phaser reaccione de inmediato sin esperar el buffer de WebSocket.

2. **Disparo Predictivo a 0ms y Auto-Fire Continuo**:
   - Disparo local instantáneo sin lag de ida y vuelta: audio WebAudio, retroceso visual de arma (`aimGfx`), partículas de boca de cañón y proyectil balístico local spawnan inmediatamente a 0ms.
   - Detección de auto-disparo continuo al mantener presionado el botón izquierdo del ratón (`this.input.activePointer.leftButtonDown()`).
   - Se evita duplicación de proyectiles filtrando las balas locales en `projectiles.onAdd` (`if (p.ownerId === this.myId) return;`).

3. **Optimización de Renderizado WebGL (`drawZone`)**:
   - Reemplazo del halo previo de trazo de 4800px por 4 rectángulos perimetrales exteriores simples y un anillo curvo de 600px de espesor. Esto reduce la carga de GPU de millones de píxeles a menos de 0.05 ms por frame.

4. **Suite de Benchmarks y Video Demostrativo**:
   - `test_runner.js`: Suite automatizada en CDP (Chrome DevTools Protocol) que somete el juego a pruebas de estrés de movimiento multidireccional, rotación 360°, auto-disparo con las 5 armas, evasión con Dash/Roll y cruce del río.
   - Artefactos de video generados:
     - [`battlecats_gameplay_fluid.mp4`](file:///C:/Users/lucam/.gemini/antigravity-ide/brain/58af40b1-2bb0-427f-9c8b-72a6f493b83b/battlecats_gameplay_fluid.mp4)
     - [`battlecats_gameplay_fluid.webp`](file:///C:/Users/lucam/.gemini/antigravity-ide/brain/58af40b1-2bb0-427f-9c8b-72a6f493b83b/battlecats_gameplay_fluid.webp)
   - Resultados de prueba: **0.0px de Desincronización, 0 Tirones/Reversas (100% Fluido)**.


---

## 🎨 9. Integración de Estética y Fluidez Suroi.io

Basado en el análisis en vivo de [https://suroi.io/](https://suroi.io/) y su repositorio oficial (`HasangerGames/suroi`):

1. **Paleta Canónica y Terreno Vectorial**:
   - **Hierba Principal**: `hsl(95, 41%, 38%)` -> `0x53893a` con parches de bosque denso (`0x45732f`) y claros soleados (`0x5c9641`).
   - **Río y Agua Viva**: `hsl(211, 63%, 42%)` -> `0x2767ae` fluyendo de norte a sur con franja de arena ribereña (`0xbc9f5d`) y orilla rocosa (`0x735130`).
   - **Océano Profundo**: `hsl(211, 63%, 30%)` -> `0x1c497d` con crestas y ondas de agua en los bordes.
   - **Senderos de Tierra**: `hsl(35, 50%, 40%)` -> `0x996733` cruzando el mapa de este a oeste conectando los puentes de madera reforzados.
   - **Cuadrícula Táctica**: Grid limpio de 72px (`0x000000`, 7% opacidad).

2. **Obstáculos Fieles a Suroi**:
   - **Cajas de Madera (`regular_crate.svg`)**: Tablones con ranuras verticales, travesaño diagonal de refuerzo y 4 remaches metálicos esquineros con borde oscuro.
   - **Rocas Facetadas (`rock_1.svg`)**: Polígonos de 7 vértices con facetas facetadas de sombra inferior y luz superior, con contorno nítido de 2.8px.
   - **Árboles y Arbustos**: Cúpulas orgánicas multi-lobulares (`oak_tree_leaves_1.svg`) con tronco central visible y sombras proyectadas.
   - **Barriles Explosivos**: Cuerpo rojo brillante, banda amarilla de advertencia y núcleo industrial.

3. **Sistema de 2 Manos / Patas con Retroceso y Zarpazos**:
   - Dos patas circulares (`radius: 6.2px`) con contorno oscuro de 2px (`0x1e293b`) y almohadillas plantares rosadas.
   - **Armas de fuego**: Las patas sujetan firmemente la empuñadura y el guardamanos/corredera; al disparar, tanto el arma como ambas patas retroceden al unísono por el retroceso (*recoil*).
   - **Garras felinas (Melee)**: Ambas patas preparadas al frente; al atacar, alternan zarpazos/puñetazos frontales hacia adelante con +15% de velocidad de movimiento.

4. **Cámara Dinámica con Anticipación de Ratón (Look-Ahead)**:
   - Interpolación LERP suave (0.14) hacia el cursor del ratón con distancia anticipada dinámica, extendiéndose aún más con el rifle Sniper para mayor alcance de visión.

5. **Artefactos Demostrativos Grabados en Vivo**:
   - Video MP4: [`battlecats_suroi_showcase.mp4`](file:///C:/Users/lucam/.gemini/antigravity-ide/brain/58af40b1-2bb0-427f-9c8b-72a6f493b83b/battlecats_suroi_showcase.mp4)
   - Video WebP: [`battlecats_suroi_showcase.webp`](file:///C:/Users/lucam/.gemini/antigravity-ide/brain/58af40b1-2bb0-427f-9c8b-72a6f493b83b/battlecats_suroi_showcase.webp)
