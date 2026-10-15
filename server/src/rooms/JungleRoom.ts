import { Room, Client, ServerError } from "colyseus";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup, Obstacle, syncPlayerTimers } from "./schema/GameState";
import { broadcastRoomSSE, hasRoomSubscribers } from "../sse";
import { SpatialHashGrid } from "../spatial/SpatialHashGrid";
import { STRUCTURES, StructureDef } from "./structures";
import { inRiver } from "./river";
import { perfRoom, perfDispose, record, RoomPerf } from "../perf";

interface MovePayload {
  dx: number;
  dy: number;
  rotation: number;
  x?: number;
  y?: number;
}


interface ShootPayload {
  angle: number;
  targetX?: number;
  targetY?: number;
  angles?: number[];
}

export interface WeaponDef {
  name: string;
  damage: number;
  maxAmmo: number;
  reserveAmmo: number;
  shootCooldown: number;
  reloadTime: number;
  range: number;
  speed: number;
  pellets?: number;
}

export const WEAPON_CONFIGS: Record<string, WeaponDef> = {
  LASER: {
    name: "Pistola Láser",
    damage: 20, // 20 de daño por bala
    maxAmmo: 12, // 12 en recámara
    reserveAmmo: 24, // 2 cargadores de 12
    shootCooldown: 0.3, // cooldown de 0.3s
    reloadTime: 2.0, // recarga de 2s
    range: 480, // alcance visual exacto
    speed: 800,
  },
  SHOTGUN: {
    name: "Escopeta de Caza",
    damage: 15, // cada perdigón de los 5 hace 15 de daño
    pellets: 5,
    maxAmmo: 2, // 2 en recámara
    reserveAmmo: 8, // 4 cargadores de 2
    shootCooldown: 1.0, // cooldown de 1s
    reloadTime: 2.5, // recarga de 2.5s
    range: 310, // alcance de cono exacto
    speed: 680,
  },
  SNIPER: {
    name: "Rifle Sniper",
    damage: 50, // 50 de daño por bala
    maxAmmo: 5, // 5 en recámara
    reserveAmmo: 5, // 1 cargador de 5
    shootCooldown: 0.4, // cooldown de 0.4s entre disparos
    reloadTime: 3.0, // recarga de 3s
    range: 980, // alcance de mira telescópica exacto
    speed: 1400,
  },
  GRENADE: {
    name: "Granadas Tácticas",
    damage: 100, // interna: 100, externa: 70
    maxAmmo: 3, // 3 granadas al recoger
    reserveAmmo: 0,
    shootCooldown: 1.0, // cooldown de 1s
    reloadTime: 0,
    range: 400,
    speed: 500,
  },
  MELEE: {
    name: "Garras Felinas",
    damage: 50, // 50 de daño por arañazo base (1/4 vida si objetivo tiene garras)
    maxAmmo: 999,
    reserveAmmo: 0,
    shootCooldown: 0.5, // cooldown de 0.5s
    reloadTime: 0,
    range: 75,
    speed: 0,
  },
};

export const ITEM_RESPAWN_TIME = 40.0; // Los items reaparecen cada 40 segundos
export const POSSIBLE_LOOT = ["MEDKIT", "SHIELD", "SHOTGUN", "SNIPER", "GRENADE", "SPEED", "TRIPLE", "LASER"];

export interface SegmentCircleHit {
  hit: boolean;
  t: number;      // 0..1
  hitX: number;
  hitY: number;
}

/**
 * Detección Continua de Colisiones (CCD):
 * Determina si el segmento de recta de (x1, y1) a (x2, y2) interseca un círculo con centro (cx, cy) y radio dado.
 * Retorna el punto de contacto más temprano t in [0, 1] y las coordenadas exactas de colisión.
 */
export function lineSegmentCircleHit(
  x1: number, y1: number,
  x2: number, y2: number,
  cx: number, cy: number,
  radius: number
): SegmentCircleHit | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) {
    // Si inicia dentro o en el borde:
    // Si se mueve hacia el centro o tangencial (dot <= 0), colisiona de inmediato
    const dot = dx * fx + dy * fy;
    if (dot <= 0) {
      return { hit: true, t: 0, hitX: x1, hitY: y1 };
    }
    return null;
  }

  const a = dx * dx + dy * dy;
  if (a < 1e-6) {
    return null;
  }

  const b = 2 * (dx * fx + dy * fy);
  const discr = b * b - 4 * a * c;
  if (discr < 0) {
    return null;
  }

  const sqrtDiscr = Math.sqrt(discr);
  const t = (-b - sqrtDiscr) / (2 * a);

  if (t >= -1e-5 && t <= 1) {
    const clampedT = Math.max(0, Math.min(1, t));
    return {
      hit: true,
      t: clampedT,
      hitX: x1 + clampedT * dx,
      hitY: y1 + clampedT * dy,
    };
  }

  return null;
}


export function parseWeaponSlots(availableWeapons: string | undefined): [string, string, string] {
  if (!availableWeapons) return ["", "", "MELEE"];
  const parts = availableWeapons.split(",");
  if (parts.length >= 3) {
    return [parts[0] || "", parts[1] || "", "MELEE"];
  }
  const guns = parts.filter((p) => p && p !== "MELEE");
  return [guns[0] || "", guns[1] || "", "MELEE"];
}

export function formatWeaponSlots(slot1: string, slot2: string): string {
  return `${slot1 || ""},${slot2 || ""},MELEE`;
}

export function hasOnlyClaws(player: Player): boolean {
  const [slot1, slot2] = parseWeaponSlots(player.availableWeapons);
  return !slot1 && !slot2;
}

interface TrapPayload {
  x: number;
  y: number;
}

interface SwitchWeaponPayload {
  weapon: string;
}

interface EmotePayload {
  emote: string;
}

interface BotController {
  id: string;
  changeDirTimer: number;
  targetDx: number;
  targetDy: number;
  dashTimer: number;
  color: number;
}

/** Códigos de las salas privadas abiertas en este proceso (no puede haber dos iguales). */
const activeRoomCodes = new Set<string>();

/** Error al crear una sala privada con un código que ya está en uso. */
export const ROOM_CODE_TAKEN = 4409;

export class JungleRoom extends Room<GameState> {
  maxClients = 16;
  /** Sistema de partición espacial para colisiones O(1) en mapa gigante de 8000x8000 */
  private spatialGrid = new SpatialHashGrid(500, 8000, 8000);
  private projectileIdCounter = 0;
  private trapIdCounter = 0;
  private obstacleIdCounter = 0;
  private itemIdCounter = 0;
  private zonePhaseDuration = 35; // seconds per safe phase (plenty of time for exploration)
  private zoneShrinkDuration = 22; // seconds per shrink transition
  private zoneShrinkTimer = 0;
  private startRadius = 3850;
  private targetRadius = 3850;
  /** Contador interno del lobby (más preciso que el integer sincronizado) */
  private lobbyCountdownLeft = 0;
  /** IDs de sesión que llegaron durante PLAYING y esperan en cola para la próxima partida */
  private spectatorQueueIds: string[] = [];
  /** Timer para auto-iniciar nueva partida tras victoria */
  private victoryTimeout: NodeJS.Timeout | null = null;
  private sseTickCounter = 0;
  private sseFullCounter = 0;
  /** Último estado de cada gato enviado por el tick SSE (para mandar solo cambios). */
  private sseLastSent = new Map<string, string>();

  private playerWeaponAmmo = new Map<string, Record<string, { ammo: number; reserveAmmo: number }>>();
  private itemPickupDelays = new Map<string, number>();
  /** Registro del último vértice/punta de spawn asignado a cada jugador para no repetirlo entre partidas */
  private lastPlayerSpawnIndex = new Map<string, number>();
  /** Vértice inicial reservado para el primer jugador humano en la primera partida */
  private humanInitialVertex = -1;

  private botControllers: Map<string, BotController> = new Map();
  private botNames = [
    "Michi Ninja",
    "Gato Samurái",
    "Garfield 9000",
    "Gatito Feroz",
    "Michi Táctico",
    "Bigotes Letal",
    "Garra Silenciosa",
    "Zarpazo Veloz",
  ];

  /** Evento SSE de esta sala: va solo a los clientes suscriptos a ella. Lleva igual
   *  el roomId (los bots se llaman igual en todas: bot_1..bot_6). */
  private sse(type: string, data: Record<string, unknown>) {
    broadcastRoomSSE(this.roomId, type, { ...data, roomId: this.roomId });
  }

  private perf!: RoomPerf;

  onCreate(options: any) {
    this.setState(new GameState());
    this.perf = perfRoom(this.roomId);

    if (options && (options.isCustom || options.roomCode)) {
      const code = String(options.roomCode || "");
      if (!/^\d{4}$/.test(code)) {
        throw new ServerError(400, "El código de sala debe tener 4 números");
      }
      if (activeRoomCodes.has(code)) {
        throw new ServerError(ROOM_CODE_TAKEN, `Ya existe una sala con el código ${code}`);
      }
      activeRoomCodes.add(code);
      this.maxClients = 20;
      this.state.isCustomRoom = true;
      this.state.roomCode = String(options.roomCode || "");
      this.state.status = "WAITING";
      this.setMetadata({ roomCode: this.state.roomCode, status: "WAITING", isCustom: true });
      console.log(`🏰 Creando Sala Personalizada #${this.state.roomCode} (Límite: 20 jugadores, SIN BOTS)`);
    } else {
      this.maxClients = 16;
      this.state.isCustomRoom = false;
      this.state.status = "WAITING";
      // Initialize Bots (solo en modo clásico)
      this.spawnBots();
    }

    // 60 FPS ultra-low latency patch rate (16.6ms)
    this.setPatchRate(1000 / 60);

    // Initialize static Bushes on map
    this.createStaticBushes();

    // Initialize Obstacles (Wood Crates, Explosive Barrels, Boulders, Trees)
    this.createStaticObstacles();

    // Initialize Item Pickups
    this.createItemPickups();

    // Initialize Zone
    this.resetZone();

    // Register Message Handlers

    // ── Chat General (disponible en lobby y durante partida) ──────────────
    this.onMessage("chat", (client, data: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const text = String(data?.text || "").trim().slice(0, 120);
      if (!text) return;
      this.broadcast("chatMessage", {
        senderId: client.sessionId,
        senderName: player.name,
        text,
        isSpectator: player.isGhost,
      });
    });

    this.onMessage("move", (client, data: MovePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Bloquear movimiento durante el lobby o cuando está aturdido
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;

      if (typeof data.rotation === "number") {
        player.rotation = data.rotation;
      }

      // Calculate speed with buffs
      let baseSpeed = player.isGhost ? 280 : 220;
      if (player.activeBuff === "SPEED") baseSpeed *= 1.4;
      if (!player.isGhost && player.equippedWeapon === "MELEE") {
        baseSpeed *= 1.15; // +15% de velocidad de movimiento al usar las garras
      }
      if (!player.isGhost && this.checkInRiver(player.x, player.y)) {
        baseSpeed *= 0.75; // Suroi-style water movement drag
      }

      let dx = Number(data.dx) || 0;
      let dy = Number(data.dy) || 0;

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        dx /= mag;
        dy /= mag;
      }

      let newX = player.x;
      let newY = player.y;

      // Suroi-style client prediction validation:
      // Si el cliente envía su posición predicha y está dentro del rango físico plausible,
      // la aceptamos para evitar tirones y micro-reconciliaciones bruscas.
      if (typeof data.x === "number" && typeof data.y === "number") {
        const deltaDist = Math.hypot(data.x - player.x, data.y - player.y);
        if (deltaDist <= 140) {
          newX = data.x;
          newY = data.y;
        } else {
          const dt = 1 / 60;
          newX = player.x + dx * baseSpeed * dt;
          newY = player.y + dy * baseSpeed * dt;
        }
      } else {
        const dt = 1 / 60;
        newX = player.x + dx * baseSpeed * dt;
        newY = player.y + dy * baseSpeed * dt;
      }


      // Obstacle collision response con SpatialHashGrid (O(1) celdas adyacentes)
      if (!player.isGhost) {
        const pRadius = 22;
        const nearbyObs = this.spatialGrid.queryRadius(newX, newY, pRadius + 45, ["obstacle"]);
        for (const ent of nearbyObs) {
          const obs = ent.data as Obstacle;
          if (obs.destroyed) continue;
          const dist = Math.hypot(newX - obs.x, newY - obs.y);
          const minDist = pRadius + obs.radius;
          if (dist < minDist && dist > 0) {
            const overlap = minDist - dist;
            const nx = (newX - obs.x) / dist;
            const ny = (newY - obs.y) / dist;
            newX += nx * overlap;
            newY += ny * overlap;
          }
        }
      }

      player.x = Math.max(30, Math.min(this.state.worldWidth - 30, newX));
      player.y = Math.max(30, Math.min(this.state.worldHeight - 30, newY));
      player.isHidden = this.checkIsHidden(player.x, player.y);

      // Actualizar registro en la grilla espacial
      this.spatialGrid.update({
        id: player.id,
        x: player.x,
        y: player.y,
        radius: 22,
        type: "player",
        data: player,
      });
    });

    this.onMessage("debugTeleport", (client, data: { x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof data.x === "number" && typeof data.y === "number") {
        player.x = data.x;
        player.y = data.y;
        player.isHidden = this.checkIsHidden(player.x, player.y);
        this.spatialGrid.update({
          id: player.id,
          x: player.x,
          y: player.y,
          radius: 22,
          type: "player",
          data: player,
        });
      }
    });

    this.onMessage("interact", (client, data: { itemId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost) return;
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;
      this.handlePlayerInteract(player, data?.itemId);
    });

    this.onMessage("dash", (client, data: { dirX?: number; dirY?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.dashLeft > 0) return;
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;

      const isMelee = player.equippedWeapon === "MELEE";
      const cooldown = isMelee ? 1.8 : 2.5;
      const dashDistance = isMelee ? 160 : 120; // 160px para garras (rápido), 120px para roll de arma (más lento pero esquiva)

      let nx = typeof data?.dirX === "number" ? data.dirX : Math.cos(player.rotation);
      let ny = typeof data?.dirY === "number" ? data.dirY : Math.sin(player.rotation);
      const mag = Math.hypot(nx, ny);
      if (mag > 0.001) {
        nx /= mag;
        ny /= mag;
      } else {
        nx = Math.cos(player.rotation);
        ny = Math.sin(player.rotation);
      }

      let targetX = player.x + nx * dashDistance;
      let targetY = player.y + ny * dashDistance;

      // Colisión contra obstáculos en celdas adyacentes usando SpatialHashGrid
      const pRadius = 22;
      const nearbyObs = this.spatialGrid.queryRadius(targetX, targetY, pRadius + 45, ["obstacle"]);
      for (const ent of nearbyObs) {
        const obs = ent.data as Obstacle;
        if (obs.destroyed) continue;
        const dist = Math.hypot(targetX - obs.x, targetY - obs.y);
        const minDist = pRadius + obs.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          targetX += ((targetX - obs.x) / dist) * overlap;
          targetY += ((targetY - obs.y) / dist) * overlap;
        }
      }

      player.x = Math.max(30, Math.min(this.state.worldWidth - 30, targetX));
      player.y = Math.max(30, Math.min(this.state.worldHeight - 30, targetY));
      player.dashLeft = cooldown;

      // Actualizar registro en la grilla espacial
      this.spatialGrid.update({
        id: player.id,
        x: player.x,
        y: player.y,
        radius: 22,
        type: "player",
        data: player,
      });

      this.broadcast("playerDash", {
        id: client.sessionId,
        x: player.x,
        y: player.y,
        dirX: nx,
        dirY: ny,
        isRoll: !isMelee,
        cooldown,
      });
      this.sse("playerDash", {
        id: client.sessionId,
        x: player.x,
        y: player.y,
        dirX: nx,
        dirY: ny,
        isRoll: !isMelee,
        cooldown,
      });
    });

    this.onMessage("reload", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost) return;
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;
      this.startReload(player);
    });

    this.onMessage("shoot", (client, data: ShootPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.shootCooldown > 0) return;
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;
      if (player.isReloading) return;

      const w = player.equippedWeapon || "LASER";
      const cfg = WEAPON_CONFIGS[w] || WEAPON_CONFIGS.LASER;

      // Ammo check: Garras no consume munición
      if (w !== "MELEE") {
        if (player.ammo <= 0) {
          if (player.reserveAmmo > 0 && !player.isReloading) {
            this.startReload(player);
          }
          return;
        }
        player.ammo--;
        this.savePlayerCurrentWeaponAmmo(player);
      }

      const angle = typeof data.angle === "number" ? data.angle : player.rotation;
      this.spawnProjectiles(player, angle, data.targetX, data.targetY, data.angles);
      
      let cooldown = cfg.shootCooldown;
      if (player.activeBuff === "SPEED") cooldown *= 0.7;
      player.shootCooldown = cooldown;

      // Auto-recarga al vaciar recámara si quedan cargadores de reserva
      if (w !== "MELEE" && player.ammo === 0 && player.reserveAmmo > 0) {
        this.startReload(player);
      }
    });

    this.onMessage("switchWeapon", (client, data: SwitchWeaponPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost) return;
      if (this.state.status === "LOBBY") return;
      if (player.stunLeft > 0) return;
      const valid = ["LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"];
      if (valid.includes(data.weapon)) {
        const [slot1, slot2] = parseWeaponSlots(player.availableWeapons);
        if (data.weapon === "MELEE" || data.weapon === slot1 || data.weapon === slot2) {
          this.savePlayerCurrentWeaponAmmo(player);
          this.applyWeaponToPlayer(player, data.weapon);
        }
      }
    });

    this.onMessage("emote", (client, data: EmotePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const emote = String(data.emote || "🐾").slice(0, 4);
      player.lastEmote = emote;
      player.emoteTimer = 2.5;
      this.broadcast("playerEmote", { id: client.sessionId, emote });
    });

    this.onMessage("placeTrap", (client, data: TrapPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isGhost || player.trapLeft > 0) return;
      if (this.state.status === "LOBBY") return;
      // Los gatos que entran en modo espectador (en cola) no pueden usar las trampas
      if (this.spectatorQueueIds.includes(client.sessionId)) return;

      const trap = new Trap();
      trap.id = `trap_${++this.trapIdCounter}_${Date.now()}`;

      let posX = typeof data?.x === "number" ? data.x : player.x;
      let posY = typeof data?.y === "number" ? data.y : player.y;

      // El fantasma solo puede poner trampas en el área a su alrededor (doble de alcance que el cuchillo: 75 * 2 = 150px)
      const maxTrapRange = (WEAPON_CONFIGS.MELEE?.range || 75) * 2;
      const distFromPlayer = Math.hypot(posX - player.x, posY - player.y);
      if (distFromPlayer > maxTrapRange) {
        const angle = Math.atan2(posY - player.y, posX - player.x);
        posX = player.x + Math.cos(angle) * maxTrapRange;
        posY = player.y + Math.sin(angle) * maxTrapRange;
      }

      trap.x = Math.max(40, Math.min(this.state.worldWidth - 40, posX));
      trap.y = Math.max(40, Math.min(this.state.worldHeight - 40, posY));
      trap.ownerId = client.sessionId;
      trap.damage = 0; // Trampas de gatos muertos no causan daño
      trap.active = true;

      this.state.traps.set(trap.id, trap);
      this.spatialGrid.insert({
        id: trap.id,
        x: trap.x,
        y: trap.y,
        radius: 20,
        type: "trap",
        data: trap,
      });
      player.trapLeft = 6.0;
      this.broadcast("trapPlaced", { id: trap.id, x: trap.x, y: trap.y });
    });

    this.onMessage("restart", (client) => {
      console.log(`Match restart requested by ${client.sessionId}`);
      if (this.state.isCustomRoom) {
        if (client.sessionId === this.state.hostId) {
          this.startCustomMatch();
        }
      } else {
        // Solo permitir restart manual si la partida terminó; si hay LOBBY activo, ignorar
        if (this.state.status !== "LOBBY") this.restartMatch();
      }
    });

    this.onMessage("startMatch", (client) => {
      console.log(`Match start requested by ${client.sessionId} in room ${this.state.roomCode}`);
      if (this.state.isCustomRoom) {
        if (client.sessionId === this.state.hostId) {
          this.startCustomMatch();
        } else {
          client.send("error", { message: "Solo el anfitrión puede iniciar la partida" });
        }
      }
    });

    // 60 FPS Game Loop
    this.setSimulationInterval((deltaTime) => {
      const t0 = performance.now();
      this.update(deltaTime / 1000);
      record(this.perf.sim, performance.now() - t0);
    }, 1000 / 60);
  }

  /** Antes de cada patch: copia redondeada de los temporizadores para el HUD. */
  onBeforePatch() {
    this.state.players.forEach(syncPlayerTimers);
    const zone = this.state.zone;
    zone.timer = zone.timeLeft > 0 ? Math.ceil(zone.timeLeft) : 0;
  }

  broadcastPatch() {
    const t0 = performance.now();
    const hasChanges = super.broadcastPatch();
    record(this.perf.patch, performance.now() - t0);
    this.perf.roomCode = this.state.roomCode;
    this.perf.clients = this.clients.length;
    this.perf.players = this.state.players.size;
    this.perf.projectiles = this.state.projectiles.size;
    return hasChanges;
  }

  onDispose() {
    perfDispose(this.roomId);
    if (this.state.isCustomRoom) activeRoomCodes.delete(this.state.roomCode);
  }

  private resetZone() {
    this.startRadius = 3850;
    this.targetRadius = 3850;
    this.zoneShrinkTimer = 0;
    this.state.zone.x = this.state.worldWidth / 2;
    this.state.zone.y = this.state.worldHeight / 2;
    this.state.zone.currentRadius = this.startRadius;
    this.state.zone.targetRadius = this.startRadius;
    this.state.zone.timeLeft = this.zonePhaseDuration;
    this.state.zone.phase = 1;
    this.state.zone.isShrinking = false;
  }

  private applyDamage(player: Player, damage: number, attackerId?: string, weaponName = "Arma") {
    if (player.isGhost) return;
    if (player.invulnerableLeft > 0) return;
    if (player.name && player.name.startsWith("TEST_")) return;

    let finalDmg = damage;
    if (player.shield > 0) {
      const shieldAbsorb = Math.min(player.shield, damage * 0.75);
      player.shield -= shieldAbsorb;
      finalDmg = damage - shieldAbsorb;
    }

    player.hp -= finalDmg;
    if (player.hp <= 0) {
      player.hp = 0;
      player.isGhost = true;

      // Drop loot on death
      this.spawnDeathLoot(player.x, player.y);

      if (attackerId) {
        const killer = this.state.players.get(attackerId);
        // No cuenta matarse solo: la granada y la trampa propias llegan acá con el
        // atacante igual a la víctima.
        if (killer && attackerId !== player.id) killer.kills++;
        const killPayload = {
          killerId: attackerId,
          killerName: killer ? killer.name : "Alguien",
          victimId: player.id,
          victimName: player.name,
          weapon: weaponName,
        };
        this.broadcast("kill", killPayload);
        this.sse("kill", killPayload);
      }


      this.updateAliveCount();
    }
  }

  private spawnDeathLoot(x: number, y: number) {
    const lootTypes = ["MEDKIT", "SHIELD", "SHOTGUN", "SNIPER", "LASER", "GRENADE", "SPEED"];
    const chosen = lootTypes[Math.floor(Math.random() * lootTypes.length)];
    const item = new ItemPickup();
    item.id = `loot_drop_${++this.itemIdCounter}_${Date.now()}`;
    item.x = x + (Math.random() - 0.5) * 40;
    item.y = y + (Math.random() - 0.5) * 40;
    item.itemType = chosen;
    item.active = true;
    item.respawnTimer = 0;
    this.state.items.set(item.id, item);
    this.spatialGrid.insert({
      id: item.id,
      x: item.x,
      y: item.y,
      radius: 24,
      type: "item",
      data: item,
    });
  }

  private initPlayerWeapons(playerId: string) {
    this.playerWeaponAmmo.set(playerId, {
      MELEE: { ammo: 999, reserveAmmo: 0 }, // Garras (única arma inicial)
    } as any);
  }

  private applyWeaponToPlayer(player: Player, weaponKey: string) {
    const store = this.playerWeaponAmmo.get(player.id);
    const cfg = WEAPON_CONFIGS[weaponKey] || WEAPON_CONFIGS.LASER;
    player.equippedWeapon = weaponKey;
    player.maxAmmo = cfg.maxAmmo;
    player.maxReloadTimer = cfg.reloadTime;
    player.isReloading = false;
    player.reloadLeft = 0;

    if (store && store[weaponKey]) {
      player.ammo = store[weaponKey].ammo;
      player.reserveAmmo = store[weaponKey].reserveAmmo;
    } else {
      player.ammo = cfg.maxAmmo;
      player.reserveAmmo = cfg.reserveAmmo;
    }
  }

  private syncPlayerHealthAndShieldCapacity(player: Player, wasOnlyClaws: boolean) {
    const isNowOnlyClaws = hasOnlyClaws(player);
    if (wasOnlyClaws && !isNowOnlyClaws) {
      // Al equipar armas de fuego, pasa de 30 de vida máxima a 100 y desbloquea escudos
      player.maxHp = 100;
      player.hp = Math.min(100, Math.max(player.hp, Math.round((player.hp / 30) * 100)));
      player.maxShield = 50;
    } else if (!wasOnlyClaws && isNowOnlyClaws) {
      // Si solo tiene garras, tiene 30 de vida máxima y no puede tener escudos
      player.maxHp = 30;
      player.hp = Math.min(30, Math.max(1, Math.round((player.hp / 100) * 30)));
      player.shield = 0;
      player.maxShield = 0;
    }
  }

  private dropPlayerEquippedWeapon(player: Player): { weapon: string; x: number; y: number; itemId: string } | null {
    const wasOnlyClaws = hasOnlyClaws(player);
    let [slot1, slot2] = parseWeaponSlots(player.availableWeapons);

    // Determinar qué arma soltar: la que tiene en mano (si no es MELEE),
    // o en su defecto la que tenga guardada en slot1 o slot2
    let weaponToDrop = "";
    if (player.equippedWeapon && player.equippedWeapon !== "MELEE") {
      weaponToDrop = player.equippedWeapon;
    } else if (slot1 && slot1 !== "MELEE") {
      weaponToDrop = slot1;
    } else if (slot2 && slot2 !== "MELEE") {
      weaponToDrop = slot2;
    }

    if (!weaponToDrop || weaponToDrop === "MELEE") {
      return null;
    }

    // Quitar del inventario/slots
    if (slot1 === weaponToDrop) {
      slot1 = "";
    } else if (slot2 === weaponToDrop) {
      slot2 = "";
    }

    // Quitar del almacén de munición
    const store = this.playerWeaponAmmo.get(player.id);
    if (store) {
      delete (store as any)[weaponToDrop];
    }

    player.availableWeapons = formatWeaponSlots(slot1, slot2);

    // Arrojar el arma hacia afuera con impulso (distancia entre 65 y 90 px para que vuele lejos de sus pies)
    const throwAngle = Math.random() * Math.PI * 2;
    const throwDist = 70 + Math.random() * 20; // 70 a 90 px
    const dropX = Math.max(50, Math.min(this.state.worldWidth - 50, player.x + Math.cos(throwAngle) * throwDist));
    const dropY = Math.max(50, Math.min(this.state.worldHeight - 50, player.y + Math.sin(throwAngle) * throwDist));

    // Crear el ítem en el suelo para que pueda ser vuelto a agarrar
    const dropItem = new ItemPickup();
    dropItem.id = `drop_${++this.itemIdCounter}_${Date.now()}`;
    dropItem.x = dropX;
    dropItem.y = dropY;
    dropItem.itemType = weaponToDrop;
    dropItem.active = true;
    dropItem.respawnTimer = 0;
    this.state.items.set(dropItem.id, dropItem);
    this.spatialGrid.insert({
      id: dropItem.id,
      x: dropItem.x,
      y: dropItem.y,
      radius: 24,
      type: "item",
      data: dropItem,
    });

    // Inmunidad de auto-recogida de 2.5s para que no sea absorbida instantáneamente
    this.itemPickupDelays.set(dropItem.id, Date.now() + 2500);

    // Revertir el arma en mano a garras
    this.applyWeaponToPlayer(player, "MELEE");

    // Sincronizar vida máxima y escudo
    this.syncPlayerHealthAndShieldCapacity(player, wasOnlyClaws);

    return {
      weapon: weaponToDrop,
      x: dropX,
      y: dropY,
      itemId: dropItem.id,
    };
  }

  private savePlayerCurrentWeaponAmmo(player: Player) {
    const store = this.playerWeaponAmmo.get(player.id);
    if (store && player.equippedWeapon) {
      store[player.equippedWeapon] = {
        ammo: player.ammo,
        reserveAmmo: player.reserveAmmo,
      };
    }
  }

  private startReload(player: Player) {
    const cfg = WEAPON_CONFIGS[player.equippedWeapon];
    if (!cfg || cfg.reloadTime <= 0) return;
    if (player.isReloading) return;
    if (player.ammo >= player.maxAmmo) return;
    if (player.reserveAmmo <= 0) return;

    player.isReloading = true;
    player.maxReloadTimer = cfg.reloadTime;
    player.reloadLeft = cfg.reloadTime;
    this.broadcast("playerReloading", { id: player.id, duration: cfg.reloadTime });
  }

  /** Las balas no van a la grilla espacial: ninguna consulta las busca y moverlas
   *  ahí en cada tick era costo puro. */
  private addProjectile(proj: Projectile) {
    proj.px = proj.x;
    proj.py = proj.y;
    this.state.projectiles.set(proj.id, proj);
  }

  private spawnProjectiles(player: Player, angle: number, targetX?: number, targetY?: number, customAngles?: number[]) {
    const weapon = player.equippedWeapon;
    const isTriple = player.activeBuff === "TRIPLE";

    if (weapon === "MELEE") {
      // Garras: 50 de daño cada arañazo, alcance gráfico de 75px
      const slashDist = 45;
      const slashX = player.x + Math.cos(angle) * slashDist;
      const slashY = player.y + Math.sin(angle) * slashDist;
      
      const nearbyEnts = this.spatialGrid.queryRadius(slashX, slashY, 75 + 45, ["player", "obstacle"]);
      for (const ent of nearbyEnts) {
        if (ent.type === "player") {
          const target = ent.data as Player;
          if (target.id === player.id || target.isGhost) continue;
          const d = Math.hypot(target.x - slashX, target.y - slashY);
          if (d < 75) {
            // Estando equipado con garras, el daño recibido por otras garras es un cuarto de vida (4 garrazos)
            let clawDamage = 50;
            if (target.equippedWeapon === "MELEE") {
              clawDamage = target.maxHp / 4;
            }
            const isInv = target.invulnerableLeft > 0;
            this.applyDamage(target, clawDamage, player.id, "Garras Felinas");
            this.broadcast("hit", {
              x: target.x,
              y: target.y,
              damage: isInv ? 0 : clawDamage,
              isInvulnerable: isInv,
              victimId: target.id,
              shooterId: player.id,
            });
          }
        } else if (ent.type === "obstacle") {
          const obs = ent.data as Obstacle;
          if (obs.destroyed) continue;
          const d = Math.hypot(obs.x - slashX, obs.y - slashY);
          if (d < 75 + obs.radius) {
            this.damageObstacle(obs, 50, player.id);
          }
        }
      }

      this.broadcast("playerMelee", { id: player.id, x: slashX, y: slashY, angle, damage: 50 });
      this.sse("playerMelee", { id: player.id, x: slashX, y: slashY, angle, damage: 50 });
      return;
    }

    if (weapon === "SHOTGUN") {
      // Escopeta: 5 perdigones, 15 de daño cada perdigón. Alcance 310px. Cooldown 1s, recarga 2.5s.
      // Cadencia y dispersión dentro del área de apuntado (no van por el medio de la mira).
      const pelletCount = isTriple ? 7 : 5;
      const spread = 0.28;
      const range = 310;
      const speed = 680;
      const lifetime = range / speed; // 0.455s -> exactamente termina al llegar a 310px

      let anglesToUse = customAngles;
      if (!anglesToUse || anglesToUse.length !== pelletCount) {
        const blastJitter = (Math.random() - 0.5) * 0.08;
        anglesToUse = [];
        for (let i = 0; i < pelletCount; i++) {
          const offset = (i - (pelletCount - 1) / 2) * (spread / (pelletCount - 1));
          const pelletJitter = (Math.random() - 0.5) * 0.09;
          anglesToUse.push(angle + offset + blastJitter + pelletJitter);
        }
      }

      for (const a of anglesToUse) {
        const proj = new Projectile();
        proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
        proj.x = player.x + Math.cos(a) * 26;
        proj.y = player.y + Math.sin(a) * 26;
        proj.vx = Math.cos(a) * speed;
        proj.vy = Math.sin(a) * speed;
        proj.ownerId = player.id;
        proj.damage = 15; // 15 de daño por perdigón
        proj.lifetime = lifetime;
        proj.projType = "PELLET";
        proj.radius = 4;
        this.addProjectile(proj);
      }
      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SHOTGUN", angles: anglesToUse });
      this.sse("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SHOTGUN", angles: anglesToUse });
      return;
    }

    if (weapon === "SNIPER") {
      // Sniper: 50 de daño por bala. Alcance 980px. Speed 1400. Lifetime = 980 / 1400 = 0.70s.
      const range = 980;
      const speed = 1400;
      const lifetime = range / speed;

      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(angle) * 30;
      proj.y = player.y + Math.sin(angle) * 30;
      proj.vx = Math.cos(angle) * speed;
      proj.vy = Math.sin(angle) * speed;
      proj.ownerId = player.id;
      proj.damage = 50; // 50 de daño por bala
      proj.lifetime = lifetime;
      proj.projType = "SNIPER_BEAM";
      proj.radius = 7;
      this.addProjectile(proj);

      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SNIPER" });
      this.sse("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SNIPER" });
      return;
    }

    if (weapon === "GRENADE") {
      // Granada: Se dirige y se queda justo donde se apunta con el cursor dentro de su límite (400px).
      // Allí titilará 2 segundos y luego explotará.
      const maxRange = 400;
      const cursorX = typeof targetX === "number" ? targetX : (player.x + Math.cos(angle) * 260);
      const cursorY = typeof targetY === "number" ? targetY : (player.y + Math.sin(angle) * 260);
      const rawDist = Math.hypot(cursorX - player.x, cursorY - player.y);
      const clampedDist = Math.max(30, Math.min(maxRange, rawDist));

      const destX = player.x + Math.cos(angle) * clampedDist;
      const destY = player.y + Math.sin(angle) * clampedDist;

      const speed = 500;
      const flightDuration = Math.max(0.08, clampedDist / speed);

      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(angle) * 26;
      proj.y = player.y + Math.sin(angle) * 26;
      proj.vx = (destX - proj.x) / flightDuration;
      proj.vy = (destY - proj.y) / flightDuration;
      proj.ownerId = player.id;
      proj.damage = 100;
      proj.lifetime = flightDuration;
      proj.projType = "GRENADE";
      proj.radius = 10;
      proj.targetX = destX;
      proj.targetY = destY;
      proj.isArmed = false;
      this.addProjectile(proj);

      this.broadcast("playerShoot", {
        id: player.id,
        x: player.x,
        y: player.y,
        angle,
        weapon: "GRENADE",
        targetX: destX,
        targetY: destY
      });
      this.sse("playerShoot", {
        id: player.id,
        x: player.x,
        y: player.y,
        angle,
        weapon: "GRENADE",
        targetX: destX,
        targetY: destY
      });
      return;
    }

    // Default LASER (Pistola): 20 de daño por bala. Alcance 480px. Speed 800. Lifetime = 480 / 800 = 0.60s.
    // Cadencia y dispersión dentro del área del cono de apuntado (no van por el centro).
    const pistolSpread = 0.18;
    const baseAngles = isTriple ? [angle - 0.18, angle, angle + 0.18] : [angle];
    let anglesToUse = customAngles;
    if (!anglesToUse || anglesToUse.length !== baseAngles.length) {
      anglesToUse = baseAngles.map((ba) => ba + (Math.random() - 0.5) * (pistolSpread * (isTriple ? 0.6 : 1.0)));
    }
    const range = 480;
    const speed = 800;
    const lifetime = range / speed;

    for (const a of anglesToUse) {
      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(a) * 28;
      proj.y = player.y + Math.sin(a) * 28;
      proj.vx = Math.cos(a) * speed;
      proj.vy = Math.sin(a) * speed;
      proj.ownerId = player.id;
      proj.damage = 20; // 20 de daño por bala
      proj.lifetime = lifetime;
      proj.projType = "LASER";
      proj.radius = 6;
      this.addProjectile(proj);
    }

    this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "LASER", isTriple, angles: anglesToUse });
    this.sse("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "LASER", isTriple, angles: anglesToUse });
  }

  private damageObstacle(obs: Obstacle, dmg: number, shooterId?: string) {
    if (obs.destroyed) return;
    obs.hp -= dmg;
    if (obs.hp <= 0) {
      obs.hp = 0;
      obs.destroyed = true;
      this.spatialGrid.remove(obs.id);

      if (obs.obstacleType === "BARREL") {
        // Explosive Barrel Detonates!
        this.triggerBarrelExplosion(obs.x, obs.y, shooterId);
      } else if (obs.obstacleType === "CRATE") {
        // Crate drops loot
        this.spawnCrateLoot(obs.x, obs.y);
      }
    }
  }

  private triggerBarrelExplosion(x: number, y: number, shooterId?: string) {
    this.broadcast("explosion", { x, y, radius: 140, type: "BARREL" });
    this.sse("explosion", { x, y, radius: 140, type: "BARREL" });

    // Damage nearby players & obstacles via SpatialHashGrid (O(1))
    const nearby = this.spatialGrid.queryRadius(x, y, 140, ["player", "obstacle"]);
    for (const ent of nearby) {
      if (ent.type === "player") {
        const player = ent.data as Player;
        if (player.isGhost || player.invulnerableLeft > 0) continue;
        if (player.name && player.name.startsWith("TEST_")) continue;
        const dist = Math.hypot(player.x - x, player.y - y);
        if (dist <= 140) {
          // Consumir la totalidad del escudo en caso de tenerlo
          if (player.shield > 0) {
            player.shield = 0;
          }
          // Hará 70 de daño
          this.applyDamage(player, 70, shooterId, "Barril Explosivo");
        }
      } else if (ent.type === "obstacle") {
        const obs = ent.data as Obstacle;
        if (obs.destroyed) continue;
        this.damageObstacle(obs, 100, shooterId);
      }
    }
  }

  private triggerGrenadeExplosion(x: number, y: number, shooterId?: string) {
    // Circunferencia de explosión el doble de grande (radio 280 vs barril 140)
    // Se divide en dos zonas según cercanía: zona interna = 100 de daño, zona externa = 70 de daño
    const innerRadius = 140;
    const outerRadius = 280;

    this.broadcast("explosion", { x, y, radius: outerRadius, innerRadius, type: "GRENADE" });
    this.sse("explosion", { x, y, radius: outerRadius, innerRadius, type: "GRENADE" });

    // Daño a jugadores y obstáculos en las 2 zonas via SpatialHashGrid (O(1))
    const nearby = this.spatialGrid.queryRadius(x, y, outerRadius, ["player", "obstacle"]);
    for (const ent of nearby) {
      if (ent.type === "player") {
        const player = ent.data as Player;
        if (player.isGhost) continue;
        const dist = Math.hypot(player.x - x, player.y - y);
        if (dist <= innerRadius) {
          this.applyDamage(player, 100, shooterId, "Granada (Zona Interna)");
        } else if (dist <= outerRadius) {
          this.applyDamage(player, 70, shooterId, "Granada (Zona Externa)");
        }
      } else if (ent.type === "obstacle") {
        const obs = ent.data as Obstacle;
        if (obs.destroyed) continue;
        const dist = Math.hypot(obs.x - x, obs.y - y);
        if (dist <= innerRadius) {
          this.damageObstacle(obs, 120, shooterId);
        } else if (dist <= outerRadius) {
          this.damageObstacle(obs, 80, shooterId);
        }
      }
    }
  }

  private spawnCrateLoot(x: number, y: number) {
    const chosen = POSSIBLE_LOOT[Math.floor(Math.random() * POSSIBLE_LOOT.length)];

    const item = new ItemPickup();
    item.id = `crate_loot_${++this.itemIdCounter}_${Date.now()}`;
    item.x = x;
    item.y = y;
    item.itemType = chosen;
    item.active = true;
    item.respawnTimer = 0;
    this.state.items.set(item.id, item);
    this.spatialGrid.insert({
      id: item.id,
      x: item.x,
      y: item.y,
      radius: 24,
      type: "item",
      data: item,
    });
  }

  private addSingleBot(index: number, vertexIndex?: number, totalN?: number): Player {
    const botId = `bot_${index + 1}`;
    const existing = this.state.players.get(botId);
    if (existing) return existing;

    const colors = [1, 2, 3, 4, 0, 2, 3, 1];
    const bot = new Player();
    bot.id = botId;
    bot.name = this.botNames[index % this.botNames.length];
    bot.isBot = true;
    bot.catColor = colors[index % colors.length];
    bot.equippedWeapon = "MELEE";
    bot.availableWeapons = ",,MELEE";

    this.initPlayerWeapons(botId);
    this.applyWeaponToPlayer(bot, "MELEE");

    const N = totalN || 8;
    const vIdx = vertexIndex !== undefined ? vertexIndex : (index % N);
    this.lastPlayerSpawnIndex.set(botId, vIdx);

    const centerX = this.state.zone.x;
    const centerY = this.state.zone.y;
    const spawnRadius = 2500;
    const baseAngle = Math.PI / N;
    const angle = baseAngle + (vIdx / N) * 2 * Math.PI;
    const rawX = centerX + Math.cos(angle) * spawnRadius;
    const rawY = centerY + Math.sin(angle) * spawnRadius;
    const [safeX, safeY] = this.getSafeSpawnPosition(rawX, rawY, angle);

    bot.x = safeX;
    bot.y = safeY;
    bot.rotation = Math.atan2(centerY - safeY, centerX - safeX);
    bot.hp = 30;
    bot.maxHp = 30;
    bot.shield = 0;
    bot.maxShield = 0;
    bot.invulnerableLeft = 0;
    bot.isGhost = false;
    bot.isHidden = false;
    bot.kills = 0;

    this.state.players.set(botId, bot);
    this.spatialGrid.insert({
      id: botId,
      x: bot.x,
      y: bot.y,
      radius: 22,
      type: "player",
      data: bot,
    });

    this.botControllers.set(botId, {
      id: botId,
      changeDirTimer: Math.random() * 2,
      targetDx: 0,
      targetDy: 0,
      dashTimer: 4 + Math.random() * 4,
      color: bot.catColor,
    });

    return bot;
  }

  private removeSingleBot(botId: string) {
    this.state.players.delete(botId);
    this.botControllers.delete(botId);
    this.spatialGrid.remove(botId);
    this.lastPlayerSpawnIndex.delete(botId);
    this.playerWeaponAmmo.delete(botId);
  }

  /**
   * Ajusta dinámicamente los bots para que cada partida tenga exactamente 8 personajes completados con bots.
   * - Si hay H personas (H < 8): exactamente (8 - H) bots. Por ejemplo: 5 personas -> 3 bots (total 8).
   * - A partir de 8 personas (H >= 8): 0 bots (todos los jugadores son humanos).
   */
  private adjustBotsForHumans(freedVertex?: number) {
    if (this.state.isCustomRoom) return;

    // Solo se ajusta en fases de preparación / lobby (no a mitad de un tiroteo en PLAYING)
    if (this.state.status !== "WAITING" && this.state.status !== "LOBBY") return;

    const humans = Array.from(this.state.players.values()).filter((p) => !p.isBot && !p.isGhost);
    const humanCount = humans.length;
    const targetBots = Math.max(0, 8 - humanCount);

    const currentBots = Array.from(this.state.players.values()).filter((p) => p.isBot);

    if (currentBots.length > targetBots) {
      // Remover exceso de bots empezando por los de mayor número (bot_7, bot_6...)
      const sortedBots = [...currentBots].sort((a, b) => {
        const numA = parseInt(a.id.replace("bot_", ""), 10) || 0;
        const numB = parseInt(b.id.replace("bot_", ""), 10) || 0;
        return numB - numA;
      });

      const toRemove = currentBots.length - targetBots;
      for (let i = 0; i < toRemove; i++) {
        this.removeSingleBot(sortedBots[i].id);
      }
      console.log(`🤖 Bots ajustados: ${currentBots.length} -> ${targetBots} (Humanos: ${humanCount}, Total personajes: ${humanCount + targetBots})`);
    } else if (currentBots.length < targetBots) {
      // Necesitamos agregar bots para completar
      const existingBotIds = new Set(currentBots.map((b) => b.id));
      const toAdd = targetBots - currentBots.length;
      let added = 0;

      const N = 8;
      const takenVertices = new Set(Array.from(this.lastPlayerSpawnIndex.values()));
      const freeVertices = Array.from({ length: N }, (_, k) => k).filter((k) => !takenVertices.has(k));
      if (freedVertex !== undefined && !freeVertices.includes(freedVertex)) {
        freeVertices.unshift(freedVertex);
      }

      for (let i = 0; i < this.botNames.length && added < toAdd; i++) {
        const candidateId = `bot_${i + 1}`;
        if (!existingBotIds.has(candidateId)) {
          const vIdx = freeVertices[added] !== undefined ? freeVertices[added] : i;
          this.addSingleBot(i, vIdx, N);
          added++;
        }
      }
      console.log(`🤖 Bots ajustados: ${currentBots.length} -> ${targetBots} (Humanos: ${humanCount}, Total personajes: ${humanCount + targetBots})`);
    }

    this.updateAliveCount();
  }

  private spawnBots(count: number = 7) {
    this.botControllers.clear();
    const totalBots = Math.min(count, this.botNames.length);
    const N = 8;
    const centerX = this.state.zone.x;
    const centerY = this.state.zone.y;
    const spawnRadius = 2500;
    const baseAngle = Math.PI / N;

    // Asignar un vértice aleatorio inicial para el primer humano que entrará
    this.humanInitialVertex = Math.floor(Math.random() * N);
    const botVertices = Array.from({ length: N }, (_, k) => k).filter((k) => k !== this.humanInitialVertex);
    // Mezcla aleatoria de las puntas asignadas a los bots
    for (let i = botVertices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [botVertices[i], botVertices[j]] = [botVertices[j], botVertices[i]];
    }

    for (let i = 0; i < totalBots; i++) {
      this.addSingleBot(i, botVertices[i], N);
    }
  }

  onJoin(client: Client, options: any) {
    const playerName = (options && typeof options.name === "string" && options.name.trim()) 
      ? options.name.trim().slice(0, 16) 
      : "Michi Campeón";
    const skinColor = (options && typeof options.skin === "number" && !isNaN(options.skin))
      ? Math.max(0, Math.min(4, Math.floor(options.skin)))   // 5 skins: 0..4
      : 0;

    console.log(`Player connected: ${client.sessionId} (Name: ${playerName}, Skin: ${skinColor})`);

    // ── Sala personalizada (comportamiento sin cambios) ────────────────────
    if (this.state.isCustomRoom) {
      let player = this.state.players.get(client.sessionId);
      if (!player) {
        player = new Player();
        player.id = client.sessionId;
      }
      player.name = playerName;
      player.isBot = false;
      player.catColor = skinColor;

      const N = this.botNames.length + 1;
      const baseAngle = Math.PI / N;
      const vertexIndex = Math.floor(Math.random() * N);
      this.lastPlayerSpawnIndex.set(client.sessionId, vertexIndex);
      const angle = baseAngle + (vertexIndex / N) * 2 * Math.PI;
      const centerX = this.state.zone.x;
      const centerY = this.state.zone.y;
      const spawnRadius = 2500;
      const rawX = centerX + Math.cos(angle) * spawnRadius;
      const rawY = centerY + Math.sin(angle) * spawnRadius;
      const [safeX, safeY] = this.getSafeSpawnPosition(rawX, rawY, angle);
      player.x = safeX; player.y = safeY;
      player.rotation = Math.atan2(centerY - safeY, centerX - safeX);
      player.hp = 30; player.maxHp = 30;
      player.shield = 0; player.maxShield = 0;
      player.invulnerableLeft = 0;
      player.isGhost = false; player.isHidden = false;
      player.kills = 0; player.activeBuff = ""; player.buffLeft = 0;
      player.availableWeapons = ",,MELEE";
      this.initPlayerWeapons(client.sessionId);
      this.applyWeaponToPlayer(player, "MELEE");
      this.state.players.set(client.sessionId, player);
      this.spatialGrid.insert({ id: player.id, x: player.x, y: player.y, radius: 22, type: "player", data: player });
      if (!this.state.hostId || options?.isHost) {
        if (!this.state.hostId) {
          this.state.hostId = client.sessionId;
          console.log(`👑 Anfitrión asignado a: ${client.sessionId} (${player.name})`);
        }
      }
      this.updateAliveCount();
      return;
    }

    // ── Sala Clásica (con bots) ────────────────────────────────────────────
    // Si hay una partida en curso, el jugador entra como fantasma espectador
    // y queda en cola para la próxima partida.
    if (this.state.status === "PLAYING" || this.state.status === "VICTORY") {
      let player = this.state.players.get(client.sessionId);
      if (!player) {
        player = new Player();
        player.id = client.sessionId;
      }
      player.name = playerName;
      player.isBot = false;
      player.catColor = skinColor;

      // Spawn en centro del mapa como espectador ghost
      player.x = this.state.zone.x + (Math.random() - 0.5) * 400;
      player.y = this.state.zone.y + (Math.random() - 0.5) * 400;
      player.rotation = 0;
      player.hp = 0;
      player.maxHp = 30;
      player.shield = 0; player.maxShield = 0;
      player.invulnerableLeft = 0;
      player.isGhost = true;
      player.isHidden = false;
      player.kills = 0; player.activeBuff = ""; player.buffLeft = 0;
      player.availableWeapons = ",,MELEE";
      this.initPlayerWeapons(client.sessionId);
      this.applyWeaponToPlayer(player, "MELEE");
      this.state.players.set(client.sessionId, player);
      this.spatialGrid.insert({ id: player.id, x: player.x, y: player.y, radius: 22, type: "player", data: player });

      // Añadir a la cola de espera si no está ya
      if (!this.spectatorQueueIds.includes(client.sessionId)) {
        this.spectatorQueueIds.push(client.sessionId);
        this.state.spectatorQueue = this.spectatorQueueIds.join(",");
      }

      console.log(`👻 ${playerName} unido como espectador - en cola para la próxima partida (#${this.spectatorQueueIds.length})`);
      // Notificar al cliente que está como espectador en cola
      client.send("spectatorJoined", { queuePosition: this.spectatorQueueIds.length });
      this.updateAliveCount();
      return;
    }

    // ── Estado WAITING o LOBBY: entrar como jugador normal ────────────────
    let player = this.state.players.get(client.sessionId);
    if (!player) {
      player = new Player();
      player.id = client.sessionId;
    }
    player.name = playerName;
    player.isBot = false;
    player.catColor = skinColor;

    // Determinar cantidad de humanos incluyendo al nuevo
    const existingHumans = Array.from(this.state.players.values()).filter((p) => !p.isBot && !p.isGhost && p.id !== client.sessionId);
    const humanCount = existingHumans.length + 1;
    const targetBots = Math.max(0, 8 - humanCount);
    const currentBots = Array.from(this.state.players.values()).filter((p) => p.isBot);

    const N = Math.max(8, humanCount);
    let vertexIndex: number;

    if (currentBots.length > targetBots) {
      // Un bot le cede su lugar a este nuevo humano
      const sortedBots = [...currentBots].sort((a, b) => {
        const numA = parseInt(a.id.replace("bot_", ""), 10) || 0;
        const numB = parseInt(b.id.replace("bot_", ""), 10) || 0;
        return numB - numA;
      });
      const botToReplace = sortedBots[0];
      const botVertex = this.lastPlayerSpawnIndex.get(botToReplace.id);
      this.removeSingleBot(botToReplace.id);
      vertexIndex = botVertex !== undefined ? botVertex : Math.floor(Math.random() * N);
      console.log(`👤 Jugador humano #${humanCount} (${player.name}) reemplaza a ${botToReplace.name} en vértice ${vertexIndex}`);
    } else if (this.humanInitialVertex >= 0) {
      vertexIndex = this.humanInitialVertex;
      this.humanInitialVertex = -1;
    } else {
      const taken = new Set(Array.from(this.lastPlayerSpawnIndex.values()));
      const available = Array.from({ length: N }, (_, k) => k).filter((k) => !taken.has(k));
      vertexIndex = available.length > 0 ? available[0] : Math.floor(Math.random() * N);
    }
    this.lastPlayerSpawnIndex.set(client.sessionId, vertexIndex);

    const baseAngle = Math.PI / N;
    const angle = baseAngle + (vertexIndex / N) * 2 * Math.PI;
    const centerX = this.state.zone.x;
    const centerY = this.state.zone.y;
    const spawnRadius = 2500;
    const rawX = centerX + Math.cos(angle) * spawnRadius;
    const rawY = centerY + Math.sin(angle) * spawnRadius;
    const [safeX, safeY] = this.getSafeSpawnPosition(rawX, rawY, angle);

    player.x = safeX; player.y = safeY;
    player.rotation = Math.atan2(centerY - safeY, centerX - safeX);
    player.hp = 30; player.maxHp = 30;
    player.shield = 0; player.maxShield = 0;
    player.invulnerableLeft = 0;
    player.isGhost = false; player.isHidden = false;
    player.kills = 0; player.activeBuff = ""; player.buffLeft = 0;
    player.availableWeapons = ",,MELEE";
    this.initPlayerWeapons(client.sessionId);
    this.applyWeaponToPlayer(player, "MELEE");

    this.state.players.set(client.sessionId, player);
    this.spatialGrid.insert({ id: player.id, x: player.x, y: player.y, radius: 22, type: "player", data: player });

    // Asegurar balance exacto de bots
    this.adjustBotsForHumans();

    // Si este es el primer jugador real y estamos en WAITING → iniciar countdown de 40s
    if (this.state.status === "WAITING" && humanCount === 1) {
      this.startLobbyCountdown();
    } else {
      if (this.state.status === "LOBBY") {
        client.send("lobbyStart", { countdown: this.state.lobbyCountdown });
      }
      this.updateAliveCount();
    }
  }

  /** Inicia la cuenta regresiva del lobby de 40 segundos. */
  private startLobbyCountdown() {
    this.lobbyCountdownLeft = 40;
    this.state.lobbyCountdown = 40;
    this.state.status = "LOBBY";
    console.log(`⏳ Iniciando countdown de lobby de 40 segundos`);
    this.broadcast("lobbyStart", { countdown: 40 });
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`Player left: ${client.sessionId}`);
    const leavingPlayer = this.state.players.get(client.sessionId);
    const wasHuman = leavingPlayer && !leavingPlayer.isBot && !leavingPlayer.isGhost;
    const freedVertex = this.lastPlayerSpawnIndex.get(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.sseLastSent.delete(client.sessionId);
    this.playerWeaponAmmo.delete(client.sessionId);
    this.spatialGrid.remove(client.sessionId);
    this.lastPlayerSpawnIndex.delete(client.sessionId);

    // Quitar de la cola de espera si estaba
    const qIdx = this.spectatorQueueIds.indexOf(client.sessionId);
    if (qIdx !== -1) {
      this.spectatorQueueIds.splice(qIdx, 1);
      this.state.spectatorQueue = this.spectatorQueueIds.join(",");
    }

    if (this.state.isCustomRoom && client.sessionId === this.state.hostId) {
      const remainingHumans = Array.from(this.state.players.values()).filter(p => !p.isBot && p.id !== client.sessionId);
      if (remainingHumans.length > 0) {
        this.state.hostId = remainingHumans[0].id;
        console.log(`👑 Nuevo anfitrión asignado a: ${this.state.hostId} (${remainingHumans[0].name})`);
      }
    }

    let hasHuman = false;
    for (const [_, p] of this.state.players) {
      if (!p.isBot) {
        hasHuman = true;
        break;
      }
    }
    if (!hasHuman) {
      // Si no quedan humanos, volver a WAITING y cancelar el lobby si lo había
      this.state.status = "WAITING";
      this.lobbyCountdownLeft = 0;
      this.state.lobbyCountdown = 0;
      if (!this.state.isCustomRoom) {
        this.spawnBots(7);
      }
    } else if (!this.state.isCustomRoom && (this.state.status === "WAITING" || this.state.status === "LOBBY") && wasHuman) {
      // Si se fue un humano durante el lobby, reponer bot para mantener exactamente 8 personajes
      this.adjustBotsForHumans(freedVertex);
    }

    this.updateAliveCount();
  }

  private update(dt: number) {
    // ── Countdown del Lobby ───────────────────────────────────────────────
    if (this.state.status === "LOBBY") {
      this.lobbyCountdownLeft -= dt;
      const rounded = Math.ceil(this.lobbyCountdownLeft);
      if (rounded !== this.state.lobbyCountdown) {
        this.state.lobbyCountdown = Math.max(0, rounded);
      }
      if (this.lobbyCountdownLeft <= 0) {
        console.log("🚀 Countdown terminado — iniciando partida");
        this.startMatchFromLobby();
      }
      return;
    }

    if (this.state.status !== "PLAYING") {
      return;
    }

    // 1. Update Bots AI
    this.updateBotsAI(dt);

    // 2. Update Buffs, Cooldowns & Bush Status for Players
    this.state.players.forEach((player) => {
      // Actualizar registro en grilla espacial cada frame
      this.spatialGrid.update({
        id: player.id,
        x: player.x,
        y: player.y,
        radius: 22,
        type: "player",
        data: player,
      });

      if (player.invulnerableLeft > 0) player.invulnerableLeft = Math.max(0, player.invulnerableLeft - dt);
      if (player.dashLeft > 0) player.dashLeft = Math.max(0, player.dashLeft - dt);
      if (player.trapLeft > 0) player.trapLeft = Math.max(0, player.trapLeft - dt);
      if (player.shootCooldown > 0) player.shootCooldown = Math.max(0, player.shootCooldown - dt);
      if (player.stunLeft > 0) player.stunLeft = Math.max(0, player.stunLeft - dt);

      if (player.emoteTimer > 0) {
        player.emoteTimer -= dt;
        if (player.emoteTimer <= 0) player.lastEmote = "";
      }

      // Player reload progress
      if (player.isReloading) {
        player.reloadLeft -= dt;
        if (player.reloadLeft <= 0) {
          const needed = player.maxAmmo - player.ammo;
          const taken = Math.min(needed, player.reserveAmmo);
          player.ammo += taken;
          player.reserveAmmo -= taken;
          player.isReloading = false;
          player.reloadLeft = 0;
          this.savePlayerCurrentWeaponAmmo(player);
          this.broadcast("playerReloadComplete", { id: player.id, ammo: player.ammo, reserveAmmo: player.reserveAmmo });
        }
      }

      // Buffs expiration
      if (player.buffLeft > 0) {
        player.buffLeft -= dt;
        if (player.buffLeft <= 0) {
          player.activeBuff = "";
        }
      }

      // Check Bush or Structure Overlap (Ocultamiento en edificios y arbustos)
      player.isHidden = this.checkIsHidden(player.x, player.y);

      // Zone Damage to Alive Players outside safe circle
      if (!player.isGhost) {
        const distFromZoneCenter = Math.hypot(player.x - this.state.zone.x, player.y - this.state.zone.y);
        if (distFromZoneCenter > this.state.zone.currentRadius) {
          const damageRate = 7.0 + this.state.zone.phase * 3.0;
          this.applyDamage(player, damageRate * dt, undefined, "Niebla Tóxica");
        }
      }
    });

    // 3. Update Item Pickups
    this.updateItems(dt);

    // 4. Update Projectiles & Check Collisions (Players & Obstacles) con SpatialHashGrid
    const projToDelete = new Set<string>();
    this.state.projectiles.forEach((proj, key) => {
      if (proj.projType === "GRENADE") {
        if (!proj.isArmed) {
          proj.x += proj.vx * dt;
          proj.y += proj.vy * dt;
          proj.lifetime -= dt;

          const distToTarget = Math.hypot(proj.x - proj.targetX, proj.y - proj.targetY);
          if (proj.lifetime <= 0 || distToTarget < 14) {
            // Llegó al destino de cursor: se detiene y se arma en el suelo por 2 segundos
            proj.x = proj.targetX;
            proj.y = proj.targetY;
            proj.vx = 0;
            proj.vy = 0;
            proj.isArmed = true;
            proj.lifetime = 2.0; // titilará 2 segundos antes de explotar
          }
        } else {
          // Armada y titilando en el suelo
          proj.lifetime -= dt;
          if (proj.lifetime <= 0) {
            projToDelete.add(key);
            this.triggerGrenadeExplosion(proj.x, proj.y, proj.ownerId);
            return;
          }
        }
        return; // La granada no impacta como bala común mientras viaja ni en el suelo
      }

      // Proyectiles convencionales (LASER, PELLET, SNIPER_BEAM): se simulan en px/py
      // con Continuous Collision Detection (CCD) para evitar atravesar muros o piedras.
      const prevX = proj.px;
      const prevY = proj.py;
      const nextX = prevX + proj.vx * dt;
      const nextY = prevY + proj.vy * dt;
      proj.px = nextX;
      proj.py = nextY;
      proj.lifetime -= dt;

      if (proj.lifetime <= 0 || nextX < 0 || nextX > this.state.worldWidth || nextY < 0 || nextY > this.state.worldHeight) {
        projToDelete.add(key);
        return;
      }

      // Continuous Collision Detection (CCD) a lo largo del segmento (prevX, prevY) -> (nextX, nextY)
      const segMidX = (prevX + nextX) * 0.5;
      const segMidY = (prevY + nextY) * 0.5;
      const segLen = Math.hypot(nextX - prevX, nextY - prevY);
      const queryRadius = segLen * 0.5 + proj.radius + 60; // 60 cubre el radio de cualquier obstáculo (rocas 46, árboles 38, etc.)

      let earliestHit: {
        t: number;
        hitX: number;
        hitY: number;
        type: "obstacle" | "player";
        target: Obstacle | Player;
      } | null = null;

      // 1. Detección continua con Obstáculos (muros, piedras/rocas, cajas, barriles, árboles)
      const nearbyObs = this.spatialGrid.queryRadius(segMidX, segMidY, queryRadius, ["obstacle"]);
      for (const ent of nearbyObs) {
        const obs = ent.data as Obstacle;
        if (!obs || obs.destroyed) continue;
        const hit = lineSegmentCircleHit(prevX, prevY, nextX, nextY, obs.x, obs.y, obs.radius + proj.radius);
        if (hit && (!earliestHit || hit.t < earliestHit.t)) {
          earliestHit = {
            t: hit.t,
            hitX: hit.hitX,
            hitY: hit.hitY,
            type: "obstacle",
            target: obs,
          };
        }
      }

      // 2. Detección continua con Jugadores (radio 26 + radio bala)
      const nearbyPlayers = this.spatialGrid.queryRadius(segMidX, segMidY, queryRadius, ["player"]);
      for (const ent of nearbyPlayers) {
        const player = ent.data as Player;
        if (!player || player.isGhost || player.id === proj.ownerId) continue;
        const hit = lineSegmentCircleHit(prevX, prevY, nextX, nextY, player.x, player.y, 26 + proj.radius);
        if (hit && (!earliestHit || hit.t < earliestHit.t)) {
          earliestHit = {
            t: hit.t,
            hitX: hit.hitX,
            hitY: hit.hitY,
            type: "player",
            target: player,
          };
        }
      }

      // Si hubo impacto en este tick:
      if (earliestHit) {
        projToDelete.add(key);
        proj.px = earliestHit.hitX;
        proj.py = earliestHit.hitY;

        if (earliestHit.type === "obstacle") {
          const obs = earliestHit.target as Obstacle;
          this.damageObstacle(obs, proj.damage, proj.ownerId);
          this.broadcast("hit", { x: earliestHit.hitX, y: earliestHit.hitY, damage: proj.damage });
        } else {
          const player = earliestHit.target as Player;
          const wName = proj.projType === "SNIPER_BEAM" ? "Rifle Sniper" : proj.projType === "PELLET" ? "Escopeta" : "Pistola Láser";
          const isInv = player.invulnerableLeft > 0;
          this.applyDamage(player, proj.damage, proj.ownerId, wName);
          this.broadcast("hit", {
            x: earliestHit.hitX,
            y: earliestHit.hitY,
            damage: isInv ? 0 : proj.damage,
            isInvulnerable: isInv,
            victimId: player.id,
            shooterId: proj.ownerId,
          });
        }
      }
    });

    projToDelete.forEach((id) => this.state.projectiles.delete(id));

    // 5. Check Traps Collisions O(1) usando SpatialHashGrid
    const trapToDelete = new Set<string>();
    this.state.traps.forEach((trap, key) => {
      if (!trap.active) return;

      const nearbyPlayers = this.spatialGrid.queryRadius(trap.x, trap.y, 32, ["player"]);
      for (const ent of nearbyPlayers) {
        if (trapToDelete.has(key)) break;
        const player = ent.data as Player;
        if (player.isGhost) continue;

        const dist = Math.hypot(player.x - trap.x, player.y - trap.y);
        if (dist < 32) {
          trapToDelete.add(key);
          const stunDuration = 1.2;
          player.stunLeft = Math.max(player.stunLeft, stunDuration);
          player.isReloading = false;
          player.reloadLeft = 0;
          const dropData = this.dropPlayerEquippedWeapon(player);
          this.broadcast("trapExplode", { x: trap.x, y: trap.y, victimId: player.id });
          this.broadcast("playerStunned", {
            id: player.id,
            duration: stunDuration,
            droppedWeapon: dropData?.weapon || "",
            dropX: dropData?.x,
            dropY: dropData?.y,
            dropItemId: dropData?.itemId || "",
          });
          break;
        }
      }
    });

    trapToDelete.forEach((id) => {
      this.state.traps.delete(id);
      this.spatialGrid.remove(id);
    });

    // 6. Safe Zone Circle Progression
    this.updateZone(dt);

    // 7. Authoritative SSE State Tick (30Hz, solo si hay clientes SSE en esta sala).
    // Cada tick lleva los gatos que cambiaron desde el anterior; una vez por segundo
    // va la lista completa (para quien se suscribió recién).
    this.sseTickCounter = ((this.sseTickCounter || 0) + 1) % 2;
    if (this.sseTickCounter === 0 && hasRoomSubscribers(this.roomId)) {
      const full = ++this.sseFullCounter % 30 === 0;
      const pList: any[] = [];
      this.state.players.forEach((p) => {
        const entry = {
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          rot: Math.round(p.rotation * 100) / 100,
          hp: Math.round(p.hp),
          shield: Math.round(p.shield),
          w: p.equippedWeapon,
          isGhost: p.isGhost,
        };
        const key = `${entry.x},${entry.y},${entry.rot},${entry.hp},${entry.shield},${entry.w},${entry.isGhost}`;
        if (!full && this.sseLastSent.get(p.id) === key) return;
        this.sseLastSent.set(p.id, key);
        pList.push(entry);
      });
      this.sse("tick", {
        t: Date.now(),
        players: pList,
        zone: {
          x: Math.round(this.state.zone.x),
          y: Math.round(this.state.zone.y),
          r: Math.round(this.state.zone.currentRadius),
        },
      });
    }
  }

  private updateBotsAI(dt: number) {
    this.botControllers.forEach((ctrl) => {
      const bot = this.state.players.get(ctrl.id);
      if (!bot) return;
      if (bot.stunLeft > 0) return;

      if (bot.isGhost) {
        ctrl.dashTimer -= dt;
        if (ctrl.dashTimer <= 0 && bot.trapLeft <= 0) {
          const trap = new Trap();
          trap.id = `trap_${++this.trapIdCounter}_${Date.now()}`;
          trap.x = bot.x;
          trap.y = bot.y;
          trap.ownerId = bot.id;
          trap.active = true;
          this.state.traps.set(trap.id, trap);
          this.spatialGrid.insert({
            id: trap.id,
            x: trap.x,
            y: trap.y,
            radius: 20,
            type: "trap",
            data: trap,
          });
          bot.trapLeft = 7.0;
          ctrl.dashTimer = 8 + Math.random() * 8;
        }
        return;
      }

      const distToZone = Math.hypot(bot.x - this.state.zone.x, bot.y - this.state.zone.y);
      const isOutsideZone = distToZone > this.state.zone.currentRadius * 0.85;

      let nearestEnemy: Player | null = null;
      let minEnemyDist = Infinity;

      // Buscar enemigos cercanos usando SpatialHashGrid en lugar de iterar todo el mapa
      const botStruct = this.checkInStructure(bot.x, bot.y);
      const nearbyEnemies = this.spatialGrid.queryRadius(bot.x, bot.y, 650, ["player"]);
      for (const ent of nearbyEnemies) {
        const p = ent.data as Player;
        if (p.id === bot.id || p.isGhost) continue;
        const pStruct = this.checkInStructure(p.x, p.y);
        if (botStruct !== pStruct) continue; // No ver ni apuntar a través de las paredes del edificio
        if (p.isHidden && !bot.isHidden) {
          const d = Math.hypot(p.x - bot.x, p.y - bot.y);
          if (d > 120) continue;
        }
        const d = Math.hypot(p.x - bot.x, p.y - bot.y);
        if (d < minEnemyDist) {
          minEnemyDist = d;
          nearestEnemy = p;
        }
      }

      ctrl.changeDirTimer -= dt;
      ctrl.dashTimer -= dt;

      if (isOutsideZone) {
        const angleToCenter = Math.atan2(this.state.zone.y - bot.y, this.state.zone.x - bot.x);
        ctrl.targetDx = Math.cos(angleToCenter);
        ctrl.targetDy = Math.sin(angleToCenter);
        bot.rotation = angleToCenter;
      } else if (nearestEnemy && minEnemyDist < 450) {
        const targetAngle = Math.atan2(nearestEnemy.y - bot.y, nearestEnemy.x - bot.x);
        const angleVar = nearestEnemy.isBot ? (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.2;
        bot.rotation = targetAngle + angleVar;

        const isMelee = bot.equippedWeapon === "MELEE";
        const attackRange = isMelee ? 72 : 380;
        if (bot.shootCooldown <= 0 && minEnemyDist < attackRange && bot.invulnerableLeft <= 0) {
          this.spawnProjectiles(bot, bot.rotation);
          bot.shootCooldown = isMelee ? 0.5 : (nearestEnemy.isBot ? (1.6 + Math.random() * 0.8) : (1.0 + Math.random() * 0.5));
        }

        if (isMelee) {
          ctrl.targetDx = Math.cos(targetAngle);
          ctrl.targetDy = Math.sin(targetAngle);
        } else if (minEnemyDist < 140) {
          const perpAngle = targetAngle + Math.PI / 2;
          ctrl.targetDx = Math.cos(perpAngle);
          ctrl.targetDy = Math.sin(perpAngle);
        } else {
          ctrl.targetDx = Math.cos(targetAngle) * 0.8;
          ctrl.targetDy = Math.sin(targetAngle) * 0.8;
        }

        if (ctrl.dashTimer <= 0 && bot.dashLeft <= 0 && minEnemyDist < 200) {
          const isMelee = bot.equippedWeapon === "MELEE";
          const cooldown = isMelee ? 1.8 : 2.5;
          const dashDist = isMelee ? 160 : 120;
          bot.dashLeft = cooldown;
          ctrl.dashTimer = 3.5 + Math.random() * 2.5;

          const dashNx = ctrl.targetDx || Math.cos(bot.rotation);
          const dashNy = ctrl.targetDy || Math.sin(bot.rotation);
          const mag = Math.hypot(dashNx, dashNy) || 1;
          const nx = dashNx / mag;
          const ny = dashNy / mag;

          let targetX = bot.x + nx * dashDist;
          let targetY = bot.y + ny * dashDist;

          const pRadius = 22;
          for (const ent of this.spatialGrid.queryRadius(targetX, targetY, pRadius + 45, ["obstacle"])) {
            const obs = ent.data as Obstacle;
            if (obs.destroyed) continue;
            const dist = Math.hypot(targetX - obs.x, targetY - obs.y);
            const minDist = pRadius + obs.radius;
            if (dist < minDist && dist > 0) {
              const overlap = minDist - dist;
              targetX += ((targetX - obs.x) / dist) * overlap;
              targetY += ((targetY - obs.y) / dist) * overlap;
            }
          }

          bot.x = Math.max(30, Math.min(this.state.worldWidth - 30, targetX));
          bot.y = Math.max(30, Math.min(this.state.worldHeight - 30, targetY));
          this.broadcast("playerDash", {
            id: bot.id,
            x: bot.x,
            y: bot.y,
            dirX: nx,
            dirY: ny,
            isRoll: !isMelee,
            cooldown,
          });
          this.sse("playerDash", {
            id: bot.id,
            x: bot.x,
            y: bot.y,
            dirX: nx,
            dirY: ny,
            isRoll: !isMelee,
            cooldown,
          });
        }
      } else {
        if (ctrl.changeDirTimer <= 0) {
          const wanderAngle = Math.random() * Math.PI * 2;
          ctrl.targetDx = Math.cos(wanderAngle) * 0.7;
          ctrl.targetDy = Math.sin(wanderAngle) * 0.7;
          bot.rotation = wanderAngle;
          ctrl.changeDirTimer = 1.5 + Math.random() * 2;
        }
      }

      let speed = bot.isGhost ? 260 : 190;
      if (bot.activeBuff === "SPEED") speed *= 1.35;
      if (!bot.isGhost && bot.equippedWeapon === "MELEE") speed *= 1.15; // +15% de velocidad para garras

      let nextX = bot.x + ctrl.targetDx * speed * dt;
      let nextY = bot.y + ctrl.targetDy * speed * dt;

      // Bot obstacle collision (misma consulta en la grilla que el movimiento de los jugadores)
      const pRadius = 22;
      for (const ent of this.spatialGrid.queryRadius(nextX, nextY, pRadius + 45, ["obstacle"])) {
        const obs = ent.data as Obstacle;
        if (obs.destroyed) continue;
        const dist = Math.hypot(nextX - obs.x, nextY - obs.y);
        const minDist = pRadius + obs.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          nextX += ((nextX - obs.x) / dist) * overlap;
          nextY += ((nextY - obs.y) / dist) * overlap;
        }
      }

      bot.x = Math.max(30, Math.min(this.state.worldWidth - 30, nextX));
      bot.y = Math.max(30, Math.min(this.state.worldHeight - 30, nextY));
    });

    // Bot-to-bot collision repulsion (prevents stacking)
    const ctrlList = Array.from(this.botControllers.values());
    for (let i = 0; i < ctrlList.length; i++) {
      const b1 = this.state.players.get(ctrlList[i].id);
      if (!b1 || b1.isGhost) continue;
      for (let j = i + 1; j < ctrlList.length; j++) {
        const b2 = this.state.players.get(ctrlList[j].id);
        if (!b2 || b2.isGhost) continue;
        const dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
        if (dist < 36 && dist > 0) {
          const overlap = (36 - dist) * 0.5;
          const nx = (b1.x - b2.x) / dist;
          const ny = (b1.y - b2.y) / dist;
          b1.x += nx * overlap;
          b1.y += ny * overlap;
          b2.x -= nx * overlap;
          b2.y -= ny * overlap;
        }
      }
    }
  }

  public checkInRiver(x: number, y: number): boolean {
    // Río curvo compartido con el cliente (rooms/river.ts); los puentes cruzan sin fricción
    return inRiver(x, y);
  }


  public checkInStructure(px: number, py: number): StructureDef | null {
    for (const s of STRUCTURES) {
      const minX = s.x - s.width / 2 + 15;
      const maxX = s.x + s.width / 2 - 15;
      const minY = s.y - s.height / 2 + 15;
      const maxY = s.y + s.height / 2 - 15;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        return s;
      }
    }
    return null;
  }

  /**
   * Calcula una posición de aparición segura alrededor de (rawX, rawY) asegurando
   * que no aparezca dentro del agua del río, dentro de estructuras ni solapando obstáculos.
   */
  public getSafeSpawnPosition(rawX: number, rawY: number, angle: number): [number, number] {
    let x = rawX;
    let y = rawY;

    // 1. Evitar aparecer en el agua del río (mantener en tierra firme)
    let riverChecks = 0;
    while (this.checkInRiver(x, y) && riverChecks < 15) {
      x += Math.cos(angle) * 70;
      y += Math.sin(angle) * 70;
      riverChecks++;
    }

    // 2. Evitar aparecer dentro de estructuras edilicias (paredes o techos)
    let struct = this.checkInStructure(x, y);
    let structChecks = 0;
    while (struct && structChecks < 15) {
      const radDist = Math.hypot(x - struct.x, y - struct.y) || 1;
      x += ((x - struct.x) / radDist) * 80;
      y += ((y - struct.y) / radDist) * 80;
      struct = this.checkInStructure(x, y);
      structChecks++;
    }

    // 3. Evitar solaparse con obstáculos estáticos (árboles, rocas, barriles, cajas)
    const nearbyObs = this.spatialGrid.queryRadius(x, y, 45, ["obstacle"]);
    for (const ent of nearbyObs) {
      const obs = ent.data as Obstacle;
      if (!obs || obs.destroyed) continue;
      const d = Math.hypot(x - obs.x, y - obs.y);
      if (d < 45 + obs.radius && d > 0) {
        const push = (45 + obs.radius) - d;
        x += ((x - obs.x) / d) * push;
        y += ((y - obs.y) / d) * push;
      }
    }

    // 4. Asegurar que esté dentro de los límites del mapa jugable
    x = Math.max(350, Math.min(this.state.worldWidth - 350, x));
    y = Math.max(350, Math.min(this.state.worldHeight - 350, y));

    return [Math.round(x), Math.round(y)];
  }

  public handlePlayerInteract(player: Player, requestedItemId?: string) {
    let targetItem: ItemPickup | null = null;
    let minDist = 75;
    const playerStruct = this.checkInStructure(player.x, player.y);

    if (requestedItemId && this.state.items.has(requestedItemId)) {
      const it = this.state.items.get(requestedItemId)!;
      if (it.active && this.checkInStructure(it.x, it.y) === playerStruct && Math.hypot(player.x - it.x, player.y - it.y) <= 85) {
        targetItem = it;
      }
    }

    if (!targetItem) {
      this.state.items.forEach((item) => {
        if (!item.active) return;
        if (this.checkInStructure(item.x, item.y) !== playerStruct) return;
        const d = Math.hypot(player.x - item.x, player.y - item.y);
        if (d < minDist) {
          minDist = d;
          targetItem = item;
        }
      });
    }

    if (!targetItem) return;

    const item: ItemPickup = targetItem;
    const isWeapon = ["SHOTGUN", "SNIPER", "GRENADE", "LASER"].includes(item.itemType);

    if (isWeapon) {
      const prevWeapon = player.equippedWeapon;
      this.savePlayerCurrentWeaponAmmo(player);

      let [slot1, slot2] = parseWeaponSlots(player.availableWeapons);
      const isSameGun = (slot1 === item.itemType || slot2 === item.itemType);

      if (isSameGun) {
        // Rellenar munición de reserva para el arma que ya se posee
        const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
        const store = this.playerWeaponAmmo.get(player.id);
        if (store && store[item.itemType]) {
          store[item.itemType].reserveAmmo = Math.min(cfg.reserveAmmo * 2, store[item.itemType].reserveAmmo + cfg.reserveAmmo);
          if (player.equippedWeapon === item.itemType) {
            player.reserveAmmo = store[item.itemType].reserveAmmo;
          }
        }
      } else {
        const wasOnlyClaws = hasOnlyClaws(player);
        if (!slot1) {
          // Espacio 1 vacío: equipar en espacio 1
          slot1 = item.itemType;
          const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
          const store = this.playerWeaponAmmo.get(player.id);
          if (store) {
            store[item.itemType] = {
              ammo: cfg.maxAmmo,
              reserveAmmo: cfg.reserveAmmo,
            };
          }
          player.availableWeapons = formatWeaponSlots(slot1, slot2);
          this.applyWeaponToPlayer(player, item.itemType);
        } else if (!slot2) {
          // Espacio 2 vacío: equipar en espacio 2 (permite llevar ej. pistola y escopeta juntas)
          slot2 = item.itemType;
          const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
          const store = this.playerWeaponAmmo.get(player.id);
          if (store) {
            store[item.itemType] = {
              ammo: cfg.maxAmmo,
              reserveAmmo: cfg.reserveAmmo,
            };
          }
          player.availableWeapons = formatWeaponSlots(slot1, slot2);
          this.applyWeaponToPlayer(player, item.itemType);
        } else {
          // Ambos espacios ocupados: intercambiar el arma equipada con la del suelo
          // (si tiene MELEE equipada, se reemplaza el espacio 1)
          let droppedWeapon = "";
          if (prevWeapon === slot2) {
            droppedWeapon = slot2;
            slot2 = item.itemType;
          } else {
            droppedWeapon = slot1;
            slot1 = item.itemType;
          }

          // Soltar al suelo el arma intercambiada para que se pueda volver a recoger
          if (droppedWeapon && droppedWeapon !== "MELEE") {
            const dropItem = new ItemPickup();
            dropItem.id = `drop_${++this.itemIdCounter}_${Date.now()}`;
            dropItem.x = player.x;
            dropItem.y = player.y;
            dropItem.itemType = droppedWeapon;
            dropItem.active = true;
            dropItem.respawnTimer = 0;
            this.state.items.set(dropItem.id, dropItem);
            this.spatialGrid.insert({
              id: dropItem.id,
              x: dropItem.x,
              y: dropItem.y,
              radius: 24,
              type: "item",
              data: dropItem,
            });
          }

          const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
          const store = this.playerWeaponAmmo.get(player.id);
          if (store) {
            if (droppedWeapon && droppedWeapon !== "MELEE") {
              delete (store as any)[droppedWeapon];
            }
            store[item.itemType] = {
              ammo: cfg.maxAmmo,
              reserveAmmo: cfg.reserveAmmo,
            };
          }
          player.availableWeapons = formatWeaponSlots(slot1, slot2);
          this.applyWeaponToPlayer(player, item.itemType);
        }

        // Sincronizar vida máxima y escudo según si porta armas o va solo con garras
        this.syncPlayerHealthAndShieldCapacity(player, wasOnlyClaws);
      }

      if (item.id.startsWith("drop_")) {
        this.state.items.delete(item.id);
        this.spatialGrid.remove(item.id);
        this.itemPickupDelays.delete(item.id);
      } else {
        item.active = false;
        item.respawnTimer = ITEM_RESPAWN_TIME;
      }
    } else {
      // Consumibles: Si va solo con garras no puede equiparse escudos
      if (item.itemType === "SHIELD" && (hasOnlyClaws(player) || player.maxShield <= 0)) {
        return;
      }

      if (item.id.startsWith("drop_")) {
        this.state.items.delete(item.id);
        this.spatialGrid.remove(item.id);
        this.itemPickupDelays.delete(item.id);
      } else {
        item.active = false;
        item.respawnTimer = ITEM_RESPAWN_TIME;
      }

      if (item.itemType === "MEDKIT") {
        player.hp = Math.min(player.maxHp, player.hp + 40);
      } else if (item.itemType === "SHIELD") {
        player.shield = Math.min(player.maxShield, player.shield + 50);
      } else if (item.itemType === "SPEED") {
        player.activeBuff = "SPEED";
        player.buffLeft = 7.0;
      } else if (item.itemType === "TRIPLE") {
        player.activeBuff = "TRIPLE";
        player.buffLeft = 9.0;
      }
    }

    this.broadcast("itemPicked", {
      id: item.id,
      itemType: item.itemType,
      playerId: player.id,
      playerName: player.name,
      x: item.x,
      y: item.y,
    });
  }

  private updateItems(dt: number) {
    this.state.items.forEach((item) => {
      if (!item.active) {
        item.respawnTimer -= dt;
        if (item.respawnTimer <= 0) {
          // Variar aleatoriamente el item al reaparecer (sin repetir el anterior)
          const choices = POSSIBLE_LOOT.filter((t) => t !== item.itemType);
          item.itemType = choices[Math.floor(Math.random() * choices.length)];
          item.active = true;
        }
        return;
      }

      this.state.players.forEach((player) => {
        if (!item.active || player.isGhost || player.stunLeft > 0) return;
        const delay = this.itemPickupDelays.get(item.id);
        if (delay && Date.now() < delay) return;

        const dist = Math.hypot(player.x - item.x, player.y - item.y);
        if (dist < 34) {
          const isWeapon = ["SHOTGUN", "SNIPER", "GRENADE", "LASER"].includes(item.itemType);

          // Armas: auto-recoger si hay un espacio libre (slot 1 o slot 2) o recargar munición si ya se posee
          if (isWeapon) {
            let [slot1, slot2] = parseWeaponSlots(player.availableWeapons);
            const isSameGun = (slot1 === item.itemType || slot2 === item.itemType);

            if (isSameGun) {
              const cfg = WEAPON_CONFIGS[item.itemType];
              const store = this.playerWeaponAmmo.get(player.id);
              if (cfg && store && store[item.itemType]) {
                if (store[item.itemType].reserveAmmo < cfg.reserveAmmo * 2) {
                  store[item.itemType].reserveAmmo = Math.min(cfg.reserveAmmo * 2, store[item.itemType].reserveAmmo + cfg.reserveAmmo);
                  if (player.equippedWeapon === item.itemType) {
                    player.reserveAmmo = store[item.itemType].reserveAmmo;
                  }
                  if (item.id.startsWith("drop_")) {
                    this.state.items.delete(item.id);
                    this.spatialGrid.remove(item.id);
                    this.itemPickupDelays.delete(item.id);
                  } else {
                    item.active = false;
                    item.respawnTimer = ITEM_RESPAWN_TIME;
                  }
                  this.broadcast("itemPicked", {
                    id: item.id,
                    itemType: item.itemType,
                    playerId: player.id,
                    playerName: player.name,
                    x: item.x,
                    y: item.y,
                  });
                }
              }
            } else if (!slot1) {
              // Auto-recoger en Slot 1 vacío
              const wasOnlyClaws = hasOnlyClaws(player);
              if (item.id.startsWith("drop_")) {
                this.state.items.delete(item.id);
                this.spatialGrid.remove(item.id);
                this.itemPickupDelays.delete(item.id);
              } else {
                item.active = false;
                item.respawnTimer = ITEM_RESPAWN_TIME;
              }
              this.savePlayerCurrentWeaponAmmo(player);
              slot1 = item.itemType;
              const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
              const store = this.playerWeaponAmmo.get(player.id);
              if (store) {
                store[item.itemType] = {
                  ammo: cfg.maxAmmo,
                  reserveAmmo: cfg.reserveAmmo,
                };
              }
              player.availableWeapons = formatWeaponSlots(slot1, slot2);
              this.applyWeaponToPlayer(player, item.itemType);
              this.syncPlayerHealthAndShieldCapacity(player, wasOnlyClaws);
              this.broadcast("itemPicked", {
                id: item.id,
                itemType: item.itemType,
                playerId: player.id,
                playerName: player.name,
                x: item.x,
                y: item.y,
              });
            } else if (!slot2) {
              // Auto-recoger en Slot 2 vacío (permite llevar 2 armas a la vez)
              const wasOnlyClaws = hasOnlyClaws(player);
              if (item.id.startsWith("drop_")) {
                this.state.items.delete(item.id);
                this.spatialGrid.remove(item.id);
                this.itemPickupDelays.delete(item.id);
              } else {
                item.active = false;
                item.respawnTimer = ITEM_RESPAWN_TIME;
              }
              this.savePlayerCurrentWeaponAmmo(player);
              slot2 = item.itemType;
              const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
              const store = this.playerWeaponAmmo.get(player.id);
              if (store) {
                store[item.itemType] = {
                  ammo: cfg.maxAmmo,
                  reserveAmmo: cfg.reserveAmmo,
                };
              }
              player.availableWeapons = formatWeaponSlots(slot1, slot2);
              this.applyWeaponToPlayer(player, item.itemType);
              this.syncPlayerHealthAndShieldCapacity(player, wasOnlyClaws);
              this.broadcast("itemPicked", {
                id: item.id,
                itemType: item.itemType,
                playerId: player.id,
                playerName: player.name,
                x: item.x,
                y: item.y,
              });
            }
            // Si ambos slots están llenos, no intercambia al caminar encima: requiere pulsar F voluntariamente
            return;
          }

          // Consumables: auto-consume if needed
          let picked = false;
          if (item.itemType === "MEDKIT" && player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + 40);
            picked = true;
          } else if (item.itemType === "SHIELD" && player.shield < player.maxShield) {
            if (hasOnlyClaws(player) || player.maxShield <= 0) {
              return; // no pueden equiparse escudos si van solo con garras
            }
            player.shield = Math.min(player.maxShield, player.shield + 50);
            picked = true;
          } else if (item.itemType === "SPEED") {
            player.activeBuff = "SPEED";
            player.buffLeft = 7.0;
            picked = true;
          } else if (item.itemType === "TRIPLE") {
            player.activeBuff = "TRIPLE";
            player.buffLeft = 9.0;
            picked = true;
          }

          if (picked) {
            if (item.id.startsWith("drop_")) {
              this.state.items.delete(item.id);
              this.spatialGrid.remove(item.id);
              this.itemPickupDelays.delete(item.id);
            } else {
              item.active = false;
              item.respawnTimer = ITEM_RESPAWN_TIME;
            }
            this.broadcast("itemPicked", {
              id: item.id,
              itemType: item.itemType,
              playerId: player.id,
              playerName: player.name,
              x: item.x,
              y: item.y,
            });
          }
        }
      });
    });
  }

  private updateAliveCount() {
    let alive = 0;
    let lastAlivePlayer: Player | null = null;

    for (const [_, p] of this.state.players) {
      if (!p.isGhost) {
        alive++;
        lastAlivePlayer = p;
      }
    }

    this.state.aliveCount = alive;

    if (this.state.status === "PLAYING" && this.state.players.size > 1 && alive === 1 && lastAlivePlayer) {
      this.state.status = "VICTORY";
      this.state.winnerId = lastAlivePlayer.id;
      this.state.winnerName = lastAlivePlayer.name;

      console.log(`🏆 Match Finished! Winner: ${lastAlivePlayer.name} (${lastAlivePlayer.id})`);
      this.broadcast("matchVictory", {
        winnerId: lastAlivePlayer.id,
        winnerName: lastAlivePlayer.name,
        kills: lastAlivePlayer.kills,
      });

      // Auto-iniciar la nueva partida tras 8s de celebración para dar paso a los espectadores en cola
      if (!this.state.isCustomRoom) {
        if (this.victoryTimeout) clearTimeout(this.victoryTimeout);
        this.victoryTimeout = setTimeout(() => {
          if (this.state.status === "VICTORY") {
            console.log("🔄 Auto-iniciando nueva partida tras victoria para integrar a la cola de espera...");
            this.restartMatch();
          }
        }, 8000);
      }
    }
  }

  /** Se llama cuando la cuenta regresiva del lobby (40s) termina: arranca la partida activa */
  private startMatchFromLobby() {
    this.adjustBotsForHumans();
    this.state.status = "PLAYING";
    this.state.lobbyCountdown = 0;
    this.lobbyCountdownLeft = 0;
    // 15 segundos de invulnerabilidad inicial al comenzar la acción
    this.state.players.forEach((player) => {
      if (!player.isGhost) {
        player.invulnerableLeft = 15.0;
      }
    });
    this.updateAliveCount();
    this.broadcast("matchStarted", {});
    console.log("🚀 Partida iniciada tras la cuenta regresiva del lobby!");
  }

  /** Genera una permutación aleatoria de vértices de spawn (0..N-1) garantizando que
   * ningún jugador repita la punta/spawnpoint que tuvo en la partida anterior. */
  private generateNonRepeatingSpawnIndices(players: Player[], N: number): number[] {
    if (N <= 1) return [0];

    const baseIndices = Array.from({ length: N }, (_, idx) => idx);

    // Intentamos hasta 100 permutaciones aleatorias (derangement respecto a la partida previa)
    for (let attempt = 0; attempt < 100; attempt++) {
      const perm = [...baseIndices];
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }

      // Verificamos si algún jugador repite su spawnpoint previo
      let hasRepeat = false;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const lastIdx = this.lastPlayerSpawnIndex.get(p.id);
        if (lastIdx !== undefined && perm[i] === lastIdx) {
          hasRepeat = true;
          break;
        }
      }

      if (!hasRepeat) {
        return perm;
      }
    }

    // Respaldo garantizado: desplazar si la búsqueda aleatoria se agotó
    const perm = [...baseIndices];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const lastIdx = this.lastPlayerSpawnIndex.get(p.id);
      if (lastIdx !== undefined && perm[i] === lastIdx) {
        const swapWith = (i + 1) % N;
        [perm[i], perm[swapWith]] = [perm[swapWith], perm[i]];
      }
    }
    return perm;
  }

  private restartMatch() {
    if (this.victoryTimeout) {
      clearTimeout(this.victoryTimeout);
      this.victoryTimeout = null;
    }

    this.resetZone();
    this.state.winnerId = "";
    this.state.winnerName = "";
    this.state.projectiles.clear();
    this.state.traps.clear();
    this.itemPickupDelays.clear();

    // Limpiar y repoblar la grilla espacial autoritativa
    this.spatialGrid.clear();

    // Reset obstacles
    this.state.obstacles.forEach((obs) => {
      obs.destroyed = false;
      obs.hp = obs.maxHp;
      this.spatialGrid.insert({
        id: obs.id,
        x: obs.x,
        y: obs.y,
        radius: obs.radius,
        type: "obstacle",
        data: obs,
      });
    });

    // Respawn all items
    this.state.items.forEach((item) => {
      item.active = true;
      item.respawnTimer = 0;
      this.spatialGrid.insert({
        id: item.id,
        x: item.x,
        y: item.y,
        radius: 24,
        type: "item",
        data: item,
      });
    });

    // Promover jugadores en cola de espera a participantes activos
    const queued = [...this.spectatorQueueIds];
    this.spectatorQueueIds = [];
    this.state.spectatorQueue = "";
    queued.forEach((id) => {
      const qp = this.state.players.get(id);
      if (qp) qp.isGhost = false; // se revive abajo con reposition completo
    });

    // Ajustar bots para que la nueva partida tenga exactamente 8 personajes completados con bots
    this.adjustBotsForHumans();

    // Revive and reposition all players symmetrically in a regular polygon (e.g. octagon for 8 players)
    const allPlayers = Array.from(this.state.players.values());
    const humans = allPlayers.filter((p) => !p.isBot && !p.isGhost);
    const bots = allPlayers.filter((p) => p.isBot);
    const orderedPlayers = [...humans, ...bots];
    const N = orderedPlayers.length || 8;
    const centerX = this.state.zone.x;
    const centerY = this.state.zone.y;
    const spawnRadius = 2500;
    const baseAngle = Math.PI / N;

    // Asignar puntas/vértices aleatorios garantizando que ningún jugador repita la de la partida anterior
    const spawnIndices = this.generateNonRepeatingSpawnIndices(orderedPlayers, N);

    orderedPlayers.forEach((player, i) => {
      const vertexIndex = spawnIndices[i];
      this.lastPlayerSpawnIndex.set(player.id, vertexIndex);

      const angle = baseAngle + (vertexIndex / N) * 2 * Math.PI;
      const rawX = centerX + Math.cos(angle) * spawnRadius;
      const rawY = centerY + Math.sin(angle) * spawnRadius;
      const [safeX, safeY] = this.getSafeSpawnPosition(rawX, rawY, angle);

      player.x = safeX;
      player.y = safeY;
      player.rotation = Math.atan2(centerY - safeY, centerX - safeX);
      player.hp = 30;
      player.maxHp = 30;
      player.shield = 0;
      player.maxShield = 0;
      player.invulnerableLeft = 0; // se activará al comenzar la partida tras el lobby
      player.availableWeapons = ",,MELEE";
      this.initPlayerWeapons(player.id);
      this.applyWeaponToPlayer(player, "MELEE");
      player.isGhost = false;
      player.isHidden = false;
      player.kills = 0;
      player.activeBuff = "";
      player.buffLeft = 0;
      player.dashLeft = 0;
      player.shootCooldown = 0;
      player.trapLeft = 0;
      player.stunLeft = 0;

      this.spatialGrid.insert({
        id: player.id,
        x: player.x,
        y: player.y,
        radius: 22,
        type: "player",
        data: player,
      });
    });

    // Notificar a los que venían en cola que ya están en la partida
    if (queued.length > 0) {
      this.broadcast("queuePromotion", { count: queued.length });
      console.log(`✅ ${queued.length} jugadores de la cola promovidos a la nueva partida`);
    }

    this.updateAliveCount();
    this.broadcast("matchRestarted", {});

    // Iniciar cuenta regresiva de 40s del lobby para la nueva partida
    this.startLobbyCountdown();
  }

  private startCustomMatch() {
    this.resetZone();
    this.state.status = "PLAYING";
    this.state.winnerId = "";
    this.state.winnerName = "";
    this.state.projectiles.clear();
    this.state.traps.clear();
    this.spatialGrid.clear();
    this.setMetadata({ roomCode: this.state.roomCode, status: "PLAYING", isCustom: true });
    // Con la partida empezada no entra nadie más (aparecía vivo a mitad de ronda). Al
    // terminar todos vuelven al menú, así que la sala no se vuelve a abrir.
    this.lock();

    // Reset obstacles
    this.state.obstacles.forEach((obs) => {
      obs.destroyed = false;
      obs.hp = obs.maxHp;
      this.spatialGrid.insert({
        id: obs.id,
        x: obs.x,
        y: obs.y,
        radius: obs.radius,
        type: "obstacle",
        data: obs,
      });
    });

    // Respawn all items
    this.state.items.forEach((item) => {
      item.active = true;
      item.respawnTimer = 0;
      this.spatialGrid.insert({
        id: item.id,
        x: item.x,
        y: item.y,
        radius: 24,
        type: "item",
        data: item,
      });
    });

    // Revive and reposition all human players symmetrically in a regular polygon (N-gon)
    const humans = Array.from(this.state.players.values()).filter((p) => !p.isBot);
    const N = humans.length || 1;
    const centerX = this.state.zone.x;
    const centerY = this.state.zone.y;
    const spawnRadius = 2500;
    const baseAngle = Math.PI / N;

    const spawnIndices = this.generateNonRepeatingSpawnIndices(humans, N);

    humans.forEach((player, i) => {
      const vertexIndex = spawnIndices[i];
      this.lastPlayerSpawnIndex.set(player.id, vertexIndex);

      const angle = baseAngle + (vertexIndex / N) * 2 * Math.PI;
      const rawX = centerX + Math.cos(angle) * spawnRadius;
      const rawY = centerY + Math.sin(angle) * spawnRadius;
      const [safeX, safeY] = this.getSafeSpawnPosition(rawX, rawY, angle);

      player.x = safeX;
      player.y = safeY;
      player.rotation = Math.atan2(centerY - safeY, centerX - safeX);
      player.hp = 30;
      player.maxHp = 30;
      player.shield = 0;
      player.maxShield = 0;
      player.invulnerableLeft = 15.0; // 15 segundos iniciales de invulnerabilidad
      player.availableWeapons = ",,MELEE";
      this.initPlayerWeapons(player.id);
      this.applyWeaponToPlayer(player, "MELEE");
      player.isGhost = false;
      player.isHidden = false;
      player.kills = 0;
      player.activeBuff = "";
      player.buffLeft = 0;
      player.dashLeft = 0;
      player.shootCooldown = 0;
      player.trapLeft = 0;

      this.spatialGrid.insert({
        id: player.id,
        x: player.x,
        y: player.y,
        radius: 22,
        type: "player",
        data: player,
      });
    });

    this.updateAliveCount();
    this.broadcast("matchStarted", { count: humans.length, roomCode: this.state.roomCode });
    console.log(`🚀 Partida Personalizada Iniciada con ${humans.length} jugadores en sala #${this.state.roomCode}`);
  }

  private updateZone(dt: number) {
    const zone = this.state.zone;

    if (!zone.isShrinking) {
      zone.timeLeft -= dt;
      if (zone.timeLeft <= 0) {
        zone.isShrinking = true;
        this.zoneShrinkTimer = this.zoneShrinkDuration;
        this.targetRadius = Math.max(120, zone.currentRadius * 0.65);
        zone.targetRadius = this.targetRadius;
      }
    } else {
      this.zoneShrinkTimer -= dt;
      const progress = 1 - Math.max(0, this.zoneShrinkTimer / this.zoneShrinkDuration);
      zone.currentRadius = this.startRadius - (this.startRadius - this.targetRadius) * progress;

      if (this.zoneShrinkTimer <= 0) {
        zone.isShrinking = false;
        zone.phase += 1;
        zone.timeLeft = Math.max(8, this.zonePhaseDuration - zone.phase * 2);
        this.startRadius = zone.currentRadius;
      }
    }
  }

  private checkInBush(px: number, py: number): boolean {
    let inBush = false;
    this.state.bushes.forEach((bush) => {
      const minX = bush.x - bush.width / 2;
      const maxX = bush.x + bush.width / 2;
      const minY = bush.y - bush.height / 2;
      const maxY = bush.y + bush.height / 2;

      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        inBush = true;
      }
    });
    return inBush;
  }

  public checkIsHidden(px: number, py: number): boolean {
    return this.checkInBush(px, py) || this.checkInStructure(px, py) !== null;
  }

  private createStaticBushes() {
    const bushData = [
      // ── Alrededores de Estructuras (Zonas Tácticas de Emboscada) ──
      // Mansión Central
      { id: "bush_m_1", x: 3600, y: 3100, width: 260, height: 180 },
      { id: "bush_m_2", x: 4400, y: 3100, width: 260, height: 180 },
      { id: "bush_m_3", x: 3600, y: 3700, width: 280, height: 190 },
      { id: "bush_m_4", x: 4450, y: 3700, width: 280, height: 190 },

      // Búnker NW
      { id: "bush_bk_1", x: 1700, y: 1700, width: 240, height: 170 },
      { id: "bush_bk_2", x: 2300, y: 1750, width: 240, height: 170 },
      { id: "bush_bk_3", x: 2000, y: 2350, width: 260, height: 180 },

      // Almacén SE
      { id: "bush_wh_1", x: 5600, y: 5700, width: 250, height: 180 },
      { id: "bush_wh_2", x: 6400, y: 5750, width: 260, height: 180 },
      { id: "bush_wh_3", x: 6000, y: 6350, width: 270, height: 190 },

      // Laboratorio NE
      { id: "bush_lb_1", x: 5700, y: 1700, width: 240, height: 170 },
      { id: "bush_lb_2", x: 6300, y: 1750, width: 240, height: 170 },
      { id: "bush_lb_3", x: 6000, y: 2350, width: 260, height: 180 },

      // Fuerte SW
      { id: "bush_ft_1", x: 1700, y: 5700, width: 240, height: 170 },
      { id: "bush_ft_2", x: 2300, y: 5750, width: 240, height: 170 },
      { id: "bush_ft_3", x: 2000, y: 6350, width: 260, height: 180 },

      // Cabañas N, S, W, E
      { id: "bush_cb_n", x: 4250, y: 1400, width: 200, height: 150 },
      { id: "bush_cb_s", x: 3750, y: 6600, width: 200, height: 150 },
      { id: "bush_cb_w", x: 1400, y: 4250, width: 200, height: 150 },
      { id: "bush_cb_e", x: 6600, y: 3750, width: 200, height: 150 },

      // ── Cuadrante Noroeste (NW) ──
      { id: "bush_nw_1", x: 1200, y: 1200, width: 240, height: 180 },
      { id: "bush_nw_2", x: 2600, y: 1100, width: 250, height: 180 },
      { id: "bush_nw_3", x: 2800, y: 2400, width: 260, height: 190 },
      { id: "bush_nw_4", x: 1400, y: 2800, width: 240, height: 170 },

      // ── Cuadrante Noreste (NE) ──
      { id: "bush_ne_1", x: 5000, y: 1200, width: 240, height: 180 },
      { id: "bush_ne_2", x: 6800, y: 1100, width: 250, height: 180 },
      { id: "bush_ne_3", x: 5200, y: 2500, width: 260, height: 190 },
      { id: "bush_ne_4", x: 6800, y: 2800, width: 240, height: 170 },

      // ── Riberas del Río y Puentes ──
      { id: "bush_rv_1", x: 3950, y: 1850, width: 220, height: 160 },
      { id: "bush_rv_2", x: 4400, y: 2150, width: 220, height: 160 },
      { id: "bush_rv_3", x: 3650, y: 3850, width: 240, height: 170 },
      { id: "bush_rv_4", x: 4050, y: 4150, width: 240, height: 170 },
      { id: "bush_rv_5", x: 4050, y: 5850, width: 220, height: 160 },
      { id: "bush_rv_6", x: 4450, y: 6150, width: 220, height: 160 },

      // ── Cuadrante Suroeste (SW) ──
      { id: "bush_sw_1", x: 1200, y: 5000, width: 240, height: 180 },
      { id: "bush_sw_2", x: 2600, y: 5100, width: 250, height: 180 },
      { id: "bush_sw_3", x: 2800, y: 6800, width: 260, height: 190 },
      { id: "bush_sw_4", x: 1400, y: 6900, width: 240, height: 170 },

      // ── Cuadrante Sureste (SE) ──
      { id: "bush_se_1", x: 5000, y: 5000, width: 240, height: 180 },
      { id: "bush_se_2", x: 6800, y: 5100, width: 250, height: 180 },
      { id: "bush_se_3", x: 5200, y: 6800, width: 260, height: 190 },
      { id: "bush_se_4", x: 6800, y: 6900, width: 240, height: 170 },
    ];

    // Ningún arbusto puede quedar dentro de una casa (ni sobre su alero/entrada):
    // si se superpone, se empuja hacia afuera por el lado más cercano.
    const MARGIN = 90;
    bushData.forEach((b) => {
      for (const st of STRUCTURES) {
        const hw = st.width / 2 + MARGIN + b.width / 2, hh = st.height / 2 + MARGIN + b.height / 2;
        const dx = b.x - st.x, dy = b.y - st.y;
        if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) continue;
        if (hw - Math.abs(dx) < hh - Math.abs(dy)) b.x = st.x + Math.sign(dx || 1) * hw;
        else b.y = st.y + Math.sign(dy || 1) * hh;
      }
    });

    bushData.forEach((b) => {
      const bush = new Bush();
      bush.id = b.id;
      bush.x = b.x;
      bush.y = b.y;
      bush.width = b.width;
      bush.height = b.height;
      this.state.bushes.set(b.id, bush);
    });
  }

  private createStaticObstacles() {
    const obstacleList: { type: string; x: number; y: number; hp: number; r: number }[] = [];

    // 1. Muros Perimetrales Autoritativos para las Estructuras (Con Puertas Abiertas)
    STRUCTURES.forEach((struct) => {
      const minX = struct.x - struct.width / 2;
      const maxX = struct.x + struct.width / 2;
      const minY = struct.y - struct.height / 2;
      const maxY = struct.y + struct.height / 2;
      const step = 32;

      const isDoorway = (px: number, py: number): boolean => {
        for (const dw of struct.doorways) {
          const dwMinX = dw.x - dw.width / 2 - 8;
          const dwMaxX = dw.x + dw.width / 2 + 8;
          const dwMinY = dw.y - dw.height / 2 - 8;
          const dwMaxY = dw.y + dw.height / 2 + 8;
          if (px >= dwMinX && px <= dwMaxX && py >= dwMinY && py <= dwMaxY) {
            return true;
          }
        }
        return false;
      };

      // Muro Norte
      for (let x = minX; x <= maxX; x += step) {
        if (!isDoorway(x, minY)) {
          obstacleList.push({ type: "WALL", x, y: minY, hp: 9999, r: 18 });
        }
      }
      // Muro Sur
      for (let x = minX; x <= maxX; x += step) {
        if (!isDoorway(x, maxY)) {
          obstacleList.push({ type: "WALL", x, y: maxY, hp: 9999, r: 18 });
        }
      }
      // Muro Oeste
      for (let y = minY + step; y <= maxY - step; y += step) {
        if (!isDoorway(minX, y)) {
          obstacleList.push({ type: "WALL", x: minX, y, hp: 9999, r: 18 });
        }
      }
      // Muro Este
      for (let y = minY + step; y <= maxY - step; y += step) {
        if (!isDoorway(maxX, y)) {
          obstacleList.push({ type: "WALL", x: maxX, y, hp: 9999, r: 18 });
        }
      }

      // Cajas de botín y barriles tácticos interiores en la estructura
      obstacleList.push({ type: "CRATE", x: struct.x - struct.width * 0.28, y: struct.y - struct.height * 0.22, hp: 60, r: 28 });
      obstacleList.push({ type: "CRATE", x: struct.x + struct.width * 0.28, y: struct.y - struct.height * 0.22, hp: 60, r: 28 });
      obstacleList.push({ type: "BARREL", x: struct.x - struct.width * 0.28, y: struct.y + struct.height * 0.22, hp: 40, r: 26 });
      obstacleList.push({ type: "CRATE", x: struct.x + struct.width * 0.28, y: struct.y + struct.height * 0.22, hp: 60, r: 28 });
    });

    // 2. Obstáculos Naturales y Tácticos alrededor del mapa 8000x8000
    // Cajas de madera exteriores
    const crates = [
      { x: 3800, y: 3950 }, { x: 4200, y: 3950 }, { x: 3850, y: 4050 }, { x: 4150, y: 4050 },
      { x: 1500, y: 1500 }, { x: 2500, y: 1500 }, { x: 1500, y: 2500 }, { x: 2500, y: 2500 },
      { x: 5500, y: 1500 }, { x: 6500, y: 1500 }, { x: 5500, y: 2500 }, { x: 6500, y: 2500 },
      { x: 1500, y: 5500 }, { x: 2500, y: 5500 }, { x: 1500, y: 6500 }, { x: 2500, y: 6500 },
      { x: 5500, y: 5500 }, { x: 6500, y: 5500 }, { x: 5500, y: 6500 }, { x: 6500, y: 6500 },
      { x: 4100, y: 1950 }, { x: 4260, y: 2050 }, { x: 4120, y: 5950 }, { x: 4280, y: 6050 },
    ];
    crates.forEach(c => obstacleList.push({ type: "CRATE", x: c.x, y: c.y, hp: 60, r: 30 }));

    // Barriles explosivos
    const barrels = [
      { x: 3600, y: 4000 }, { x: 4400, y: 4000 },
      { x: 1800, y: 1600 }, { x: 2200, y: 2400 },
      { x: 5800, y: 1600 }, { x: 6200, y: 2400 },
      { x: 1800, y: 5600 }, { x: 2200, y: 6400 },
      { x: 5800, y: 5600 }, { x: 6200, y: 6400 },
      { x: 4180, y: 1850 }, { x: 4200, y: 6150 },
    ];
    barrels.forEach(b => obstacleList.push({ type: "BARREL", x: b.x, y: b.y, hp: 40, r: 26 }));

    // Rocas / Boulders
    const boulders = [
      { x: 1100, y: 1800, r: 46 }, { x: 2700, y: 1200, r: 44 }, { x: 1900, y: 3100, r: 44 },
      { x: 5200, y: 1600, r: 46 }, { x: 6900, y: 1700, r: 44 }, { x: 6100, y: 3100, r: 44 },
      { x: 1100, y: 6200, r: 46 }, { x: 2700, y: 6800, r: 44 }, { x: 1900, y: 4900, r: 44 },
      { x: 5200, y: 6400, r: 46 }, { x: 6900, y: 6300, r: 44 }, { x: 6100, y: 4900, r: 44 },
      { x: 3400, y: 2400, r: 46 }, { x: 4600, y: 2400, r: 46 }, { x: 3400, y: 5600, r: 46 }, { x: 4600, y: 5600, r: 46 },
    ];
    boulders.forEach(bd => obstacleList.push({ type: "BOULDER", x: bd.x, y: bd.y, hp: 9999, r: bd.r }));

    // Árboles frondosos
    const trees = [
      { x: 900, y: 900 }, { x: 3100, y: 900 }, { x: 4900, y: 900 }, { x: 7100, y: 900 },
      { x: 900, y: 3100 }, { x: 3100, y: 3100 }, { x: 4900, y: 3100 }, { x: 7100, y: 3100 },
      { x: 900, y: 4900 }, { x: 3100, y: 4900 }, { x: 4900, y: 4900 }, { x: 7100, y: 4900 },
      { x: 900, y: 7100 }, { x: 3100, y: 7100 }, { x: 4900, y: 7100 }, { x: 7100, y: 7100 },
      { x: 3500, y: 1500 }, { x: 4500, y: 1500 }, { x: 3500, y: 6500 }, { x: 4500, y: 6500 },
    ];
    trees.forEach(t => obstacleList.push({ type: "TREE", x: t.x, y: t.y, hp: 9999, r: 38 }));

    obstacleList.forEach((d) => {
      const obs = new Obstacle();
      obs.id = `obs_${++this.obstacleIdCounter}`;
      obs.x = d.x;
      obs.y = d.y;
      obs.obstacleType = d.type;
      obs.hp = d.hp;
      obs.maxHp = d.hp;
      obs.radius = d.r;
      obs.destroyed = false;
      this.state.obstacles.set(obs.id, obs);
      this.spatialGrid.insert({
        id: obs.id,
        x: obs.x,
        y: obs.y,
        radius: obs.radius,
        type: "obstacle",
        data: obs,
      });
    });
  }

  private createItemPickups() {
    const itemsData: { id: string; x: number; y: number; type: string }[] = [];

    // Botín estratégico garantizado dentro de cada estructura
    STRUCTURES.forEach((s, idx) => {
      const gun = s.type === "BUNKER" ? "SNIPER" : s.type === "WAREHOUSE" ? "SHOTGUN" : s.type === "LAB" ? "LASER" : s.type === "OUTPOST" ? "GRENADE" : "SNIPER";
      itemsData.push({ id: `loot_st_${idx}_1`, x: s.x, y: s.y, type: gun });
      itemsData.push({ id: `loot_st_${idx}_2`, x: s.x - s.width * 0.15, y: s.y, type: "MEDKIT" });
      itemsData.push({ id: `loot_st_${idx}_3`, x: s.x + s.width * 0.15, y: s.y, type: "SHIELD" });
      itemsData.push({ id: `loot_st_${idx}_4`, x: s.x, y: s.y - s.height * 0.15, type: "SPEED" });
    });

    // Botín disperso por biomas y puentes
    const wildernessLoot = [
      { x: 3850, y: 4000, type: "SNIPER" },
      { x: 4180, y: 2000, type: "SHOTGUN" },
      { x: 4200, y: 6000, type: "GRENADE" },
      { x: 3600, y: 3600, type: "LASER" },
      { x: 4400, y: 4400, type: "LASER" },
      { x: 3700, y: 4300, type: "SHOTGUN" },
      { x: 4300, y: 3700, type: "LASER" },
      { x: 4000, y: 3500, type: "SHOTGUN" },
      { x: 4000, y: 4500, type: "LASER" },
      { x: 3500, y: 4000, type: "SHOTGUN" },
      { x: 4500, y: 4000, type: "LASER" },
      { x: 1200, y: 1200, type: "MEDKIT" },
      { x: 2800, y: 1800, type: "SHIELD" },
      { x: 5200, y: 1800, type: "TRIPLE" },
      { x: 6800, y: 1200, type: "SPEED" },
      { x: 1200, y: 6800, type: "SHOTGUN" },
      { x: 2800, y: 5200, type: "MEDKIT" },
      { x: 5200, y: 5200, type: "SHIELD" },
      { x: 6800, y: 6800, type: "SNIPER" },
      { x: 2400, y: 4000, type: "LASER" },
      { x: 5600, y: 4000, type: "SHOTGUN" },
      { x: 4000, y: 2400, type: "SHIELD" },
      { x: 4000, y: 5600, type: "SHIELD" },
    ];
    wildernessLoot.forEach((wl, idx) => {
      itemsData.push({ id: `loot_wd_${idx}`, x: wl.x, y: wl.y, type: wl.type });
    });

    itemsData.forEach((d) => {
      const item = new ItemPickup();
      item.id = d.id;
      item.x = d.x;
      item.y = d.y;
      item.itemType = d.type;
      item.active = true;
      item.respawnTimer = 0;
      this.state.items.set(d.id, item);
      this.spatialGrid.insert({
        id: item.id,
        x: item.x,
        y: item.y,
        radius: 24,
        type: "item",
        data: item,
      });
    });
  }
}
