import { Room, Client } from "colyseus";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup, Obstacle } from "./schema/GameState";
import { broadcastSSE } from "../sse";
import { SpatialHashGrid } from "../spatial/SpatialHashGrid";
import { STRUCTURES, StructureDef } from "./structures";

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
    shootCooldown: 0.5, // cooldown de 0.5s
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
    damage: 50, // 50 de daño por arañazo
    maxAmmo: 999,
    reserveAmmo: 0,
    shootCooldown: 0.3, // cooldown de 0.3s
    reloadTime: 0,
    range: 75,
    speed: 0,
  },
};

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
  private sseTickCounter = 0;

  private playerWeaponAmmo = new Map<string, Record<string, { ammo: number; reserveAmmo: number }>>();

  private botControllers: Map<string, BotController> = new Map();
  private botNames = [
    "Michi Ninja",
    "Gato Samurái",
    "Garfield 9000",
    "Gatito Feroz",
    "Michi Táctico",
    "Bigotes Letal",
  ];

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.status = "WAITING";

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

    // Initialize Bots
    this.spawnBots();

    // Register Message Handlers
    this.onMessage("move", (client, data: MovePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

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

    this.onMessage("interact", (client, data: { itemId?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost) return;
      this.handlePlayerInteract(player, data?.itemId);
    });

    this.onMessage("dash", (client, data: { dirX?: number; dirY?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.dashCooldown > 0) return;

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
      player.dashCooldown = cooldown;

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
      broadcastSSE("playerDash", {
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
      this.startReload(player);
    });

    this.onMessage("shoot", (client, data: ShootPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.shootCooldown > 0) return;
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
      this.spawnProjectiles(player, angle, data.targetX, data.targetY);
      
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
      const valid = ["LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"];
      if (valid.includes(data.weapon)) {
        this.savePlayerCurrentWeaponAmmo(player);
        this.applyWeaponToPlayer(player, data.weapon);
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
      if (!player || !player.isGhost || player.trapCooldown > 0) return;

      const trap = new Trap();
      trap.id = `trap_${++this.trapIdCounter}_${Date.now()}`;

      const posX = typeof data?.x === "number" ? data.x : player.x;
      const posY = typeof data?.y === "number" ? data.y : player.y;

      trap.x = Math.max(40, Math.min(this.state.worldWidth - 40, posX));
      trap.y = Math.max(40, Math.min(this.state.worldHeight - 40, posY));
      trap.ownerId = client.sessionId;
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
      player.trapCooldown = 6.0;
      this.broadcast("trapPlaced", { id: trap.id, x: trap.x, y: trap.y });
    });

    this.onMessage("restart", (client) => {
      console.log(`Match restart requested by ${client.sessionId}`);
      this.restartMatch();
    });

    // 60 FPS Game Loop
    this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000), 1000 / 60);
  }

  private resetZone() {
    this.startRadius = 3850;
    this.targetRadius = 3850;
    this.zoneShrinkTimer = 0;
    this.state.zone.x = this.state.worldWidth / 2;
    this.state.zone.y = this.state.worldHeight / 2;
    this.state.zone.currentRadius = this.startRadius;
    this.state.zone.targetRadius = this.startRadius;
    this.state.zone.timer = this.zonePhaseDuration;
    this.state.zone.phase = 1;
    this.state.zone.isShrinking = false;
  }

  private applyDamage(player: Player, damage: number, attackerId?: string, weaponName = "Arma") {
    if (player.isGhost) return;
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
        const killPayload = {
          killerId: attackerId,
          killerName: killer ? killer.name : "Alguien",
          victimId: player.id,
          victimName: player.name,
          weapon: weaponName,
        };
        this.broadcast("kill", killPayload);
        broadcastSSE("kill", killPayload);
      }


      this.updateAliveCount();
    }
  }

  private spawnDeathLoot(x: number, y: number) {
    const lootTypes = ["MEDKIT", "SHIELD", "SHOTGUN", "SNIPER", "SPEED"];
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
      LASER: { ammo: 12, reserveAmmo: 24 }, // 12 en recámara, 2 cargadores (24)
      SHOTGUN: { ammo: 2, reserveAmmo: 8 }, // 2 en recámara, 4 cargadores (8)
      SNIPER: { ammo: 5, reserveAmmo: 5 }, // 5 en recámara, 1 cargador (5)
      GRENADE: { ammo: 3, reserveAmmo: 0 }, // 3 granadas al recoger
      MELEE: { ammo: 999, reserveAmmo: 0 }, // Garras
    });
  }

  private applyWeaponToPlayer(player: Player, weaponKey: string) {
    const store = this.playerWeaponAmmo.get(player.id);
    const cfg = WEAPON_CONFIGS[weaponKey] || WEAPON_CONFIGS.LASER;
    player.equippedWeapon = weaponKey;
    player.maxAmmo = cfg.maxAmmo;
    player.maxReloadTimer = cfg.reloadTime;
    player.isReloading = false;
    player.reloadTimer = 0;

    if (store && store[weaponKey]) {
      player.ammo = store[weaponKey].ammo;
      player.reserveAmmo = store[weaponKey].reserveAmmo;
    } else {
      player.ammo = cfg.maxAmmo;
      player.reserveAmmo = cfg.reserveAmmo;
    }
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
    player.reloadTimer = cfg.reloadTime;
    this.broadcast("playerReloading", { id: player.id, duration: cfg.reloadTime });
  }

  private addProjectile(proj: Projectile) {
    this.state.projectiles.set(proj.id, proj);
    this.spatialGrid.insert({
      id: proj.id,
      x: proj.x,
      y: proj.y,
      radius: proj.radius,
      type: "projectile",
      data: proj,
    });
  }

  private spawnProjectiles(player: Player, angle: number, targetX?: number, targetY?: number) {
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
            this.applyDamage(target, 50, player.id, "Garras Felinas");
            this.broadcast("hit", { x: target.x, y: target.y, damage: 50, victimId: target.id, shooterId: player.id });
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
      broadcastSSE("playerMelee", { id: player.id, x: slashX, y: slashY, angle, damage: 50 });
      return;
    }

    if (weapon === "SHOTGUN") {
      // Escopeta: 5 perdigones, 15 de daño cada perdigón. Alcance 310px. Cooldown 1s, recarga 2.5s.
      const pelletCount = isTriple ? 7 : 5;
      const spread = 0.28;
      const range = 310;
      const speed = 680;
      const lifetime = range / speed; // 0.455s -> exactamente termina al llegar a 310px

      for (let i = 0; i < pelletCount; i++) {
        const offset = (i - (pelletCount - 1) / 2) * (spread / (pelletCount - 1));
        const a = angle + offset + (Math.random() - 0.5) * 0.04;

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
      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SHOTGUN" });
      broadcastSSE("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SHOTGUN" });
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
      broadcastSSE("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SNIPER" });
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
      broadcastSSE("playerShoot", {
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
    const angles = isTriple ? [angle - 0.18, angle, angle + 0.18] : [angle];
    const range = 480;
    const speed = 800;
    const lifetime = range / speed;

    for (const a of angles) {
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

    this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "LASER", isTriple });
    broadcastSSE("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "LASER", isTriple });
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
    broadcastSSE("explosion", { x, y, radius: 140, type: "BARREL" });

    // Damage nearby players & obstacles via SpatialHashGrid (O(1))
    const nearby = this.spatialGrid.queryRadius(x, y, 140, ["player", "obstacle"]);
    for (const ent of nearby) {
      if (ent.type === "player") {
        const player = ent.data as Player;
        if (player.isGhost) continue;
        const dist = Math.hypot(player.x - x, player.y - y);
        if (dist < 140) {
          const falloff = 1 - dist / 140;
          const dmg = Math.floor(65 * falloff);
          this.applyDamage(player, dmg, shooterId, "Barril Explosivo");
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
    broadcastSSE("explosion", { x, y, radius: outerRadius, innerRadius, type: "GRENADE" });

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
    const possible = ["MEDKIT", "SHIELD", "SHOTGUN", "SNIPER", "GRENADE", "SPEED", "TRIPLE"];
    const chosen = possible[Math.floor(Math.random() * possible.length)];

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

  private spawnBots() {
    this.botControllers.clear();
    const colors = [1, 2, 3, 4, 0, 2];   // skins 0..4
    const botWeapons = ["LASER", "SHOTGUN", "SNIPER", "LASER", "SHOTGUN", "SNIPER"];

    for (let i = 0; i < this.botNames.length; i++) {
      const botId = `bot_${i + 1}`;
      const bot = new Player();
      bot.id = botId;
      bot.name = this.botNames[i];
      bot.isBot = true;
      bot.catColor = colors[i % colors.length];
      bot.equippedWeapon = botWeapons[i % botWeapons.length];

      this.initPlayerWeapons(botId);
      this.applyWeaponToPlayer(bot, botWeapons[i % botWeapons.length]);

      const angle = (i / this.botNames.length) * Math.PI * 2;
      const dist = 1200 + Math.random() * 2000;
      bot.x = this.state.zone.x + Math.cos(angle) * dist;
      bot.y = this.state.zone.y + Math.sin(angle) * dist;
      bot.rotation = angle + Math.PI;
      bot.hp = 100;
      bot.maxHp = 100;
      bot.shield = 25;
      bot.maxShield = 50;
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

    let player = this.state.players.get(client.sessionId);
    if (!player) {
      player = new Player();
      player.id = client.sessionId;
      player.name = playerName;
      player.isBot = false;
      player.catColor = skinColor;
    } else {
      player.name = playerName;
      player.catColor = skinColor;
    }

    const angle = Math.random() * Math.PI * 2;
    const dist = 800 + Math.random() * 2200;
    player.x = this.state.zone.x + Math.cos(angle) * dist;
    player.y = this.state.zone.y + Math.sin(angle) * dist;
    player.rotation = 0;
    player.hp = 100;
    player.maxHp = 100;
    player.shield = 50;
    player.maxShield = 50;
    player.isGhost = false;
    player.isHidden = false;
    player.kills = 0;
    player.activeBuff = "";
    player.buffTimer = 0;
    this.initPlayerWeapons(client.sessionId);
    this.applyWeaponToPlayer(player, "LASER");

    this.state.players.set(client.sessionId, player);
    this.spatialGrid.insert({
      id: player.id,
      x: player.x,
      y: player.y,
      radius: 22,
      type: "player",
      data: player,
    });

    if (this.state.status === "WAITING" || this.state.players.size <= 1) {
      this.restartMatch();
    } else {
      this.updateAliveCount();
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`Player left: ${client.sessionId}`);
    this.state.players.delete(client.sessionId);
    this.spatialGrid.remove(client.sessionId);
    this.updateAliveCount();

    let hasHuman = false;
    for (const [_, p] of this.state.players) {
      if (!p.isBot) {
        hasHuman = true;
        break;
      }
    }
    if (!hasHuman) {
      this.state.status = "WAITING";
    }
  }

  private update(dt: number) {
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

      if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      if (player.trapCooldown > 0) player.trapCooldown = Math.max(0, player.trapCooldown - dt);
      if (player.shootCooldown > 0) player.shootCooldown = Math.max(0, player.shootCooldown - dt);

      if (player.emoteTimer > 0) {
        player.emoteTimer -= dt;
        if (player.emoteTimer <= 0) player.lastEmote = "";
      }

      // Player reload progress
      if (player.isReloading) {
        player.reloadTimer -= dt;
        if (player.reloadTimer <= 0) {
          const needed = player.maxAmmo - player.ammo;
          const taken = Math.min(needed, player.reserveAmmo);
          player.ammo += taken;
          player.reserveAmmo -= taken;
          player.isReloading = false;
          player.reloadTimer = 0;
          this.savePlayerCurrentWeaponAmmo(player);
          this.broadcast("playerReloadComplete", { id: player.id, ammo: player.ammo, reserveAmmo: player.reserveAmmo });
        }
      }

      // Buffs expiration
      if (player.buffTimer > 0) {
        player.buffTimer -= dt;
        if (player.buffTimer <= 0) {
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

          this.spatialGrid.update({
            id: proj.id,
            x: proj.x,
            y: proj.y,
            radius: proj.radius,
            type: "projectile",
            data: proj,
          });

          const distToTarget = Math.hypot(proj.x - proj.targetX, proj.y - proj.targetY);
          if (proj.lifetime <= 0 || distToTarget < 14) {
            // Llegó al destino de cursor: se detiene y se arma en el suelo por 2 segundos
            proj.x = proj.targetX;
            proj.y = proj.targetY;
            proj.vx = 0;
            proj.vy = 0;
            proj.isArmed = true;
            proj.lifetime = 2.0; // titilará 2 segundos antes de explotar
            this.spatialGrid.update({
              id: proj.id,
              x: proj.x,
              y: proj.y,
              radius: proj.radius,
              type: "projectile",
              data: proj,
            });
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

      // Proyectiles convencionales (LASER, PELLET, SNIPER_BEAM)
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.lifetime -= dt;

      if (proj.lifetime <= 0 || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
        projToDelete.add(key);
        return;
      }

      // Actualizar registro en grilla espacial
      this.spatialGrid.update({
        id: proj.id,
        x: proj.x,
        y: proj.y,
        radius: proj.radius,
        type: "projectile",
        data: proj,
      });

      // Collision check O(1) con Obstáculos en misma celda o celdas adyacentes
      const nearbyObs = this.spatialGrid.queryRadius(proj.x, proj.y, proj.radius + 35, ["obstacle"]);
      for (const ent of nearbyObs) {
        if (projToDelete.has(key)) break;
        const obs = ent.data as Obstacle;
        if (obs.destroyed) continue;
        const dist = Math.hypot(obs.x - proj.x, obs.y - proj.y);
        if (dist < obs.radius + proj.radius) {
          projToDelete.add(key);
          this.damageObstacle(obs, proj.damage, proj.ownerId);
          this.broadcast("hit", { x: proj.x, y: proj.y, damage: proj.damage });
          break;
        }
      }

      // Collision check O(1) con Jugadores en misma celda o celdas adyacentes
      if (!projToDelete.has(key)) {
        const nearbyPlayers = this.spatialGrid.queryRadius(proj.x, proj.y, proj.radius + 26, ["player"]);
        for (const ent of nearbyPlayers) {
          if (projToDelete.has(key)) break;
          const player = ent.data as Player;
          if (player.isGhost) continue;
          if (player.id === proj.ownerId) continue;

          const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
          if (dist < 26) {
            projToDelete.add(key);
            const wName = proj.projType === "SNIPER_BEAM" ? "Rifle Sniper" : proj.projType === "PELLET" ? "Escopeta" : "Pistola Láser";
            this.applyDamage(player, proj.damage, proj.ownerId, wName);
            this.broadcast("hit", {
              x: player.x,
              y: player.y,
              damage: proj.damage,
              victimId: player.id,
              shooterId: proj.ownerId,
            });
            break;
          }
        }
      }
    });

    projToDelete.forEach((id) => {
      this.state.projectiles.delete(id);
      this.spatialGrid.remove(id);
    });

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
          this.broadcast("trapExplode", { x: trap.x, y: trap.y, victimId: player.id });
          this.applyDamage(player, trap.damage, trap.ownerId, "Trampa Espectral");
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

    // 7. Authoritative SSE State Tick (Streamed at 30Hz directamente a clientes SSE)
    this.sseTickCounter = ((this.sseTickCounter || 0) + 1) % 2;
    if (this.sseTickCounter === 0) {
      const pList: any[] = [];
      this.state.players.forEach((p) => {
        pList.push({
          id: p.id,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          rot: Math.round(p.rotation * 100) / 100,
          hp: Math.round(p.hp),
          shield: Math.round(p.shield),
          w: p.equippedWeapon,
          isGhost: p.isGhost,
        });
      });
      broadcastSSE("tick", {
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

      if (bot.isGhost) {
        ctrl.dashTimer -= dt;
        if (ctrl.dashTimer <= 0 && bot.trapCooldown <= 0) {
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
          bot.trapCooldown = 7.0;
          ctrl.dashTimer = 8 + Math.random() * 8;
        }
        return;
      }

      const distToZone = Math.hypot(bot.x - this.state.zone.x, bot.y - this.state.zone.y);
      const isOutsideZone = distToZone > this.state.zone.currentRadius * 0.85;

      let nearestEnemy: Player | null = null;
      let minEnemyDist = Infinity;

      // Buscar enemigos cercanos usando SpatialHashGrid en lugar de iterar todo el mapa
      const nearbyEnemies = this.spatialGrid.queryRadius(bot.x, bot.y, 650, ["player"]);
      for (const ent of nearbyEnemies) {
        const p = ent.data as Player;
        if (p.id === bot.id || p.isGhost) continue;
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

        if (bot.shootCooldown <= 0 && minEnemyDist < 380) {
          this.spawnProjectiles(bot, bot.rotation);
          bot.shootCooldown = nearestEnemy.isBot ? (1.6 + Math.random() * 0.8) : (1.0 + Math.random() * 0.5);
        }

        if (minEnemyDist < 140) {
          const perpAngle = targetAngle + Math.PI / 2;
          ctrl.targetDx = Math.cos(perpAngle);
          ctrl.targetDy = Math.sin(perpAngle);
        } else {
          ctrl.targetDx = Math.cos(targetAngle) * 0.8;
          ctrl.targetDy = Math.sin(targetAngle) * 0.8;
        }

        if (ctrl.dashTimer <= 0 && bot.dashCooldown <= 0 && minEnemyDist < 200) {
          const isMelee = bot.equippedWeapon === "MELEE";
          const cooldown = isMelee ? 1.8 : 2.5;
          const dashDist = isMelee ? 160 : 120;
          bot.dashCooldown = cooldown;
          ctrl.dashTimer = 3.5 + Math.random() * 2.5;

          const dashNx = ctrl.targetDx || Math.cos(bot.rotation);
          const dashNy = ctrl.targetDy || Math.sin(bot.rotation);
          const mag = Math.hypot(dashNx, dashNy) || 1;
          const nx = dashNx / mag;
          const ny = dashNy / mag;

          let targetX = bot.x + nx * dashDist;
          let targetY = bot.y + ny * dashDist;

          const pRadius = 22;
          this.state.obstacles.forEach((obs) => {
            if (obs.destroyed) return;
            const dist = Math.hypot(targetX - obs.x, targetY - obs.y);
            const minDist = pRadius + obs.radius;
            if (dist < minDist && dist > 0) {
              const overlap = minDist - dist;
              targetX += ((targetX - obs.x) / dist) * overlap;
              targetY += ((targetY - obs.y) / dist) * overlap;
            }
          });

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
          broadcastSSE("playerDash", {
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

      // Bot obstacle collision
      const pRadius = 22;
      this.state.obstacles.forEach((obs) => {
        if (obs.destroyed) return;
        const dist = Math.hypot(nextX - obs.x, nextY - obs.y);
        const minDist = pRadius + obs.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          nextX += ((nextX - obs.x) / dist) * overlap;
          nextY += ((nextY - obs.y) / dist) * overlap;
        }
      });

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
    // 3 puentes de madera proporcionan cruce seguro sin fricción de agua
    // Puente 1 (Norte)
    if (x >= 4100 && x <= 4260 && y >= 1950 && y <= 2050) return false;
    // Puente 2 (Centro)
    if (x >= 3770 && x <= 3930 && y >= 3950 && y <= 4050) return false;
    // Puente 3 (Sur)
    if (x >= 4120 && x <= 4280 && y >= 5950 && y <= 6050) return false;

    // Río serpenteante que cruza la isla de Norte a Sur (0 a 8000)
    const pts = [
      { x: 4000, y: 0 },
      { x: 4200, y: 1500 },
      { x: 3900, y: 3100 },
      { x: 3800, y: 4900 },
      { x: 4300, y: 6500 },
      { x: 4100, y: 8000 },
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      let t = ((x - p1.x) * dx + (y - p1.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = p1.x + t * dx;
      const py = p1.y + t * dy;
      if (Math.hypot(x - px, y - py) < 65) return true;
    }
    return false;
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

  public handlePlayerInteract(player: Player, requestedItemId?: string) {
    let targetItem: ItemPickup | null = null;
    let minDist = 75;

    if (requestedItemId && this.state.items.has(requestedItemId)) {
      const it = this.state.items.get(requestedItemId)!;
      if (it.active && Math.hypot(player.x - it.x, player.y - it.y) <= 85) {
        targetItem = it;
      }
    }

    if (!targetItem) {
      this.state.items.forEach((item) => {
        if (!item.active) return;
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

      // Suroi-style weapon swap: drop previous weapon on ground so it can be picked back up!
      if (prevWeapon && prevWeapon !== item.itemType && prevWeapon !== "LASER") {
        const dropItem = new ItemPickup();
        dropItem.id = `drop_${++this.itemIdCounter}_${Date.now()}`;
        dropItem.x = player.x;
        dropItem.y = player.y;
        dropItem.itemType = prevWeapon;
        dropItem.active = true;
        dropItem.respawnTimer = 0;
        this.state.items.set(dropItem.id, dropItem);
      }

      // Rellenar munición al recoger arma nueva
      const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
      const store = this.playerWeaponAmmo.get(player.id);
      if (store) {
        store[item.itemType] = {
          ammo: cfg.maxAmmo,
          reserveAmmo: cfg.reserveAmmo,
        };
      }
      this.applyWeaponToPlayer(player, item.itemType);

      if (item.id.startsWith("drop_") || item.id.startsWith("crate_")) {
        this.state.items.delete(item.id);
      } else {
        item.active = false;
        item.respawnTimer = 22.0;
      }
    } else {
      item.active = false;
      item.respawnTimer = 16.0;

      if (item.itemType === "MEDKIT") {
        player.hp = Math.min(player.maxHp, player.hp + 40);
      } else if (item.itemType === "SHIELD") {
        player.shield = Math.min(player.maxShield, player.shield + 50);
      } else if (item.itemType === "SPEED") {
        player.activeBuff = "SPEED";
        player.buffTimer = 7.0;
      } else if (item.itemType === "TRIPLE") {
        player.activeBuff = "TRIPLE";
        player.buffTimer = 9.0;
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
          item.active = true;
        }
        return;
      }

      this.state.players.forEach((player) => {
        if (!item.active || player.isGhost) return;

        const dist = Math.hypot(player.x - item.x, player.y - item.y);
        if (dist < 34) {
          const isWeapon = ["SHOTGUN", "SNIPER", "GRENADE", "LASER"].includes(item.itemType);

          // For weapons: only auto-pickup if player is still using default starter LASER.
          // If player has already equipped a special gun (Sniper, Shotgun, etc.),
          // don't overwrite it automatically! They must press [F] to swap (Suroi style).
          if (isWeapon) {
            if (player.equippedWeapon === "LASER" && player.equippedWeapon !== item.itemType) {
              item.active = false;
              item.respawnTimer = 18.0;
              this.savePlayerCurrentWeaponAmmo(player);
              const cfg = WEAPON_CONFIGS[item.itemType] || WEAPON_CONFIGS.LASER;
              const store = this.playerWeaponAmmo.get(player.id);
              if (store) {
                store[item.itemType] = {
                  ammo: cfg.maxAmmo,
                  reserveAmmo: cfg.reserveAmmo,
                };
              }
              this.applyWeaponToPlayer(player, item.itemType);
              this.broadcast("itemPicked", {
                id: item.id,
                itemType: item.itemType,
                playerId: player.id,
                playerName: player.name,
                x: item.x,
                y: item.y,
              });
            }
            return;
          }

          // Consumables: auto-consume if needed
          let picked = false;
          if (item.itemType === "MEDKIT" && player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + 40);
            picked = true;
          } else if (item.itemType === "SHIELD" && player.shield < player.maxShield) {
            player.shield = Math.min(player.maxShield, player.shield + 50);
            picked = true;
          } else if (item.itemType === "SPEED") {
            player.activeBuff = "SPEED";
            player.buffTimer = 7.0;
            picked = true;
          } else if (item.itemType === "TRIPLE") {
            player.activeBuff = "TRIPLE";
            player.buffTimer = 9.0;
            picked = true;
          }

          if (picked) {
            item.active = false;
            item.respawnTimer = 16.0;
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

    if (this.state.players.size > 1 && alive === 1 && this.state.status !== "VICTORY" && lastAlivePlayer) {
      this.state.status = "VICTORY";
      this.state.winnerId = lastAlivePlayer.id;
      this.state.winnerName = lastAlivePlayer.name;

      console.log(`🏆 Match Finished! Winner: ${lastAlivePlayer.name} (${lastAlivePlayer.id})`);
      this.broadcast("matchVictory", {
        winnerId: lastAlivePlayer.id,
        winnerName: lastAlivePlayer.name,
        kills: lastAlivePlayer.kills,
      });
    }
  }

  private restartMatch() {
    this.resetZone();
    this.state.status = "PLAYING";
    this.state.winnerId = "";
    this.state.winnerName = "";
    this.state.projectiles.clear();
    this.state.traps.clear();

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

    // Revive and reposition all players
    this.state.players.forEach((player) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = player.isBot ? (1100 + Math.random() * 850) : (700 + Math.random() * 1100);
      player.x = this.state.zone.x + Math.cos(angle) * dist;
      player.y = this.state.zone.y + Math.sin(angle) * dist;
      player.hp = 100;
      player.maxHp = 100;
      player.shield = 50;
      player.maxShield = 50;
      this.initPlayerWeapons(player.id);
      this.applyWeaponToPlayer(player, "LASER");
      player.isGhost = false;
      player.isHidden = false;
      player.kills = 0;
      player.activeBuff = "";
      player.buffTimer = 0;
      player.dashCooldown = 0;
      player.shootCooldown = 0;
      player.trapCooldown = 0;

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
    this.broadcast("matchRestarted", {});
  }

  private updateZone(dt: number) {
    const zone = this.state.zone;

    if (!zone.isShrinking) {
      zone.timer -= dt;
      if (zone.timer <= 0) {
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
        zone.timer = Math.max(8, this.zonePhaseDuration - zone.phase * 2);
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
      { x: 1200, y: 1200, type: "MEDKIT" },
      { x: 2800, y: 1800, type: "SHIELD" },
      { x: 5200, y: 1800, type: "TRIPLE" },
      { x: 6800, y: 1200, type: "SPEED" },
      { x: 1200, y: 6800, type: "SHOTGUN" },
      { x: 2800, y: 5200, type: "MEDKIT" },
      { x: 5200, y: 5200, type: "SHIELD" },
      { x: 6800, y: 6800, type: "SNIPER" },
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
