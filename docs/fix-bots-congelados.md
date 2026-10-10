# Arreglo: bots que se quedaban quietos e "inmunes"

## Qué se veía

Cada tanto, un bot quedaba **quieto** en un lugar. Al pegarle o dispararle no perdía
vida, y a veces perdía el nombre y las barras pero el cuerpo seguía dibujado.

## Qué pasaba en realidad

El bot no era inmune: lo que se veía era una **copia congelada en el cliente**. El bot
real estaba en otro lado, o ya muerto.

1. El servidor tenía un **filtro por distancia** sobre la lista de jugadores
   (`@filterChildren` en `GameState.players`). Un gato a más de 1200 px del jugador
   salía de su lista, y al volver a acercarse se agregaba otra vez.
2. Con ese filtro, Colyseus no siempre avisaba que el gato había salido de la lista,
   pero sí avisaba "se agregó" cuando volvía a entrar.
3. El cliente (`createPlayer`) no verificaba si ese id ya existía y creaba un
   **segundo gato**. El mapa de jugadores pasaba a apuntar al nuevo, y el viejo quedaba
   **huérfano**: en pantalla, congelado donde se lo vio por última vez, sin recibir datos.
4. Los golpes y las balas se calculan en el servidor con la posición real, así que al
   gato huérfano no le pasaba nada.

Además, cada dato del jugador (posición, vida, fantasma…) tenía su propio filtro por
distancia (`@filter`). Lejos de un gato, el cliente se quedaba con sus últimos datos.

## Cómo se detectó

Un cliente automático jugó varios minutos comparando cada segundo lo que mostraba con
el estado real de la sala. Con el filtro, el servidor tenía 7 gatos vivos y el cliente
conocía solo entre 2 y 5. Sin el filtro, el cliente conoce a los 7 todo el tiempo, sin
gatos duplicados ni desfasados.

## Cambios

### Servidor
- **Sin filtro por distancia para los jugadores**: se quitaron `@filterChildren` de
  `players` y los `@filter` de los campos de `Player` (`server/src/rooms/schema/GameState.ts`).
  Son 16 jugadores como máximo, así que el tráfico extra es mínimo. Las balas y las
  trampas conservan su filtro.
- **Eventos SSE por sala**: antes `broadcastSSE` mandaba ticks, disparos, golpes y muertes
  a todos los clientes, de todas las salas. Como los bots se llaman igual en todas las
  salas (`bot_1`…`bot_6`), con dos partidas abiertas se mezclaban sus datos. Ahora
  `JungleRoom` usa `this.sse(...)`, que agrega `roomId` a cada evento.

### Cliente (`client/src/game/scenes/MainScene.ts`)
- `createPlayer`: si el id ya existe, borra el gato viejo antes de crear el nuevo (nunca
  dos gatos con el mismo id).
- `onWindow(...)`: reemplaza a `window.addEventListener` en la escena.
  - Ignora los eventos SSE de otra sala, o los que llegan antes de conectarse.
  - Quita todos los escuchas al cerrar la escena. Antes, al jugar otra partida, seguían
    vivos los de la anterior.
- `updatePlayer`: los fantasmas de otros jugadores nunca vuelven a mostrarse cuando
  llega una actualización del servidor (solo se ve su tumba).
- La copia del schema del cliente (`client/src/game/schema/GameState.ts`) quedó igual que
  la del servidor (sin los `@filter` en `Player`).

## Para probar
- Jugar una partida completa alejándose y volviendo a acercarse a los bots: ninguno
  debería quedar quieto, y todos deben recibir daño.
- Con dos partidas abiertas a la vez (dos navegadores con salas distintas), los bots de
  una no deben aparecer ni moverse en la otra.
