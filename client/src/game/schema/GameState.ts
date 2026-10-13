import { Schema, type, MapSchema } from "@colyseus/schema";

/*
 * COPIA de server/src/rooms/schema/GameState.ts: los campos con @type y su orden
 * tienen que coincidir en los dos lados (los campos sin @type son solo del servidor).
 *
 * Rendimiento con muchos jugadores:
 * - Sin @filter/@filterChildren: con filtros Colyseus codifica el estado una vez por
 *   cliente en cada patch (60/s) y con 20 jugadores el patch pasaba el presupuesto del
 *   tick. Sin filtros se codifica una sola vez y se manda el mismo patch a todos.
 * - Posiciones en float32 (5 bytes en vez de 9; sobra precisión para un mapa de 8000 px).
 * - Los temporizadores exactos que usa la lógica (campos *Left, sin @type) no se
 *   sincronizan: el servidor publica una copia redondeada a lo que muestra el HUD
 *   (décimas o segundos) en onBeforePatch, así cada gato no cambia en todos los ticks.
 */

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Gato";
  @type("boolean") isBot: boolean = false;
  @type("number") catColor: number = 0;

  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") rotation: number = 0;
  @type("float32") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("float32") shield: number = 0;
  @type("number") maxShield: number = 50;
  @type("boolean") isGhost: boolean = false;
  @type("boolean") isHidden: boolean = false;

  // Copias para el HUD (las escribe syncPlayerTimers)
  @type("number") invulnerableTimer: number = 0;
  @type("number") dashCooldown: number = 0;
  @type("number") trapCooldown: number = 0;
  @type("number") kills: number = 0;
  @type("string") activeBuff: string = ""; // "SPEED", "TRIPLE", ""
  @type("number") buffTimer: number = 0;
  @type("string") equippedWeapon: string = "MELEE"; // "LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"
  @type("string") availableWeapons: string = "MELEE";
  @type("number") ammo: number = 999;
  @type("number") maxAmmo: number = 999;
  @type("number") reserveAmmo: number = 0;
  @type("boolean") isReloading: boolean = false;
  @type("number") reloadTimer: number = 0;
  @type("number") maxReloadTimer: number = 2.0;
  @type("string") lastEmote: string = ""; // "🐾", "🔥", "💀", "😎", "😿", "🏆"

  // Solo servidor: valores exactos en segundos
  invulnerableLeft = 0; // invulnerabilidad del inicio de partida
  dashLeft = 0;
  trapLeft = 0;
  shootCooldown = 0;
  buffLeft = 0;
  reloadLeft = 0;
  emoteTimer = 0;
}

/** Copia redondeada de los temporizadores para el HUD (décimas hacia arriba: un
 *  cooldown no figura en 0 mientras todavía corre). */
const tenths = (s: number) => (s > 0 ? Math.ceil(s * 10) / 10 : 0);
export function syncPlayerTimers(p: Player) {
  p.invulnerableTimer = p.invulnerableLeft > 0 ? Math.ceil(p.invulnerableLeft) : 0;
  p.dashCooldown = tenths(p.dashLeft);
  p.trapCooldown = tenths(p.trapLeft);
  p.buffTimer = tenths(p.buffLeft);
  p.reloadTimer = tenths(p.reloadLeft);
}

export class Projectile extends Schema {
  @type("string") id: string = "";
  // Posición de salida: el cliente la avanza con vx/vy (movimiento recto, igual que en
  // el servidor). Solo la granada se sigue publicando al llegar y armarse.
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
  @type("string") ownerId: string = "";
  @type("string") projType: string = "LASER"; // "LASER", "PELLET", "SNIPER_BEAM", "GRENADE"
  @type("float32") targetX: number = 0;
  @type("float32") targetY: number = 0;
  @type("boolean") isArmed: boolean = false;

  // Solo servidor
  px = 0; // posición simulada
  py = 0;
  damage = 25;
  lifetime = 2.0;
  radius = 6;
}

export class Trap extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
  @type("boolean") active: boolean = true;
  @type("number") damage: number = 35;
}

export class Bush extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") width: number = 160;
  @type("number") height: number = 120;
}

export class Obstacle extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") obstacleType: string = "CRATE"; // "CRATE", "BARREL", "BOULDER", "TREE"
  @type("number") hp: number = 60;
  @type("number") maxHp: number = 60;
  @type("number") radius: number = 32;
  @type("boolean") destroyed: boolean = false;
}

export class ItemPickup extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") itemType: string = "MEDKIT"; // "MEDKIT", "SPEED", "TRIPLE", "SHIELD", "SHOTGUN", "SNIPER", "GRENADE"
  @type("boolean") active: boolean = true;
  @type("number") respawnTimer: number = 0;
}

export class ZoneState extends Schema {
  @type("number") x: number = 2400;
  @type("number") y: number = 2400;
  @type("float32") currentRadius: number = 2300;
  @type("float32") targetRadius: number = 2300;
  @type("number") phase: number = 1;
  @type("number") timer: number = 35; // segundos enteros para el HUD (copia de timeLeft)
  @type("boolean") isShrinking: boolean = false;

  timeLeft = 35; // solo servidor
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();

  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();

  @type({ map: Trap }) traps = new MapSchema<Trap>();

  @type({ map: Bush }) bushes = new MapSchema<Bush>();
  @type({ map: Obstacle }) obstacles = new MapSchema<Obstacle>();
  @type({ map: ItemPickup }) items = new MapSchema<ItemPickup>();
  @type(ZoneState) zone = new ZoneState();
  @type("number") worldWidth: number = 8000;
  @type("number") worldHeight: number = 8000;
  @type("string") status: string = "PLAYING"; // WAITING, PLAYING, VICTORY
  @type("number") aliveCount: number = 1;
  @type("string") winnerId: string = "";
  @type("string") winnerName: string = "";
  @type("boolean") isCustomRoom: boolean = false;
  @type("string") roomCode: string = "";
  @type("string") hostId: string = "";
}
