# BattleCats

> Battle royale multijugador 2D en vista cenital, donde los jugadores son gatos que se pelean en una isla hasta que queda uno.
> Proyecto de la materia **Redes** (Instituto Leibnitz, Tercer Año). Equipo (5 integrantes): Nicolás Agnello, Sasha Frascarelli, Luca Morales, Alejo Schmidt y Facundo Henze.

---

## 1. Qué es el proyecto

BattleCats es un juego en red para hasta **16 participantes por sala** (jugadores humanos + 6 bots). Todos arrancan en una isla de 8000×8000 px solo con las garras, buscan armas y botiquines, y una **zona segura** circular se va achicando hasta que queda un solo gato vivo.

Lo que lo hace particular:

- **Fantasmas con trampas:** quien muere no se desconecta; pasa a ser un fantasma que puede poner trampas a los que siguen vivos.
- **Arbustos y casas:** esconden a los gatos de los enemigos (sigilo).
- **Armas asimétricas:** cada arma tiene su propio alcance, daño, cadencia y recarga. Las garras no gastan munición y dan +15 % de velocidad.
- **Dash/Roll:** con garras es un salto rápido; con arma es una voltereta de esquiva.
- **Arte pixel art** propio (gatos, armas, mapa, efectos) y estética inspirada en juegos .io (Suroi.io, Diep.io).

El objetivo académico es mostrar una **arquitectura cliente-servidor en red**: el servidor decide todo (posiciones válidas, daño, muertes, zona) y los clientes solo envían intenciones y dibujan lo que reciben.

---

## 2. Cómo correrlo

Requisitos: Node.js 20+ y npm.

```bash
# 1) instalar dependencias (una vez)
cd server && npm install
cd ../client && npm install

# 2) levantar todo
./start.sh            # Mac/Linux  (en Windows: start.bat)

# o por separado:
cd server && npm run dev     # servidor en http://localhost:2567
cd client && npm run dev     # cliente  en http://localhost:3000
```

Abrir `http://localhost:3000` en el navegador. Para probar multijugador, abrir varias pestañas (o varias compus de la misma red usando la IP del que corre el servidor: el cliente se conecta al mismo host por el puerto 2567).

Comprobación rápida del servidor: `GET http://localhost:2567/health`.

---

## 3. Estructura del proyecto

```
BattleCats/
├── package.json              Scripts de la raíz (dev:server, dev:client, build)
├── start.sh / start.bat      Levantan servidor y cliente juntos
├── PROJECT_CONTEXT.md        Resumen técnico previo (hay que actualizarlo, ver sección 8)
├── docs/                     Documentación técnica del repo
│   ├── DOCUMENTACION.md      Este documento
│   ├── fix-bots-congelados.md   Bug de bots "inmunes": causa y arreglo
│   ├── pixel-art-mundo.md       Cómo se arma el arte del mundo
│   └── tecnico-agua-mar.md      Diseño pendiente: agua del mar que frena y ahoga
│
├── server/                   BACKEND (Node.js + Colyseus + Express)
│   ├── package.json / tsconfig.json
│   └── src/
│       ├── index.ts          Arranca Express + Colyseus en el puerto 2567, registra la sala y /health
│       ├── sse.ts            Canal Server-Sent Events (/api/events): registro de clientes y broadcastSSE()
│       ├── rooms/
│       │   ├── JungleRoom.ts Sala de juego: TODA la lógica autoritativa (loop 60 Hz)
│       │   ├── structures.ts Definición de las 9 estructuras (casas, búnker, etc.) y sus puertas
│       │   ├── river.ts      Trazado del río y puentes (copia del cliente)
│       │   └── schema/
│       │       └── GameState.ts  Esquemas sincronizados: Player, Projectile, Trap, Bush, Obstacle, ItemPickup, ZoneState, GameState
│       └── spatial/
│           └── SpatialHashGrid.ts  Grilla espacial para buscar entidades cercanas rápido
│
├── client/                   FRONTEND (React + Vite + Phaser 3)
│   ├── index.html, vite.config.ts, tailwind.config.js, postcss.config.js, tsconfig.json
│   ├── public/
│   │   ├── sprites/          Hojas de sprites pixel art (PNG + JSON estilo Aseprite) y manifest.json
│   │   └── gameplay.mp4/.webm  Video de fondo de la pantalla de inicio
│   └── src/
│       ├── main.tsx          Entrada de React
│       ├── App.tsx           Alterna entre StartScreen y juego (GameCanvas + UIOverlay + DebugOverlay)
│       ├── index.css         Estilos globales
│       ├── components/       Interfaz en React (por fuera del canvas)
│       │   ├── StartScreen.tsx        Menú: apodo, skin, modo, región
│       │   ├── GameplayBackground.tsx Fondo animado del menú con bots simulados
│       │   ├── PixelPortrait.tsx      Retratos pixel art de las skins
│       │   ├── GameCanvas.tsx         Crea el cliente de red y arranca Phaser
│       │   ├── UIOverlay.tsx          HUD: vida, escudo, arma/munición, zona, killfeed, victoria
│       │   └── DebugOverlay.tsx       Consola de logs visible en el navegador
│       └── game/             Motor del juego en el cliente
│           ├── PhaserGame.ts          Configuración de Phaser (WebGL, 60 FPS, física Arcade)
│           ├── NetworkManager.ts      Cliente WebSocket (Colyseus): conecta y envía acciones
│           ├── SSEClient.ts           Cliente EventSource: recibe eventos en tiempo real
│           ├── SoundManager.ts        Sonidos y música sintetizados con Web Audio API
│           ├── scenes/MainScene.ts    Escena principal (lógica de cliente, ~4700 líneas)
│           ├── schema/GameState.ts    Copia del esquema del servidor (para deserializar)
│           ├── catSprites.ts          Carga y animación de sprites de gatos, armas y efectos
│           ├── terrain.ts             Genera el suelo, agua y puentes en pixel art
│           ├── coast.ts               Forma de la isla y olas (solo cliente)
│           ├── river.ts               Trazado del río y puentes (copia del servidor)
│           ├── structures.ts          Definición de estructuras (copia del servidor)
│           └── structureArt.ts        Arte de techos, pisos y muros de las estructuras
│
├── test_runner.js            Benchmark automático (Chrome DevTools Protocol)
├── check_fps*.js, measure_*.js, profile_gameplay.js, diag*.js, test_*.js, check_tab.js
│                             Scripts sueltos de medición/diagnóstico de rendimiento
├── capture_suroi_showcase.js Captura de video de demostración
└── suroi_ref/, suroi_repo/   Carpetas vacías (referencia a Suroi.io)
```

---

## 4. Arquitectura general

```
   NAVEGADOR (client)                                  SERVIDOR (server)
┌──────────────────────────┐                      ┌──────────────────────────┐
│ React: menú + HUD        │                      │ Express  (puerto 2567)   │
│ Phaser 3: dibuja el juego│                      │  ├─ /health              │
│                          │  WebSocket (Colyseus)│  ├─ /api/events  (SSE)   │
│ NetworkManager ──────────┼─── acciones ────────►│  └─ Colyseus Server      │
│  (move, shoot, dash...)  │◄── estado (schema) ──┼──     └─ JungleRoom      │
│                          │                      │         loop a 60 Hz     │
│ SSEClient ◄──────────────┼── eventos (tick,     │         SpatialHashGrid  │
│  (EventSource)           │   disparos, daño...) │         GameState en RAM │
└──────────────────────────┘                      └──────────────────────────┘
```

**Reglas de la arquitectura:**

1. **Servidor autoritativo.** El cliente no decide daños, muertes ni recogida de ítems. Solo manda *intenciones* (mover hacia X, disparar hacia Y).
2. **Dos canales de red** (ver 5.12): WebSocket para el estado y las acciones, SSE para eventos de baja latencia.
3. **Todo en memoria.** No hay base de datos: el estado vive en la RAM del servidor mientras la sala está abierta.
4. **Predicción en el cliente.** Cada cliente se mueve y dispara al instante en su pantalla sin esperar al servidor; los demás jugadores se ven interpolados.

---

## 5. Funcionalidad

Para cada funcionalidad se indica **cómo funciona**, **qué archivos intervienen** y **por qué se hizo así**.

### 5.1 Conexión y salas

**Cómo funciona.** Al apretar *PLAY!* en el menú, `App.tsx` monta `GameCanvas`, que crea un `NetworkClient` y la escena de Phaser. La escena llama a `connect()`, que hace `joinOrCreate("jungle_room", { name, skin })`: Colyseus mete al jugador en una sala con lugar (máximo 16) o crea una nueva. En el servidor, `onJoin` crea el `Player` con el apodo (máx. 16 caracteres) y la skin (0 a 4), lo ubica en un punto aleatorio a 800–3000 px del centro, con 100 de vida y solo las garras. Si la sala estaba en espera, se reinicia la partida. Al irse alguien, `onLeave` lo borra; si no queda ningún humano, la sala vuelve a `WAITING`.

**Archivos.** `App.tsx`, `GameCanvas.tsx`, `NetworkManager.ts`, `MainScene.ts` (`connect`, `bindRoom`), `JungleRoom.ts` (`onJoin`, `onLeave`), `index.ts`.

**Estados de partida** (`GameState.status`): `WAITING` → `PLAYING` → `VICTORY`. El loop del servidor solo simula cuando está en `PLAYING`. Al terminar, cualquier cliente puede pedir `restart`.

### 5.2 Estado compartido (schemas de Colyseus)

**Cómo funciona.** El servidor tiene un único objeto `GameState` con colecciones (`players`, `projectiles`, `traps`, `bushes`, `obstacles`, `items`) y la `zone`. Colyseus detecta los cambios y manda a cada cliente solo las diferencias (*delta*), a 60 patches por segundo (`setPatchRate(1000/60)`). El cliente tiene una copia del esquema para poder deserializar y se suscribe con `onAdd`, `onChange` y `onRemove` (`bindRoom` en `MainScene.ts`) para crear, actualizar o borrar los objetos que dibuja.

| Entidad | Datos principales |
|---|---|
| `Player` | posición, rotación, vida, escudo, fantasma/oculto, arma equipada y armas disponibles, munición (recámara y reserva), recarga, cooldowns (dash, disparo, trampa), kills, buff activo, emote, skin, si es bot |
| `Projectile` | posición, velocidad, dueño, daño, vida restante, tipo (`LASER`, `PELLET`, `SNIPER_BEAM`, `GRENADE`), destino y si la granada está armada |
| `Trap` | posición, dueño, daño (35) |
| `Obstacle` | posición, tipo (caja, barril, roca, árbol, muro), vida, radio, destruido |
| `ItemPickup` | posición, tipo (botiquín, escudo, velocidad, triple, armas), activo, tiempo de reaparición |
| `Bush` | rectángulo de sigilo |
| `ZoneState` | centro, radio actual y objetivo, fase, tiempo, si se está achicando |
| `GameState` | estado de la partida, vivos, ganador, tamaño del mundo (8000×8000) |

**Archivos.** `server/src/rooms/schema/GameState.ts` y su copia `client/src/game/schema/GameState.ts` (deben mantenerse **idénticas**).

**Por qué.** Con Colyseus no hay que armar a mano el protocolo de serialización: se declara el esquema con decoradores y la sincronización es automática y eficiente.

> **Lección aprendida (ver `docs/fix-bots-congelados.md`):** se había puesto un filtro de distancia (*Area of Interest*) sobre los jugadores. Provocaba gatos "fantasma congelados" en el cliente. Se quitó para `players` (son 16 como máximo) y se dejó solo para balas y trampas.

### 5.3 Movimiento y predicción en el cliente

**Cómo funciona.**

1. **Cliente (`MainScene.update`):** lee WASD, calcula la dirección normalizada y mueve a su propio gato **de inmediato** (velocidad 220 px/s; ×1,15 con garras; ×1,4 con buff de velocidad; ×0,75 dentro del río). Aplica choque contra obstáculos con una grilla espacial local. La rotación del gato sigue al mouse.
2. **Envío:** manda `move { dx, dy, rotation, x, y }` al servidor cuando algo cambia o cada ~16 ms, incluyendo la posición que predijo.
3. **Servidor (`onMessage("move")`):** calcula la velocidad que *debería* tener ese jugador (mismas reglas). Si la posición que mandó el cliente está a **≤ 140 px** de la que tiene el servidor, la acepta; si no, ignora la del cliente y avanza desde su propia posición. Después resuelve choques con obstáculos (consulta a la grilla espacial), limita al mapa (30 a 7970 px) y actualiza si el gato está oculto.
4. **Otros jugadores:** el cliente los dibuja moviéndose suavemente (interpolación LERP) hacia la última posición recibida (`tx`, `ty`), que llega por el estado de Colyseus y por el canal SSE.

**Archivos.** `MainScene.ts` (`update`), `NetworkManager.ts` (`sendMove`), `JungleRoom.ts` (handler `move`), `SpatialHashGrid.ts`.

**Por qué.** Si el jugador esperara la respuesta del servidor para moverse, sentiría el ping en cada paso. Con predicción el control es instantáneo y el servidor sigue teniendo la última palabra.

### 5.4 Dash / Roll (barra espaciadora)

**Cómo funciona.** El cliente ejecuta la animación al instante (`performLocalDash`) y manda `dash { dirX, dirY }`. La dirección es la de WASD, o hacia el mouse si está quieto. El servidor valida el cooldown y aplica el desplazamiento:

| | Con garras (MELEE) | Con arma de fuego |
|---|---|---|
| Tipo | Dash felino | Roll (voltereta) |
| Distancia | 160 px | 120 px |
| Cooldown | 1,8 s | 2,5 s |

Luego avisa a todos (`playerDash`, por Colyseus y por SSE) para que los demás vean la animación.

**Archivos.** `MainScene.ts` (`performLocalDash`, `playRollAnimation`, `playFastDashAnimation`), `JungleRoom.ts` (handler `dash`).

**Limitación conocida.** El servidor solo corrige colisión en el punto de llegada; no revisa lo que hay en el camino (es un pendiente: "el dash debe ser bloqueado por objetos y paredes").

### 5.5 Armas, disparo y recarga

**Armas** (definidas en `WEAPON_CONFIGS`, servidor; copia reducida en el cliente):

| Arma | Daño | Munición (recámara / reserva) | Cooldown | Recarga | Alcance |
|---|---|---|---|---|---|
| Garras (MELEE) | 50 | infinita | 0,3 s | – | 75 px |
| Pistola láser | 20 | 12 / 24 | 0,3 s | 2,0 s | 480 px |
| Escopeta | 5 perdigones × 15 | 2 / 8 | 1,0 s | 2,5 s | 310 px |
| Sniper | 50 | 5 / 5 | 0,5 s | 3,0 s | 980 px |
| Granada | 100 centro / 70 borde | 3 | 1,0 s | – | 400 px |

**Cómo funciona.**

1. **Cliente:** al hacer clic (o mantener apretado: autodisparo) `executeLocalShoot` revisa munición y cooldown, descuenta la bala localmente, reproduce sonido y retroceso, y lanza una **bala visual predictiva** al instante (`spawnPredictedProjectile`). Después manda `shoot { angle, targetX, targetY, angles }`.
2. **Servidor:** el handler `shoot` valida que no esté fantasma, ni recargando, ni en cooldown, y que tenga munición. Descuenta munición, y `spawnProjectiles` crea el/los `Projectile` según el arma (la dispersión es aleatoria dentro de un cono; con el buff TRIPLE la pistola dispara 3 y la escopeta 7). Si se vacía la recámara y hay reserva, recarga sola.
3. **Cada tick** el servidor mueve las balas, descuenta su vida, y consulta a la grilla espacial: si tocan un obstáculo lo dañan y desaparecen; si tocan un jugador vivo (a menos de 26 px, que no sea el dueño) le aplican daño y desaparecen.
4. **Garras:** no crean proyectil; el servidor busca jugadores y obstáculos dentro de 75 px del zarpazo y les aplica 50 de daño.
5. **Granada:** viaja hasta el punto del mouse (máx. 400 px), queda armada en el suelo 2 s titilando y explota: 100 de daño en radio 140 y 70 hasta radio 280.
6. **Evitar balas duplicadas:** el cliente ignora las balas del servidor cuyo dueño es él mismo, porque ya tiene la suya predictiva (`if (p.ownerId === this.myId) return;`).

**Archivos.** `MainScene.ts` (`executeLocalShoot`, `spawnPredictedProjectile`, `tryReload`, `switchWeapon`, `drawAimPixel`), `JungleRoom.ts` (handlers `shoot`/`reload`/`switchWeapon`, `spawnProjectiles`, `update`), `catSprites.ts` (sprites de balas y armas).

**Importante para mantener.** Alcance, daño, cooldowns y velocidades están **duplicados** en cliente y servidor. Si se cambian en uno hay que cambiarlos en el otro, si no la predicción se desfasa.

### 5.6 Daño, muerte, fantasmas y trampas

**Cómo funciona.**

- `applyDamage` descuenta primero el **escudo** (absorbe el 75 % del daño hasta agotarse) y después la vida.
- Cuando la vida llega a 0: el jugador pasa a `isGhost = true`, **suelta un ítem al azar** (`spawnDeathLoot`), se emite el evento `kill` (killfeed) y se recalcula cuántos quedan vivos (`updateAliveCount`). Si queda uno solo, el estado pasa a `VICTORY` y se avisa a todos (`matchVictory`).
- **Fantasma:** se mueve más rápido (280), no recibe daño, no dispara, y los demás ven solo su **tumba**. Puede enviar `placeTrap`: pone una trampa (cooldown 6 s) que explota al pisarla un jugador vivo (a menos de 32 px) y le hace 35 de daño.
- **Sigilo:** si un gato está dentro de un arbusto o de una estructura, `isHidden = true`; los bots no lo ven salvo que estén a menos de 120 px.

**Archivos.** `JungleRoom.ts` (`applyDamage`, `spawnDeathLoot`, `updateAliveCount`, `checkIsHidden`, handler `placeTrap`), `MainScene.ts` (`applyGhostTransition`, `createTomb`, `createTrap`), `UIOverlay.tsx` (killfeed y banner de fantasma/victoria).

### 5.7 Zona segura (tormenta)

**Cómo funciona.** `updateZone` maneja un ciclo por fases. La zona empieza centrada en el mapa (4000, 4000) con radio **3850 px**. Fase de espera (35 s la primera, y cada fase se acorta 2 s, mínimo 8 s) → achicamiento de 22 s hasta el 65 % del radio (mínimo 120 px) → siguiente fase. Quien está fuera del círculo recibe daño continuo de `7 + 3 × fase` por segundo ("Niebla Tóxica"). El cliente dibuja el círculo y el humo de tormenta con el radio recibido.

**Archivos.** `JungleRoom.ts` (`resetZone`, `updateZone`, `update`), `GameState.ts` (`ZoneState`), `MainScene.ts` (`drawZone`, `updateStormEdge`, `updateStormPuffs`), `UIOverlay.tsx` (temporizador).

### 5.8 Botín (loot) y buffs

**Cómo funciona.** Hay ítems repartidos por el mapa y dentro de las estructuras (cada una trae un arma según su tipo, un botiquín, un escudo y una mejora de velocidad). Las cajas rotas también sueltan un ítem y los jugadores eliminados dejan uno.

- **Armas:** el gato empieza solo con garras. Si está solo con garras y pasa sobre un arma, la toma automáticamente; si ya tiene arma, hay que **interactuar** (tecla de interacción) para cambiarla, y la anterior queda tirada en el piso.
- **Botiquín** +40 vida; **escudo** +50; **velocidad** ×1,4 durante 7 s; **triple** durante 9 s (3 balas de pistola / 7 perdigones).
- Los ítems fijos reaparecen entre 16 y 22 s después de ser recogidos.

**Archivos.** `JungleRoom.ts` (`createItemPickups`, `updateItems`, `handlePlayerInteract`, `spawnCrateLoot`), `MainScene.ts` (`createItem`, `tryInteract`, `updateLootInteraction`).

### 5.9 Obstáculos destructibles y explosiones

**Cómo funciona.** El servidor crea cajas, barriles explosivos, rocas, árboles y los **muros** de las estructuras (con puertas abiertas), todos como `Obstacle` con vida y radio. Las balas, zarpazos y explosiones los dañan (`damageObstacle`). Una caja destruida suelta botín; un barril destruido explota (radio 140, hasta 65 de daño con caída según distancia) y daña a los obstáculos cercanos, lo que permite explosiones en cadena. Los muros tienen 9999 de vida (indestructibles en la práctica).

**Archivos.** `JungleRoom.ts` (`createStaticObstacles`, `damageObstacle`, `triggerBarrelExplosion`, `triggerGrenadeExplosion`), `MainScene.ts` (`createObstacle`, `updateObstacleTexture`, `createExplosionFX`).

### 5.10 El mundo: isla, río, puentes, estructuras y arbustos

- **Isla y costa (`coast.ts`):** ruido determinista con semillas fijas define el borde de la isla. Distingue mar, playa y pasto, y anima las olas. Hoy **solo existe en el cliente**; el servidor no sabe del mar (el diseño para ahogar jugadores está en `docs/tecnico-agua-mar.md`).
- **Río y puentes (`river.ts`):** el río es una curva (Catmull-Rom) que baja de norte a sur con 3 puentes (y = 2000, 4000, 6000). Cruzar el agua reduce la velocidad al 75 %; el puente no. El archivo es **igual en cliente y servidor** para que ambos calculen lo mismo.
- **Estructuras (`structures.ts`, `structureArt.ts`):** 9 construcciones (mansión central, búnker, almacén, laboratorio, fuerte y 4 cabañas) con puertas. Al entrar, el techo se vuelve transparente en el cliente.
- **Arbustos:** esconden al gato; el servidor los reubica si quedan superpuestos con una estructura (`createStaticBushes`).
- **Suelo pixel art (`terrain.ts`):** se genera por código al cargar, como una imagen de 2667×2667 px (1 px de arte = 3 px del mundo).

**Detalle del arte:** `docs/pixel-art-mundo.md`.

### 5.11 Bots (IA simple)

**Cómo funciona.** `spawnBots` crea 6 bots por sala con nombres propios. Cada tick `updateBotsAI` los decide con reglas:

1. Si están **fuera de la zona** (más del 85 % del radio) caminan hacia el centro.
2. Si hay un enemigo a menos de 450 px (buscado con la grilla espacial, radio 650) lo apuntan, lo persiguen (garras) o lo rodean (armas), disparan según el alcance y a veces hacen dash.
3. Si no hay nadie, **deambulan** con una dirección aleatoria cada 1,5–3,5 s.
4. Un bot fantasma pone trampas cada 8–16 s.

Los bots usan las mismas reglas de daño, armas, loot y zona que un jugador.

**Archivos.** `JungleRoom.ts` (`spawnBots`, `updateBotsAI`).

### 5.12 Red: WebSocket + SSE

**Cómo funciona.** Dos canales con roles distintos:

| | WebSocket (Colyseus) | SSE (`/api/events`) |
|---|---|---|
| Dirección | ida y vuelta | solo servidor → cliente |
| Para qué | entrar a la sala, **enviar acciones** (`move`, `shoot`, `dash`, `reload`, `interact`, `switchWeapon`, `emote`, `placeTrap`, `restart`), **estado sincronizado** | **eventos en tiempo real**: `tick` (posiciones, vida y zona a 30 Hz), `playerShoot`, `playerMelee`, `playerDash`, `hit`, `explosion`, `kill`, `telemetry` (cada 1 s) |
| Puerto | 2567 (`ws://`) | 2567 (HTTP `text/event-stream`) |

- `sse.ts` mantiene un conjunto de respuestas HTTP abiertas y `broadcastSSE(tipo, datos)` escribe el evento a todas. Se activa `setNoDelay(true)` (sin algoritmo de Nagle) para que los paquetes salgan inmediatamente.
- `JungleRoom.sse()` agrega el `roomId` a cada evento; el cliente descarta los de otras salas (`onWindow` en `MainScene.ts`).
- `SSEClient.ts` escucha cada tipo de evento y lo reenvía como `CustomEvent` de `window` (`sse-tick`, `sse-shoot`, …); la escena de Phaser reacciona a esos eventos para animar disparos, golpes, explosiones y actualizar a los demás jugadores. Si se corta, reintenta cada 2,5 s.
- El HUD muestra el estado de la conexión y el ping estimado con `telemetry`.

**Por qué.** SSE es simple (HTTP común, reconexión automática del navegador) y alcanza para empujar eventos del servidor. Colyseus (WebSocket) cubre lo bidireccional y la sincronización de estado.

**Archivos.** `server/src/sse.ts`, `JungleRoom.ts` (`sse`, bloque "SSE State Tick" en `update`), `SSEClient.ts`, `NetworkManager.ts`, `MainScene.ts` (`onWindow("sse-…")`).

### 5.13 Render y arte

**Cómo funciona.** Phaser dibuja en WebGL a 60 FPS. Todo está ordenado en **capas de profundidad** (terreno 0, zona 8, arbustos 20, ítems 24, obstáculos 30, mira 50, gatos 60, barras de vida 65, balas 70, minimapa 200). Los sprites de gatos, armas, manos, efectos, ítems y mundo salen de hojas pixel art (PNG + JSON estilo Aseprite) en `client/public/sprites/`, cargadas por `catSprites.ts`. La **variante** de cajas, rocas y árboles sale de un hash del id, así todos ven lo mismo sin enviar nada extra. Para rendimiento se usan *object pools* (200 balas, chispas, estelas) y se dibujan solo los objetos visibles.

**Archivos.** `PhaserGame.ts`, `MainScene.ts`, `catSprites.ts`, `terrain.ts`, `structureArt.ts`, `public/sprites/*`.

### 5.14 Interfaz (React)

**Cómo funciona.** React se usa **solo para lo que está por fuera del canvas**: el menú (`StartScreen`: apodo, 5 skins con rareza, modo y región, guardado en `localStorage`) y el HUD (`UIOverlay`: vida, escudo, arma y munición, cooldown del dash, zona, killfeed, pantalla de victoria). Se comunica con Phaser mediante `CustomEvent` de `window` (por ejemplo `zone-update`, `ammo-update`, `switch-weapon`, `restart-game`).

**Archivos.** `App.tsx`, `StartScreen.tsx`, `UIOverlay.tsx`, `GameplayBackground.tsx`, `PixelPortrait.tsx`, `DebugOverlay.tsx`.

### 5.15 Sonido

Todos los efectos (disparos, explosiones, pasos en agua, golpes) y la música se **sintetizan con Web Audio API**, sin archivos de audio. `SoundManager.ts` expone funciones como `playShoot()` y permite silenciar efectos y música por separado.

---

## 6. Tecnologías y por qué se usan

| Tecnología | Dónde | Por qué |
|---|---|---|
| **TypeScript** (modo estricto) | cliente y servidor | Los mismos tipos y esquemas en ambos lados; detecta errores antes de ejecutar. |
| **Node.js + Express** | servidor | Un solo lenguaje en todo el proyecto; Express expone `/health` y el canal SSE. |
| **Colyseus** | servidor y cliente (`colyseus.js`) | Framework pensado para multijugador autoritativo: maneja salas, WebSocket y **sincronización de estado por deltas** con esquemas. |
| **WebSocket** | Colyseus | Comunicación bidireccional de baja latencia para acciones y estado. |
| **SSE (Server-Sent Events)** | `/api/events` | Empuja eventos del servidor al navegador por HTTP, simple y con reconexión automática. Requisito del enunciado. |
| **Phaser 3** | cliente | Motor 2D para web (WebGL): sprites, cámara, animaciones, física Arcade. |
| **React 18 + Vite** | cliente | React para menús y HUD; Vite da servidor de desarrollo y build rápidos. |
| **Tailwind CSS** | cliente | Estilos rápidos para la interfaz fuera del canvas. |
| **Lucide React** | cliente | Íconos SVG para el HUD. |
| **Web Audio API** | cliente | Sonido generado por código, sin depender de archivos. |
| **Pixel art (PNG + JSON Aseprite)** | `public/sprites` | Arte propio, liviano y coherente. |
| **Git + GitHub** | repo | Control de versiones; ramas por integrante (ej. `alejo`). |
| **Chrome DevTools Protocol** | scripts de prueba | Medir FPS y desfasaje de forma automática. |

**Decisiones de diseño de red**

- **Cliente-servidor autoritativo** (y no peer-to-peer): evita trampas y desincronización, y simplifica las reglas porque hay una sola fuente de verdad.
- **Sin base de datos**: no hay cuentas ni progreso guardado; la partida vive en RAM mientras la sala está abierta.
- **Grilla espacial** (`SpatialHashGrid`, celdas de 500 px): en vez de comparar cada bala con cada jugador, solo se revisan las celdas vecinas.

---

## 7. Herramientas de prueba (archivos de la raíz)

| Archivo | Para qué sirve |
|---|---|
| `test_runner.js` | Suite automática por Chrome DevTools: mueve, rota, dispara con todas las armas, hace dash y cruza el río; graba video con FFmpeg. |
| `check_fps.js`, `check_fps2.js`, `measure_raf.js`, `measure_step.js`, `profile_gameplay.js`, `test_fps.js`, `test_cdp_throttle.js` | Mediciones de FPS y rendimiento. |
| `diag.js`, `diag_scene.js`, `check_tab.js` | Diagnóstico del estado de la escena en una pestaña abierta. |
| `test_suroi_live.js`, `capture_suroi_showcase.js` | Comparación y captura contra Suroi.io. |

Necesitan Chrome abierto con depuración remota en el puerto 9222 y el juego en `localhost:3000`. Algunos tienen rutas fijas de la compu de un compañero (`C:\Users\...`).

---

## 8. Puntos a revisar en el código

Cosas que encontré al armar este documento y conviene discutir en la revisión:

1. **Confianza en la posición del cliente.** El servidor acepta la posición que manda el cliente si está a ≤ 140 px de la suya (`move`). Es cómodo para la fluidez, pero un cliente modificado podría teletransportarse de a saltos.
2. **Dash sin colisión en el camino.** Solo se corrige la posición final.
3. **Código duplicado entre cliente y servidor:** `river.ts`, `structures.ts`, `GameState.ts` y `WEAPON_CONFIGS` (y las velocidades). Hay que mantenerlos a mano iguales. Idea: carpeta `shared/`.
4. **Archivos muy grandes:** `JungleRoom.ts` (~2000 líneas) y `MainScene.ts` (~4700). Candidatos a dividirse (armas, bots, zona, loot, render, input).
5. **Eventos duplicados por dos canales.** Disparos, golpes, dash y explosiones se mandan por Colyseus (`broadcast`) **y** por SSE.
6. **SSE a todas las salas.** `broadcastSSE` escribe a todos los clientes conectados; el filtrado por `roomId` lo hace cada cliente. Con muchas salas sería mejor filtrar en el servidor. Además `/api/events` no tiene autenticación y usa CORS abierto.
7. **Valores viejos en el esquema.** `ZoneState` declara por defecto centro (2400, 2400) y radio 2300, pero `resetZone` lo pisa con (4000, 4000) y 3850.
8. **IA de bots:** el movimiento recorre todos los obstáculos (`state.obstacles.forEach`) en lugar de usar la grilla espacial como el resto.
9. **El servidor no conoce el mar** (`coast.ts` solo en el cliente): se puede caminar por el agua sin consecuencias.
10. **`PROJECT_CONTEXT.md` desactualizado:** mezcla tamaños de mapa (4800 y 8000), el centro de la zona (1000 y 4000), y tiene rutas absolutas de otras computadoras.
11. **Raíz del repo desordenada:** scripts de medición sueltos y carpetas `suroi_*` vacías. Podrían ir a `tools/`.
12. **Carpeta de sprites fuente:** `catSprites.ts` menciona un generador (`python sprites/build.py`) que **no está en el repo**. Si se pierde, no se pueden regenerar las hojas.

---

## 9. Pendientes

(Resumen de la página "Pendientes" de Notion, al 10/10/2026.)

- Dispersión de balas según arma (falta unificar mira vectorial y cantidad de perdigones con TRIPLE).
- Velocidad según el arma en mano.
- Muros, suelo y objetos del mapa en pixel art (hay un avance grande en `docs/pixel-art-mundo.md`).
- Animación del agua.
- Fantasmas: ver dentro de las casas.
- La mira se traba al pasar el mouse sobre el HUD.
- Contador de kills.
- Dash bloqueado por objetos sólidos y paredes.
- Puentes con bordes que no se puedan traspasar.
- Morir al internarse mucho en el mar (diseño en `docs/tecnico-agua-mar.md`).
- Pantalla de carga hasta cargar texturas, con cuenta regresiva 3-2-1.
- Definir si las balas atraviesan a los jugadores.
