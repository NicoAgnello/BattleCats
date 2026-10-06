import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Gato";
  @type("boolean") isBot: boolean = false;
  @type("number") catColor: number = 0;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("number") shield: number = 0;
  @type("number") maxShield: number = 50;
  @type("boolean") isGhost: boolean = false;
  @type("boolean") isHidden: boolean = false;
  @type("number") dashCooldown: number = 0; // remaining s
  @type("number") trapCooldown: number = 0; // remaining s
  @type("number") shootCooldown: number = 0; // remaining s
  @type("number") kills: number = 0;
  @type("string") activeBuff: string = ""; // "SPEED", "TRIPLE", ""
  @type("number") buffTimer: number = 0;
  @type("string") equippedWeapon: string = "LASER"; // "LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"
  @type("string") lastEmote: string = ""; // "🐾", "🔥", "💀", "😎", "😿", "🏆"
  @type("number") emoteTimer: number = 0;
}

export class Projectile extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;
  @type("string") ownerId: string = "";
  @type("number") damage: number = 25;
  @type("number") lifetime: number = 2.0;
  @type("string") projType: string = "LASER"; // "LASER", "PELLET", "SNIPER_BEAM", "GRENADE"
  @type("number") radius: number = 6;
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
  @type("number") x: number = 1000;
  @type("number") y: number = 1000;
  @type("number") currentRadius: number = 950;
  @type("number") targetRadius: number = 950;
  @type("number") phase: number = 1;
  @type("number") timer: number = 15;
  @type("boolean") isShrinking: boolean = false;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: Trap }) traps = new MapSchema<Trap>();
  @type({ map: Bush }) bushes = new MapSchema<Bush>();
  @type({ map: Obstacle }) obstacles = new MapSchema<Obstacle>();
  @type({ map: ItemPickup }) items = new MapSchema<ItemPickup>();
  @type(ZoneState) zone = new ZoneState();
  @type("number") worldWidth: number = 2000;
  @type("number") worldHeight: number = 2000;
  @type("string") status: string = "PLAYING"; // WAITING, PLAYING, VICTORY
  @type("number") aliveCount: number = 1;
  @type("string") winnerId: string = "";
  @type("string") winnerName: string = "";
}
