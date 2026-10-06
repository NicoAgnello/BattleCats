import { Room, Client } from "colyseus";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup, Obstacle } from "./schema/GameState";

interface MovePayload {
  dx: number;
  dy: number;
  rotation: number;
}

interface ShootPayload {
  angle: number;
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

export class JungleRoom extends Room<GameState> {
  maxClients = 16;
  private projectileIdCounter = 0;
  private trapIdCounter = 0;
  private obstacleIdCounter = 0;
  private itemIdCounter = 0;
  private zonePhaseDuration = 25; // seconds per safe phase
  private zoneShrinkDuration = 14; // seconds per shrink transition
  private zoneShrinkTimer = 0;
  private startRadius = 950;
  private targetRadius = 950;

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

      let dx = Number(data.dx) || 0;
      let dy = Number(data.dy) || 0;

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        dx /= mag;
        dy /= mag;
      }

      const dt = 1 / 60;
      let newX = player.x + dx * baseSpeed * dt;
      let newY = player.y + dy * baseSpeed * dt;

      // Obstacle collision response (stop player from walking into solid obstacles)
      if (!player.isGhost) {
        const pRadius = 22;
        this.state.obstacles.forEach((obs) => {
          if (obs.destroyed) return;
          const dist = Math.hypot(newX - obs.x, newY - obs.y);
          const minDist = pRadius + obs.radius;
          if (dist < minDist && dist > 0) {
            const overlap = minDist - dist;
            const nx = (newX - obs.x) / dist;
            const ny = (newY - obs.y) / dist;
            newX += nx * overlap;
            newY += ny * overlap;
          }
        });
      }

      player.x = Math.max(30, Math.min(this.state.worldWidth - 30, newX));
      player.y = Math.max(30, Math.min(this.state.worldHeight - 30, newY));
    });

    this.onMessage("dash", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.dashCooldown > 0) return;

      const dashDistance = 145;
      const nx = Math.cos(player.rotation);
      const ny = Math.sin(player.rotation);

      player.x = Math.max(30, Math.min(this.state.worldWidth - 30, player.x + nx * dashDistance));
      player.y = Math.max(30, Math.min(this.state.worldHeight - 30, player.y + ny * dashDistance));
      player.dashCooldown = 2.0;

      this.broadcast("playerDash", { id: client.sessionId, x: player.x, y: player.y });
    });

    this.onMessage("shoot", (client, data: ShootPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost || player.shootCooldown > 0) return;

      const angle = typeof data.angle === "number" ? data.angle : player.rotation;
      this.spawnProjectiles(player, angle);
      
      const w = player.equippedWeapon;
      let cooldown = 0.25;
      if (w === "SHOTGUN") cooldown = 0.65;
      else if (w === "SNIPER") cooldown = 0.85;
      else if (w === "GRENADE") cooldown = 0.75;
      else if (w === "MELEE") cooldown = 0.2;
      else cooldown = 0.22;

      if (player.activeBuff === "SPEED") cooldown *= 0.7;
      player.shootCooldown = cooldown;
    });

    this.onMessage("switchWeapon", (client, data: SwitchWeaponPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isGhost) return;
      const valid = ["LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"];
      if (valid.includes(data.weapon)) {
        player.equippedWeapon = data.weapon;
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
    this.startRadius = 950;
    this.targetRadius = 950;
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
        if (killer) killer.kills += 1;
        this.broadcast("kill", {
          killerId: attackerId,
          killerName: killer ? killer.name : "Alguien",
          victimId: player.id,
          victimName: player.name,
          weapon: weaponName,
        });
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
  }

  private spawnProjectiles(player: Player, angle: number) {
    const weapon = player.equippedWeapon;
    const isTriple = player.activeBuff === "TRIPLE";

    if (weapon === "MELEE") {
      // Melee attack: Instant slash area
      const slashX = player.x + Math.cos(angle) * 35;
      const slashY = player.y + Math.sin(angle) * 35;
      
      this.state.players.forEach((target) => {
        if (target.id === player.id || target.isGhost) return;
        const d = Math.hypot(target.x - slashX, target.y - slashY);
        if (d < 50) {
          this.applyDamage(target, 35, player.id, "Garras Felinas");
          this.broadcast("hit", { x: target.x, y: target.y, damage: 35, victimId: target.id, shooterId: player.id });
        }
      });

      // Also damage obstacles
      this.state.obstacles.forEach((obs) => {
        if (obs.destroyed) return;
        const d = Math.hypot(obs.x - slashX, obs.y - slashY);
        if (d < 50 + obs.radius) {
          this.damageObstacle(obs, 35, player.id);
        }
      });

      this.broadcast("playerMelee", { id: player.id, x: slashX, y: slashY, angle });
      return;
    }

    if (weapon === "SHOTGUN") {
      const pelletCount = isTriple ? 7 : 5;
      const spread = 0.28;
      for (let i = 0; i < pelletCount; i++) {
        const offset = (i - (pelletCount - 1) / 2) * (spread / (pelletCount - 1));
        const a = angle + offset + (Math.random() - 0.5) * 0.04;
        const speed = 640 + Math.random() * 40;

        const proj = new Projectile();
        proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
        proj.x = player.x + Math.cos(a) * 26;
        proj.y = player.y + Math.sin(a) * 26;
        proj.vx = Math.cos(a) * speed;
        proj.vy = Math.sin(a) * speed;
        proj.ownerId = player.id;
        proj.damage = player.isBot ? 9 : 13;
        proj.lifetime = 1.1;
        proj.projType = "PELLET";
        proj.radius = 4;
        this.state.projectiles.set(proj.id, proj);
      }
      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SHOTGUN" });
      return;
    }

    if (weapon === "SNIPER") {
      const speed = 1100;
      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(angle) * 30;
      proj.y = player.y + Math.sin(angle) * 30;
      proj.vx = Math.cos(angle) * speed;
      proj.vy = Math.sin(angle) * speed;
      proj.ownerId = player.id;
      proj.damage = player.isBot ? 30 : 52;
      proj.lifetime = 2.8;
      proj.projType = "SNIPER_BEAM";
      proj.radius = 7;
      this.state.projectiles.set(proj.id, proj);

      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "SNIPER" });
      return;
    }

    if (weapon === "GRENADE") {
      const speed = 380;
      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(angle) * 26;
      proj.y = player.y + Math.sin(angle) * 26;
      proj.vx = Math.cos(angle) * speed;
      proj.vy = Math.sin(angle) * speed;
      proj.ownerId = player.id;
      proj.damage = 55;
      proj.lifetime = 1.2;
      proj.projType = "GRENADE";
      proj.radius = 10;
      this.state.projectiles.set(proj.id, proj);

      this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "GRENADE" });
      return;
    }

    // Default LASER rifle
    const angles = isTriple ? [angle - 0.18, angle, angle + 0.18] : [angle];
    const speed = 720;

    for (const a of angles) {
      const proj = new Projectile();
      proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
      proj.x = player.x + Math.cos(a) * 28;
      proj.y = player.y + Math.sin(a) * 28;
      proj.vx = Math.cos(a) * speed;
      proj.vy = Math.sin(a) * speed;
      proj.ownerId = player.id;
      proj.damage = player.isBot ? 14 : (isTriple ? 20 : 25);
      proj.lifetime = 2.4;
      proj.projType = "LASER";
      proj.radius = 6;
      this.state.projectiles.set(proj.id, proj);
    }

    this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, weapon: "LASER", isTriple });
  }

  private damageObstacle(obs: Obstacle, dmg: number, shooterId?: string) {
    if (obs.destroyed) return;
    obs.hp -= dmg;
    if (obs.hp <= 0) {
      obs.hp = 0;
      obs.destroyed = true;

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

    // Damage nearby players & bots
    this.state.players.forEach((player) => {
      if (player.isGhost) return;
      const dist = Math.hypot(player.x - x, player.y - y);
      if (dist < 140) {
        const falloff = 1 - dist / 140;
        const dmg = Math.floor(65 * falloff);
        this.applyDamage(player, dmg, shooterId, "Barril Explosivo");
      }
    });

    // Destroy adjacent crates
    this.state.obstacles.forEach((obs) => {
      if (obs.destroyed) return;
      const dist = Math.hypot(obs.x - x, obs.y - y);
      if (dist < 140) {
        this.damageObstacle(obs, 100, shooterId);
      }
    });
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
  }

  private spawnBots() {
    this.botControllers.clear();
    const colors = [1, 2, 3, 4, 5, 2];
    const botWeapons = ["LASER", "SHOTGUN", "SNIPER", "LASER", "SHOTGUN", "SNIPER"];

    for (let i = 0; i < this.botNames.length; i++) {
      const botId = `bot_${i + 1}`;
      const bot = new Player();
      bot.id = botId;
      bot.name = this.botNames[i];
      bot.isBot = true;
      bot.catColor = colors[i % colors.length];
      bot.equippedWeapon = botWeapons[i % botWeapons.length];

      const angle = (i / this.botNames.length) * Math.PI * 2;
      const dist = 550 + Math.random() * 380;
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
      ? Math.max(0, Math.min(5, Math.floor(options.skin)))
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
    const dist = Math.random() * (this.state.zone.currentRadius * 0.5);
    player.x = this.state.zone.x + Math.cos(angle) * dist;
    player.y = this.state.zone.y + Math.sin(angle) * dist;
    player.rotation = 0;
    player.hp = 100;
    player.maxHp = 100;
    player.shield = 50;
    player.maxShield = 50;
    player.equippedWeapon = "LASER";
    player.isGhost = false;
    player.isHidden = false;
    player.kills = 0;
    player.activeBuff = "";
    player.buffTimer = 0;

    this.state.players.set(client.sessionId, player);
    this.restartMatch();
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`Player left: ${client.sessionId}`);
    this.state.players.delete(client.sessionId);
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
      if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      if (player.trapCooldown > 0) player.trapCooldown = Math.max(0, player.trapCooldown - dt);
      if (player.shootCooldown > 0) player.shootCooldown = Math.max(0, player.shootCooldown - dt);

      if (player.emoteTimer > 0) {
        player.emoteTimer -= dt;
        if (player.emoteTimer <= 0) player.lastEmote = "";
      }

      // Buffs expiration
      if (player.buffTimer > 0) {
        player.buffTimer -= dt;
        if (player.buffTimer <= 0) {
          player.activeBuff = "";
        }
      }

      // Check Bush Overlap
      player.isHidden = this.checkInBush(player.x, player.y);

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

    // 4. Update Projectiles & Check Collisions (Players & Obstacles)
    const projToDelete = new Set<string>();
    this.state.projectiles.forEach((proj, key) => {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.lifetime -= dt;

      if (proj.lifetime <= 0) {
        projToDelete.add(key);
        // Grenade explodes at end of lifetime
        if (proj.projType === "GRENADE") {
          this.triggerBarrelExplosion(proj.x, proj.y, proj.ownerId);
        }
        return;
      }

      if (proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
        projToDelete.add(key);
        return;
      }

      // Collision check with Obstacles
      this.state.obstacles.forEach((obs) => {
        if (projToDelete.has(key) || obs.destroyed) return;
        const dist = Math.hypot(obs.x - proj.x, obs.y - proj.y);
        if (dist < obs.radius + proj.radius) {
          projToDelete.add(key);
          this.damageObstacle(obs, proj.damage, proj.ownerId);
          this.broadcast("hit", { x: proj.x, y: proj.y, damage: proj.damage });
        }
      });

      // Collision check with alive players & bots
      this.state.players.forEach((player) => {
        if (projToDelete.has(key)) return;
        if (player.isGhost) return;
        if (player.id === proj.ownerId) return;

        const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
        if (dist < 26) {
          projToDelete.add(key);
          if (proj.projType === "GRENADE") {
            this.triggerBarrelExplosion(proj.x, proj.y, proj.ownerId);
          } else {
            this.applyDamage(player, proj.damage, proj.ownerId, "Bláster");
            this.broadcast("hit", {
              x: player.x,
              y: player.y,
              damage: proj.damage,
              victimId: player.id,
              shooterId: proj.ownerId,
            });
          }
        }
      });
    });

    projToDelete.forEach((id) => this.state.projectiles.delete(id));

    // 5. Check Traps Collisions
    const trapToDelete = new Set<string>();
    this.state.traps.forEach((trap, key) => {
      if (!trap.active) return;

      this.state.players.forEach((player) => {
        if (trapToDelete.has(key)) return;
        if (player.isGhost) return;

        const dist = Math.hypot(player.x - trap.x, player.y - trap.y);
        if (dist < 32) {
          trapToDelete.add(key);
          this.broadcast("trapExplode", { x: trap.x, y: trap.y, victimId: player.id });
          this.applyDamage(player, trap.damage, trap.ownerId, "Trampa Espectral");
        }
      });
    });

    trapToDelete.forEach((id) => this.state.traps.delete(id));

    // 6. Safe Zone Circle Progression
    this.updateZone(dt);
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
          bot.trapCooldown = 7.0;
          ctrl.dashTimer = 8 + Math.random() * 8;
        }
        return;
      }

      const distToZone = Math.hypot(bot.x - this.state.zone.x, bot.y - this.state.zone.y);
      const isOutsideZone = distToZone > this.state.zone.currentRadius * 0.85;

      let nearestEnemy: Player | null = null;
      let minEnemyDist = Infinity;

      for (const [_, p] of this.state.players) {
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
          bot.dashCooldown = 3.5;
          ctrl.dashTimer = 4 + Math.random() * 3;
          const dashNx = Math.cos(bot.rotation);
          const dashNy = Math.sin(bot.rotation);
          bot.x = Math.max(30, Math.min(this.state.worldWidth - 30, bot.x + dashNx * 120));
          bot.y = Math.max(30, Math.min(this.state.worldHeight - 30, bot.y + dashNy * 120));
          this.broadcast("playerDash", { id: bot.id, x: bot.x, y: bot.y });
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
          } else if (item.itemType === "SHOTGUN" || item.itemType === "SNIPER" || item.itemType === "GRENADE") {
            player.equippedWeapon = item.itemType;
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

    // Reset obstacles
    this.state.obstacles.forEach((obs) => {
      obs.destroyed = false;
      obs.hp = obs.maxHp;
    });

    // Respawn all items
    this.state.items.forEach((item) => {
      item.active = true;
      item.respawnTimer = 0;
    });

    // Revive and reposition all players
    this.state.players.forEach((player) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = player.isBot ? (550 + Math.random() * 380) : (180 + Math.random() * 220);
      player.x = this.state.zone.x + Math.cos(angle) * dist;
      player.y = this.state.zone.y + Math.sin(angle) * dist;
      player.hp = 100;
      player.maxHp = 100;
      player.shield = 50;
      player.maxShield = 50;
      player.equippedWeapon = "LASER";
      player.isGhost = false;
      player.isHidden = false;
      player.kills = 0;
      player.activeBuff = "";
      player.buffTimer = 0;
      player.dashCooldown = 0;
      player.shootCooldown = 0;
      player.trapCooldown = 0;
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

  private createStaticBushes() {
    const bushData = [
      { id: "bush_1", x: 400, y: 400, width: 200, height: 140 },
      { id: "bush_2", x: 1600, y: 400, width: 220, height: 150 },
      { id: "bush_3", x: 400, y: 1600, width: 240, height: 160 },
      { id: "bush_4", x: 1600, y: 1600, width: 220, height: 140 },
      { id: "bush_5", x: 1000, y: 600, width: 280, height: 180 },
      { id: "bush_6", x: 1000, y: 1400, width: 280, height: 180 },
      { id: "bush_7", x: 600, y: 1000, width: 160, height: 260 },
      { id: "bush_8", x: 1400, y: 1000, width: 160, height: 260 },
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
    const obstacleData = [
      // Wood Crates (Destructible, drop loot)
      { type: "CRATE", x: 500, y: 500, hp: 60, r: 30 },
      { type: "CRATE", x: 1500, y: 500, hp: 60, r: 30 },
      { type: "CRATE", x: 500, y: 1500, hp: 60, r: 30 },
      { type: "CRATE", x: 1500, y: 1500, hp: 60, r: 30 },
      { type: "CRATE", x: 900, y: 900, hp: 60, r: 30 },
      { type: "CRATE", x: 1100, y: 1100, hp: 60, r: 30 },
      { type: "CRATE", x: 900, y: 1100, hp: 60, r: 30 },
      { type: "CRATE", x: 1100, y: 900, hp: 60, r: 30 },

      // Explosive Barrels (Detonate on destroy!)
      { type: "BARREL", x: 750, y: 500, hp: 40, r: 26 },
      { type: "BARREL", x: 1250, y: 500, hp: 40, r: 26 },
      { type: "BARREL", x: 750, y: 1500, hp: 40, r: 26 },
      { type: "BARREL", x: 1250, y: 1500, hp: 40, r: 26 },

      // Boulders (Indestructible stone cover)
      { type: "BOULDER", x: 800, y: 800, hp: 9999, r: 42 },
      { type: "BOULDER", x: 1200, y: 1200, hp: 9999, r: 42 },
      { type: "BOULDER", x: 1200, y: 800, hp: 9999, r: 42 },
      { type: "BOULDER", x: 800, y: 1200, hp: 9999, r: 42 },

      // Trees (Lush solid trees)
      { type: "TREE", x: 300, y: 800, hp: 9999, r: 36 },
      { type: "TREE", x: 1700, y: 800, hp: 9999, r: 36 },
      { type: "TREE", x: 300, y: 1200, hp: 9999, r: 36 },
      { type: "TREE", x: 1700, y: 1200, hp: 9999, r: 36 },
    ];

    obstacleData.forEach((d) => {
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
    });
  }

  private createItemPickups() {
    const itemsData = [
      { id: "item_med_1", x: 1000, y: 1000, type: "MEDKIT" },
      { id: "item_shd_1", x: 1000, y: 800, type: "SHIELD" },
      { id: "item_shd_2", x: 1000, y: 1200, type: "SHIELD" },
      { id: "item_sg_1", x: 700, y: 700, type: "SHOTGUN" },
      { id: "item_snp_1", x: 1300, y: 1300, type: "SNIPER" },
      { id: "item_grn_1", x: 800, y: 1200, type: "GRENADE" },
      { id: "item_spd_2", x: 1200, y: 800, type: "SPEED" },
      { id: "item_tri_1", x: 500, y: 1000, type: "TRIPLE" },
    ];

    itemsData.forEach((d) => {
      const item = new ItemPickup();
      item.id = d.id;
      item.x = d.x;
      item.y = d.y;
      item.itemType = d.type;
      item.active = true;
      item.respawnTimer = 0;
      this.state.items.set(d.id, item);
    });
  }
}
