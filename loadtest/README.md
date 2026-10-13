# Pruebas de red

Scripts de Node (≥ 22, por el `WebSocket` y `fetch` nativos) que se conectan al servidor como si fueran jugadores. Usan `colyseus.js` de `client/node_modules`, así que antes hay que correr `npm install` en `client/`. El servidor tiene que estar levantado (`cd server && npm run dev`).

| Comando | Qué hace |
|---|---|
| `npm run test:rooms` | Salas privadas de punta a punta: crear, unirse, permisos del anfitrión, código repetido, partida empezada, SSE por sala, cambio de anfitrión, sala llena y código inexistente. |
| `npm run test:mechanics` | Mecánicas básicas (~25 s): inmunidad, daño, cajas, recarga, dash, zona, muerte, victoria y bots. |
| `npm run loadtest` | Carga con 20 jugadores en una sala privada durante 30 s. |

Los tres scripts aceptan `--host` y `--port`. Para probar por la red local se usa la IP de la máquina del servidor, por ejemplo `node loadtest/rooms-test.mjs --host 192.168.0.10`.

## Test de carga

```bash
node loadtest/loadtest.mjs --clients 20 --duration 30            # 1 sala privada, 20 jugadores
node loadtest/loadtest.mjs --clients 10 --rooms 3                # 3 salas en paralelo
node loadtest/loadtest.mjs --clients 16 --mode classic           # modo clásico (con bots)
node loadtest/loadtest.mjs --clients 20 --spread --no-sse        # repartidos por el mapa, sin SSE
```

Cada jugador simulado agarra un arma, se mueve, dispara cada ~0,3 s y abre su stream SSE como un navegador. Se llaman `TEST_*` y el servidor no les aplica daño, así la partida no termina.

El resumen final informa:

- **server**: CPU del proceso, lag del event loop y tiempo promedio de simulación y de armado del patch por tick, sacados de `GET /api/perf`. El tick dura 16,6 ms.
- **perClient**: KB/s por WebSocket y por SSE, patches por segundo y el mayor hueco entre patches.

El script corre en la misma máquina que el servidor y le quita CPU, así que conviene comparar corridas hechas en las mismas condiciones.
