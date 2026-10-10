import { Schema, type, MapSchema, filter, filterChildren } from "@colyseus/schema";

export type ClientWithSessionId = { sessionId: string } & any;

export const AOI_DISTANCE = 1200;
export const AOI_DISTANCE_SQ = AOI_DISTANCE * AOI_DISTANCE;

export function aoiDistanceFilter<T extends Schema & { x: number; y: number; id?: string; ownerId?: string }>(
  this: T,
  client: ClientWithSessionId,
  value: any,
  root: GameState
): boolean {
  if (!root || !client || !client.sessionId) return true;
  const me = root.players?.get(client.sessionId);
  if (!me) return true;
  if (this.id === client.sessionId || this.ownerId === client.sessionId) return true;
  const dx = this.x - me.x;
  const dy = this.y - me.y;
  return (dx * dx + dy * dy) <= AOI_DISTANCE_SQ;
}

/* Sin filtro por distancia en los gatos (igual que en el servidor, ver ahí el porqué). */
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

  @type("number") dashCooldown: number = 0;
  @type("number") trapCooldown: number = 0;
  @type("number") shootCooldown: number = 0;
  @type("number") kills: number = 0;
  @type("string") activeBuff: string = "";
  @type("number") buffTimer: number = 0;
  @type("string") equippedWeapon: string = "LASER";
  @type("number") ammo: number = 12;
  @type("number") maxAmmo: number = 12;
  @type("number") reserveAmmo: number = 24;
  @type("boolean") isReloading: boolean = false;
  @type("number") reloadTimer: number = 0;
  @type("number") maxReloadTimer: number = 2.0;

  @type("string") lastEmote: string = "";

  @type("number") emoteTimer: number = 0;
}

export class Projectile extends Schema {
  @type("string") id: string = "";

  @filter(aoiDistanceFilter)
  @type("number") x: number = 0;

  @filter(aoiDistanceFilter)
  @type("number") y: number = 0;

  @filter(aoiDistanceFilter)
  @type("number") vx: number = 0;

  @filter(aoiDistanceFilter)
  @type("number") vy: number = 0;

  @type("string") ownerId: string = "";
  @type("number") damage: number = 25;
  @type("number") lifetime: number = 2.0;
  @type("string") projType: string = "LASER";
  @type("number") radius: number = 6;
  @type("number") targetX: number = 0;
  @type("number") targetY: number = 0;
  @type("boolean") isArmed: boolean = false;
}

export class Trap extends Schema {
  @type("string") id: string = "";

  @filter(aoiDistanceFilter)
  @type("number") x: number = 0;

  @filter(aoiDistanceFilter)
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
  @type("string") obstacleType: string = "CRATE";
  @type("number") hp: number = 60;
  @type("number") maxHp: number = 60;
  @type("number") radius: number = 32;
  @type("boolean") destroyed: boolean = false;
}

export class ItemPickup extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") itemType: string = "MEDKIT";
  @type("boolean") active: boolean = true;
  @type("number") respawnTimer: number = 0;
}

export class ZoneState extends Schema {
  @type("number") x: number = 2400;
  @type("number") y: number = 2400;
  @type("number") currentRadius: number = 2300;
  @type("number") targetRadius: number = 2300;
  @type("number") phase: number = 1;
  @type("number") timer: number = 35;
  @type("boolean") isShrinking: boolean = false;
}

export class GameState extends Schema {
  @filterChildren(function (this: GameState, client: ClientWithSessionId, key: string, value: Player) {
    if (!client || !client.sessionId) return true;
    const me = this.players.get(client.sessionId);
    if (!me) return true;
    if (key === client.sessionId) return true;
    const dx = value.x - me.x;
    const dy = value.y - me.y;
    return (dx * dx + dy * dy) <= AOI_DISTANCE_SQ;
  })
  @type({ map: Player }) players = new MapSchema<Player>();

  @filterChildren(function (this: GameState, client: ClientWithSessionId, key: string, value: Projectile) {
    if (!client || !client.sessionId) return true;
    const me = this.players.get(client.sessionId);
    if (!me) return true;
    if (value.ownerId === client.sessionId) return true;
    const dx = value.x - me.x;
    const dy = value.y - me.y;
    return (dx * dx + dy * dy) <= AOI_DISTANCE_SQ;
  })
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();

  @filterChildren(function (this: GameState, client: ClientWithSessionId, key: string, value: Trap) {
    if (!client || !client.sessionId) return true;
    const me = this.players.get(client.sessionId);
    if (!me) return true;
    if (value.ownerId === client.sessionId) return true;
    const dx = value.x - me.x;
    const dy = value.y - me.y;
    return (dx * dx + dy * dy) <= AOI_DISTANCE_SQ;
  })
  @type({ map: Trap }) traps = new MapSchema<Trap>();

  @type({ map: Bush }) bushes = new MapSchema<Bush>();
  @type({ map: Obstacle }) obstacles = new MapSchema<Obstacle>();
  @type({ map: ItemPickup }) items = new MapSchema<ItemPickup>();
  @type(ZoneState) zone = new ZoneState();
  @type("number") worldWidth: number = 8000;
  @type("number") worldHeight: number = 8000;
  @type("string") status: string = "PLAYING";
  @type("number") aliveCount: number = 1;
  @type("string") winnerId: string = "";
  @type("string") winnerName: string = "";
}
