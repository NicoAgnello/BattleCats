# Pixel art del mundo: objetos, estructuras, suelo, agua y zona

Resumen de los cambios para revisar en el juego. Todo usa la misma escala que los
gatos: **1 pixel del sprite = 3 px del mundo**. Las colisiones y la lógica del
servidor no cambiaron, salvo el trazado del río (ver más abajo).

## 1. Objetos sólidos

| Objeto | Variantes | Notas |
|---|---|---|
| Cajas | madera, reforzada (esquinas de metal), militar (verde con franja) | 3 etapas de daño; al romperse quedan restos **de su mismo estilo** |
| Barriles explosivos | rojo con banda de peligro, rojo-naranja con llama | 3 etapas de daño (pierden aceite); al explotar queda mancha quemada, chapas y aceite |
| Rocas | 4 formas (2 con musgo) | Facetas con luz arriba-izquierda y grietas |
| Árboles | 2 palmeras, ceiba (copa abierta con ramas a la vista), lapacho rosa | Sombra alta y lejana para que se lean como árboles y no como arbustos. La copa **tapa a los gatos** (se aclara al pasar por debajo) |
| Arbustos | 8: liso, flores rosas, flores amarillas, oscuro tupido, con bayas rojas, claro con flores blancas, azulado con puntas de hojas, oliva con flores violetas | Cubren la zona de arbusto, nunca quedan recortados, y dos arbustos cercanos no usan el mismo diseño |

- **La variante sale del id del objeto** (`stableHash` en `catSprites.ts`): todos los
  jugadores ven la misma caja o roca en el mismo lugar, sin tocar el servidor.
- Todos tienen contorno oscuro y una sombra proyectada pixel.

## 2. Estructuras (kit reutilizable)

Las casas y búnkers se arman con un **kit de piezas** que se puede combinar para
estructuras nuevas:

- **Pisos (16×16, sin costuras):** madera clara, madera oscura, mármol, hormigón, chapa, laboratorio.
- **Techos (16×16, sin costuras):** tejas rojas, tejas marrones, chapa oxidada, hormigón, paneles, tablas.
- **Muros (tramos de 16 px, 12 de espesor):** ladrillo, troncos, hormigón, blanco, chapa.
  Más esquinas/postes, que también van a los costados de cada puerta.
- **Accesorios:** chimenea, ventilación, claraboya, panel solar, aire acondicionado,
  escotilla, antena, bolsas de arena, felpudo, red de camuflaje.
- **Puente por piezas** (extremo abierto + tramos): ver sección 4.
- **Entradas** frente a cada puerta (`kit-entrada`): escalinata con faroles, porche,
  rampa con franjas de peligro, escalón con luz cian, escalón de troncos con antorchas.
- **Accesorios grandes** (`kit-accesorio-grande`): cúpula de observación y torre de vigía.

Cómo se arma cada tipo (`client/src/game/structureArt.ts`, tabla `STYLES`):

| Tipo | Piso | Muro | Techo | Entrada |
|---|---|---|---|---|
| Mansión | mármol | ladrillo | tejas rojas **a cuatro aguas**, chimeneas y claraboyas | escalinata con faroles |
| Cabaña | madera clara | troncos | tejas marrones a dos aguas, chimenea | porche |
| Fuerte | madera oscura | troncos | **paja** a dos aguas, **torres de vigía** que sobresalen en dos esquinas | troncos con antorchas |
| Búnker | chapa | hormigón | **losas** de hormigón con musgo, cúpula de observación, escotilla, ventilaciones, antena; **terraplén** de tierra apisonada y grava alrededor (es suelo: se camina por encima, no bloquea) | rampa con franjas |
| Almacén | hormigón | chapa | chapa a dos aguas, claraboyas y ventilaciones | rampa con franjas |
| Laboratorio | laboratorio | blanco | paneles con paneles solares, aire y antena | escalón con luz cian |

- Dentro de las casas (piso, umbral y entrada) **no se levantan partículas** al correr
  ni salen hojitas al cruzar la puerta (`onBuildingFloor` en `MainScene.ts`).
- Entre la puerta y la entrada sigue el **piso de la casa** (umbral), sin franja de tierra.
- **Ningún arbusto queda dentro de una casa**: el servidor empuja hacia afuera los
  que se superponían con una estructura (`createStaticBushes` en `JungleRoom.ts`).
- Los techos tienen **alero** que sobresale del muro, faldones con luz y sombra, y
  manchas de desgaste para que no se vea la baldosa repetida.
- Los **muros** se dibujan con huecos en las puertas usando el mismo criterio que el
  servidor. Los obstáculos `WALL` del servidor siguen siendo las colisiones, pero
  ahora son invisibles.
- Se quitaron los carteles vectoriales con el nombre del edificio (sobre el techo y en el piso).
- Para crear una estructura nueva alcanza con agregarla en `structures.ts` (cliente y
  servidor) y elegir su estilo en `STYLES`; para un estilo nuevo, combinar piezas del kit.

## 3. Suelo sin divisiones

El tilemap de baldosas de 80 px (que mostraba la grilla) se reemplazó por **un suelo
pixel art generado al cargar la partida** (`client/src/game/terrain.ts`):

- Pasto con 7 tonos mezclados por tramado (sin bordes duros), **claros** más
  luminosos, **bosques** más oscuros, **prados con flores** de colores, matitas,
  piedritas y parches de tierra.
- **Isla redondeada:** ya no es un cuadrado. Las esquinas tienen radio 1500 y hay
  bahías y cabos suaves (`islandEdge` en `coast.ts`). Nada del mapa quedó en el mar: lo
  más cercano, los árboles de las esquinas, quedó en tierra. El minimapa muestra la
  misma forma y el río curvo.
- **Playa:** mar en degradé, arena mojada y seca que se funde con el pasto. La orilla
  hace curvas amplias en escalones de pixel, sin puntas ni islas de espuma.
- **Olas** (`buildSeaFx` en `terrain.ts`): crestas claras paralelas a la orilla que
  **avanzan hacia la playa**, y una **resaca** que sube por la arena con espuma al
  frente y vuelve a bajar, dejando la arena mojada. Cada tramo de costa va desfasado.
  No hay un sprite por tramo: se calcula cada frame en un solo lienzo del tamaño de la
  cámara a partir de dos campos precalculados (~1,8 ms por frame en la costa, casi nada
  tierra adentro).
- **Gatos en el agua:** a medida que entran al mar, alrededor del gato se abren anillos
  de ondas pixel (cortados) y el cuerpo se vuelve algo transparente y azulado según la
  profundidad y la ola, como visto a través del agua (nada lo tapa por encima). Por ahora
  es solo visual; la lógica de frenar y ahogar está en `docs/tecnico-agua-mar.md`.
- **Decoraciones de playa** (pocas, alguna que otra): conchas abanico, conchitas,
  caracoles, estrellas de mar y algún cangrejito, con su sombrita
  (`decorateBeach` en `terrain.ts`).
- **Caminos de tierra** con bordes irregulares, huellas y piedritas. El camino
  principal serpentea y cambia de ancho.
- **Senderos** desde cada puente y cada puerta: serpentean, cambian un poco de ancho,
  empiezan con **adoquines** que se van salteando y terminan en un final redondeado e
  irregular.
- **Borde gastado** en todos los caminos (`wornDirt` en `terrain.ts`): cuerpo de tierra
  parejo con borde ondulado y **terrones sueltos de 1-3 px** por fuera, donde se gastó
  el pasto (más cerca del borde, más terrones; algunos quedan pegados al camino).
- **Orillas del río** de barro con piedritas.
- Se genera en ~1-2 s al entrar a la partida (una sola vez).

## 4. Agua animada y río curvo

- El río dejó de ser una línea quebrada: ahora es una **curva suave** por los mismos
  puntos, con borde irregular. En la playa se ensancha y **desemboca en el mar**
  (con arena mojada a los lados) en lugar de cortarse en la arena.
- **Puentes:** se arman por piezas (extremo abierto en forma de trompeta con estribo
  de piedra + tramos de tablones + el otro extremo), del largo justo para ir de
  orilla a orilla. Su posición y largo salen del trazado del río (`BRIDGES` en
  `river.ts`), así que el dibujo y la zona sin fricción coinciden siempre.
- El agua tiene **dos capas de ondas pixel que fluyen** (el río baja hacia el sur; el
  océano ondula), recortadas a la forma del río y del mar.
- **Cambio de lógica:** el trazado del río está en `client/src/game/river.ts` y
  `server/src/rooms/river.ts` (**mismo código en los dos**: si se cambia uno, cambiar
  el otro). La fricción del agua usa ese río curvo con un ancho de 60 px para
  cliente y servidor; antes el cliente usaba 52 y el servidor 65, y no coincidían.

## 5. Zona (tormenta)

- El borde ya no es un círculo sólido: **bocanadas de humo pixel violeta desparramadas**
  en una franja (cada una a distinta distancia, tamaño y opacidad, con huecos) marcan el límite, y el resto del humo está **repartido de forma pareja por
  toda la tormenta** (un poco más denso cerca del borde), moviéndose solo.
- El velo violeta de la tormenta es **pixel art**: celdas de 9 px (3 px del sprite) fijas
  en el mundo. El límite no es una línea: es dentado y tramado, con manchones, y las
  celdas recién tomadas brillan un poco. Como las celdas no se mueven, al achicarse la
  zona el borde **avanza celda por celda, comiéndose el terreno**.
  (`updateStormEdge` en `MainScene.ts`; solo dibuja lo que está en cámara, ~0,2 ms por frame.)
- Solo se dibujan las bocanadas que están en cámara (pool de imágenes reutilizadas).

## 6. Daño y vida de los objetos

- **Barra de vida pixel art** igual a la de los gatos, en rojo, con destello blanco
  del tramo perdido. Rocas y árboles (indestructibles) no muestran barra.
- **Cajas:** por debajo de 2/3 de vida se rajan (grietas y una esquina astillada); por
  debajo de 1/3 se parten (agujero, astillas, otra esquina rota y un clavo salido).
- **Barriles:** por debajo de 2/3 se abollan y pierden aceite por un agujero (charquito);
  por debajo de 1/3 tienen más agujeros, perdieron el tapón y el charco es grande.
- **Restos:** quedan en el suelo **por debajo** de los objetos sanos (antes se tapaban)
  y por encima del piso de las casas.

## 7. Arreglo de lógica: garras

- Al agarrar un arma con las garras equipadas ya **no se suelta un ítem de garras**
  en el piso (todos los gatos las tienen siempre). Cambio en `JungleRoom.ts`
  (servidor), en el intercambio de armas.

## Archivos

**Sprites** (herramienta `shooterBR/sprites`, se exportan con `python3 sprites/build.py`):
- `src/mundo.py`: cajas, barriles, rocas, árboles, arbustos.
- `src/estructuras.py`: kit de estructuras, entradas, accesorios grandes y puente por piezas.
- `src/terreno.py`: ondas del agua y humo de la tormenta.

**Juego** (`BattleCats/client`):
- `src/game/terrain.ts` (nuevo): suelo, agua animada, puentes.
- `src/game/river.ts` (nuevo) y `server/src/rooms/river.ts` (nuevo): trazado del río compartido.
- `src/game/structureArt.ts` (nuevo): armado de estructuras con el kit.
- `src/game/catSprites.ts`: carga de los sprites del mundo, variantes estables y piezas del kit.
- `src/game/scenes/MainScene.ts`: obstáculos, arbustos, estructuras, suelo, agua, zona.
- `public/sprites/`: sprites exportados.

Todo tiene respaldo: si un sprite no carga, el juego vuelve al dibujo vectorial anterior.
Las versiones anteriores de los scripts quedaron como `src/mundo_v1.py` y
`src/estructuras_v1.py`; las salidas del puente viejo, en `sprites/out/_respaldo/puente_v1/`.

## Para revisar en el juego

- Los árboles ahora están **por encima** de los gatos (antes por debajo). Si molesta
  para la jugabilidad, se baja en `createObstacle` (depth 70 → 30).
- El suelo se genera al cargar (~1-2 s). En máquinas lentas puede tardar algo más.
- El minimapa sigue siendo el vectorial (es parte del HUD).
- Las etapas de daño y los restos se probaron simulando la vida en el cliente; conviene
  romper alguna caja y barril de verdad en partida.
- **El río pasa por debajo de la mansión** (ya era así en el mapa original): el agua
  sale por los muros norte y sur, y adentro de la mansión el gato sigue frenado por
  el agua. Si se quiere, se puede desviar el río o anular la fricción dentro de las casas.
