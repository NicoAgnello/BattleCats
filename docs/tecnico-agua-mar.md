# Agua del mar: cubrir y ahogar a los gatos (parte técnica)

## Para qué

Hoy la isla tiene playa y mar, y en el cliente el agua ya **cubre visualmente** al gato
que entra al mar: alrededor se abren anillos de ondas, y el cuerpo se vuelve más
transparente y azulado cuanto más hondo está. Pero el servidor no sabe nada del mar: el gato camina por el agua igual que
por el pasto, sin frenarse y sin peligro.

La idea es que el mar sea un límite natural:
- En la orilla el agua frena al gato.
- Más adentro casi no puede pelear.
- Si queda **cubierto del todo**, se ahoga y muere.

## Estado actual

| Pieza | Dónde | Estado |
|---|---|---|
| Forma de la isla (`islandEdge`) | `client/src/game/coast.ts` | Hecho. Solo en el cliente. |
| Olas: `wavePhase`, `waveFront` | `client/src/game/coast.ts` | Hecho. Solo en el cliente. |
| Profundidad en un punto (`waterDepthAt`, 0..1, incluye la ola) | `client/src/game/coast.ts` | Hecho. Solo en el cliente. |
| Gato cubierto por el agua (visual) | `MainScene.updateWaterCover` | Hecho. |
| Lógica en el servidor (frenar, ahogar) | `server/src/rooms/JungleRoom.ts` | **Falta.** |

`islandEdge(x, y)` es cuánto hacia adentro de la orilla está un punto, en px del mundo:

| `islandEdge` | Zona |
|---|---|
| < 330 | mar |
| 330 a 560 | playa |
| > 560 | pasto |

La ola sube por la arena hasta `islandEdge ≈ 374` y baja hasta `≈ 316`. El ciclo dura 4,2 s y
cada tramo de costa va desfasado.

`waterDepthAt` devuelve `(frenteDeLaOla - islandEdge) / 170`, limitado a 0..1:

| Profundidad | Dónde está el gato |
|---|---|
| 0 | arena seca |
| ~0,3 | justo en la orilla |
| 1 | unos 140 px mar adentro desde la línea de la ola |

## Tareas

### 1. Compartir `coast.ts` con el servidor
- Copiar `client/src/game/coast.ts` a `server/src/rooms/coast.ts`, igual que se hizo con
  `river.ts`: el **mismo código** en los dos lados, con un comentario que lo diga.
- `islandEdge` y `wavePhase` usan un ruido determinista (semillas fijas), así que dan
  el mismo resultado en el cliente y en el servidor.
- En el servidor no hace falta el campo precalculado (`edgeField`): `islandEdge` se
  calcula directo, y es barato porque son 3 consultas de ruido.

### 2. Reloj de olas compartido
- Hoy el cliente usa su propio reloj (`time` de Phaser) para las olas, así que cada
  jugador ve la ola en un momento distinto. Para que lo que se ve coincida con lo que
  decide el servidor:
  - agregar en `GameState` un `@type("number") waveClock` (ms desde que arrancó la sala),
    que el servidor avanza en cada tick;
  - en el cliente, dibujar las olas con `waveClock + (tiempo local desde el último patch)`
    en lugar de `time`.

### 3. Profundidad en el servidor
- En el tick de movimiento (donde hoy está `checkInRiver`, `JungleRoom.ts` ~línea 175):
  `const depth = player.isGhost ? 0 : waterDepthAt(player.x, player.y, this.state.waveClock)`.
- Valores sugeridos para empezar, a ajustar jugando:

| Profundidad | Efecto |
|---|---|
| 0 – 0,3 | Velocidad × 0,85 (como chapotear) |
| 0,3 – 0,7 | Velocidad × 0,6. No puede usar dash. |
| 0,7 – 1 | Velocidad × 0,45. **No puede disparar ni tirar granadas** (nadando). |
| 1 (cubierto) | Arranca el **ahogo** (ver 4). |

- Guardar `player.waterDepth` en el estado (`@type("number")`) para que el cliente lo
  use en la interfaz.

### 4. Ahogarse
- Agregar al jugador `@type("number") breath = 1` (aire, 0..1).
- Mientras `depth >= 1`, `breath -= dt / 2.5`: en unos 2,5 s cubierto se queda sin aire.
  Fuera de ahí, `breath` se recupera rápido (`+= dt / 1`).
- Con `breath <= 0`: `applyDamage(player, 9999, undefined, "Ahogado")`. Así entra por el
  camino normal de muerte (fantasma, tumba, kill feed con causa "Ahogado").
- Opcional, más suave: en lugar de matar de golpe, hacer daño por segundo
  (por ejemplo 35/s) mientras `breath <= 0`.

### 5. Que nada aparezca en el mar
- **Centro de la zona (tormenta):** que no quede en el mar. Hoy el centro es fijo (4000,4000);
  si se vuelve aleatorio, exigir `islandEdge(cx, cy) > 900`.
- **Spawn de jugadores, bots y botín al morir:** si `islandEdge(x, y) < 420`, moverlos hacia
  el centro de la isla hasta que quede en la arena.
- **Botín empujado por explosiones:** mismo chequeo.

### 6. Bots
- En el movimiento de los bots: si el próximo paso tiene `islandEdge < 380`, desviarlos
  hacia el centro (que no se metan al mar ni se ahoguen solos).

### 7. Cliente (interfaz)
- Usar `player.waterDepth` del servidor para el gato propio y los demás, en lugar de
  calcularlo localmente (`updateWaterCover`), una vez que exista el reloj compartido.
- Barra de aire sobre el gato mientras `breath < 1` (pixel art como la de vida, en celeste).
- Sonido de chapoteo y burbujas al hundirse.
- Partículas de agua al correr en la orilla: `surfaceAt` ya devuelve "water" para el río;
  sumar `waterDepthAt > 0`.

### 8. Límites del mapa
- Hoy el servidor limita la posición a 30..7970 (el cuadrado). Con la isla redondeada,
  los gatos pueden entrar al mar por las esquinas, que ahora son mar. Con el ahogo eso
  queda resuelto: el mar profundo pasa a ser el límite.

## Para probar
- Entrar caminando a la playa: aparecen las ondas alrededor del gato y se va volviendo transparente y azulado.
- Seguir mar adentro: la velocidad baja por tramos, deja de poder disparar y, al quedar
  cubierto, la barra de aire baja y muere ahogado.
- Dos clientes en el mismo lugar ven la ola en el mismo momento (reloj compartido).
- Los bots no se meten al mar.
