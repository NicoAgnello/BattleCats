"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JungleRoom = void 0;
const colyseus_1 = require("colyseus");
const GameState_1 = require("./schema/GameState");
class JungleRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 16;
        this.projectileIdCounter = 0;
        this.trapIdCounter = 0;
        this.zonePhaseDuration = 25; // seconds per safe phase
        this.zoneShrinkDuration = 14; // seconds per shrink transition
        this.zoneShrinkTimer = 0;
        this.startRadius = 950;
        this.targetRadius = 950;
        this.botControllers = new Map();
        this.botNames = [
            "Michi Ninja",
            "Gato Samurái",
            "Garfield 9000",
            "Gatito Feroz",
            "Michi Táctico",
            "Bigotes Letal",
        ];
    }
    onCreate(options) {
        this.setState(new GameState_1.GameState());
        this.state.status = "WAITING";
        // Initialize static Bushes on map
        this.createStaticBushes();
        // Initialize Item Pickups
        this.createItemPickups();
        // Initialize Zone
        this.resetZone();
        // Initialize Bots
        this.spawnBots();
        // Register Message Handlers
        this.onMessage("move", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            if (typeof data.rotation === "number") {
                player.rotation = data.rotation;
            }
            // Calculate speed with buffs
            let baseSpeed = player.isGhost ? 280 : 220;
            if (player.activeBuff === "SPEED")
                baseSpeed *= 1.4;
            let dx = Number(data.dx) || 0;
            let dy = Number(data.dy) || 0;
            const mag = Math.hypot(dx, dy);
            if (mag > 0) {
                dx /= mag;
                dy /= mag;
            }
            const dt = 1 / 60;
            const newX = player.x + dx * baseSpeed * dt;
            const newY = player.y + dy * baseSpeed * dt;
            player.x = Math.max(30, Math.min(this.state.worldWidth - 30, newX));
            player.y = Math.max(30, Math.min(this.state.worldHeight - 30, newY));
        });
        this.onMessage("dash", (client) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isGhost || player.dashCooldown > 0)
                return;
            const dashDistance = 145;
            const nx = Math.cos(player.rotation);
            const ny = Math.sin(player.rotation);
            player.x = Math.max(30, Math.min(this.state.worldWidth - 30, player.x + nx * dashDistance));
            player.y = Math.max(30, Math.min(this.state.worldHeight - 30, player.y + ny * dashDistance));
            player.dashCooldown = 2.0;
            this.broadcast("playerDash", { id: client.sessionId, x: player.x, y: player.y });
        });
        this.onMessage("shoot", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isGhost || player.shootCooldown > 0)
                return;
            const angle = typeof data.angle === "number" ? data.angle : player.rotation;
            this.spawnProjectiles(player, angle);
            player.shootCooldown = player.activeBuff === "SPEED" ? 0.18 : 0.25;
        });
        this.onMessage("placeTrap", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || !player.isGhost || player.trapCooldown > 0)
                return;
            const trap = new GameState_1.Trap();
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
    resetZone() {
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
    spawnProjectiles(player, angle) {
        const isTriple = player.activeBuff === "TRIPLE";
        const angles = isTriple ? [angle - 0.18, angle, angle + 0.18] : [angle];
        const speed = 680;
        for (const a of angles) {
            const proj = new GameState_1.Projectile();
            proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
            proj.x = player.x + Math.cos(a) * 28;
            proj.y = player.y + Math.sin(a) * 28;
            proj.vx = Math.cos(a) * speed;
            proj.vy = Math.sin(a) * speed;
            proj.ownerId = player.id;
            proj.damage = player.isBot ? 14 : (isTriple ? 22 : 25);
            proj.lifetime = 2.4;
            this.state.projectiles.set(proj.id, proj);
        }
        this.broadcast("playerShoot", { id: player.id, x: player.x, y: player.y, angle, isTriple });
    }
    spawnBots() {
        this.botControllers.clear();
        const colors = [1, 2, 3, 4, 5, 2];
        for (let i = 0; i < this.botNames.length; i++) {
            const botId = `bot_${i + 1}`;
            const bot = new GameState_1.Player();
            bot.id = botId;
            bot.name = this.botNames[i];
            bot.isBot = true;
            bot.catColor = colors[i % colors.length];
            const angle = (i / this.botNames.length) * Math.PI * 2;
            const dist = 550 + Math.random() * 380;
            bot.x = this.state.zone.x + Math.cos(angle) * dist;
            bot.y = this.state.zone.y + Math.sin(angle) * dist;
            bot.rotation = angle + Math.PI;
            bot.hp = 100;
            bot.maxHp = 100;
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
    onJoin(client, options) {
        console.log(`Player connected: ${client.sessionId}`);
        let player = this.state.players.get(client.sessionId);
        if (!player) {
            player = new GameState_1.Player();
            player.id = client.sessionId;
            player.name = "Michi Campeón";
            player.isBot = false;
            player.catColor = 0; // 0 = Player Emerald
        }
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (this.state.zone.currentRadius * 0.5);
        player.x = this.state.zone.x + Math.cos(angle) * dist;
        player.y = this.state.zone.y + Math.sin(angle) * dist;
        player.rotation = 0;
        player.hp = 100;
        player.maxHp = 100;
        player.isGhost = false;
        player.isHidden = false;
        player.kills = 0;
        player.activeBuff = "";
        player.buffTimer = 0;
        this.state.players.set(client.sessionId, player);
        this.restartMatch();
    }
    onLeave(client, consented) {
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
    update(dt) {
        if (this.state.status !== "PLAYING") {
            return;
        }
        // 1. Update Bots AI
        this.updateBotsAI(dt);
        // 2. Update Buffs, Cooldowns & Bush Status for Players
        this.state.players.forEach((player) => {
            if (player.dashCooldown > 0)
                player.dashCooldown = Math.max(0, player.dashCooldown - dt);
            if (player.trapCooldown > 0)
                player.trapCooldown = Math.max(0, player.trapCooldown - dt);
            if (player.shootCooldown > 0)
                player.shootCooldown = Math.max(0, player.shootCooldown - dt);
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
                    player.hp -= damageRate * dt;
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                        this.broadcast("playerDied", { victimId: player.id, victimName: player.name, reason: "ZONE" });
                        this.updateAliveCount();
                    }
                }
            }
        });
        // 3. Update Item Pickups
        this.updateItems(dt);
        // 4. Update Projectiles & Check Collisions
        const projToDelete = [];
        this.state.projectiles.forEach((proj, key) => {
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;
            proj.lifetime -= dt;
            if (proj.lifetime <= 0 || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
                projToDelete.push(key);
                return;
            }
            // Collision check with alive players & bots
            this.state.players.forEach((player) => {
                if (projToDelete.includes(key))
                    return;
                if (player.isGhost)
                    return;
                if (player.id === proj.ownerId)
                    return;
                const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
                if (dist < 26) {
                    player.hp -= proj.damage;
                    projToDelete.push(key);
                    this.broadcast("hit", {
                        x: player.x,
                        y: player.y,
                        damage: proj.damage,
                        victimId: player.id,
                        shooterId: proj.ownerId,
                    });
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                        const shooter = this.state.players.get(proj.ownerId);
                        if (shooter)
                            shooter.kills += 1;
                        this.broadcast("kill", {
                            killerId: proj.ownerId,
                            killerName: shooter ? shooter.name : "Alguien",
                            victimId: player.id,
                            victimName: player.name,
                        });
                        this.updateAliveCount();
                    }
                }
            });
        });
        projToDelete.forEach((id) => this.state.projectiles.delete(id));
        // 5. Check Traps Collisions
        const trapToDelete = [];
        this.state.traps.forEach((trap, key) => {
            if (!trap.active)
                return;
            this.state.players.forEach((player) => {
                if (trapToDelete.includes(key))
                    return;
                if (player.isGhost)
                    return;
                const dist = Math.hypot(player.x - trap.x, player.y - trap.y);
                if (dist < 32) {
                    player.hp -= trap.damage;
                    trapToDelete.push(key);
                    this.broadcast("trapExplode", { x: trap.x, y: trap.y, victimId: player.id });
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                        const trapper = this.state.players.get(trap.ownerId);
                        if (trapper)
                            trapper.kills += 1;
                        this.broadcast("kill", {
                            killerId: trap.ownerId,
                            killerName: trapper ? trapper.name : "Fantasma",
                            victimId: player.id,
                            victimName: player.name,
                        });
                        this.updateAliveCount();
                    }
                }
            });
        });
        trapToDelete.forEach((id) => this.state.traps.delete(id));
        // 6. Safe Zone Circle Progression
        this.updateZone(dt);
    }
    updateBotsAI(dt) {
        this.botControllers.forEach((ctrl) => {
            const bot = this.state.players.get(ctrl.id);
            if (!bot)
                return;
            if (bot.isGhost) {
                // Ghost bot randomly places traps
                ctrl.dashTimer -= dt;
                if (ctrl.dashTimer <= 0 && bot.trapCooldown <= 0) {
                    const trap = new GameState_1.Trap();
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
            // Check distance to zone center
            const distToZone = Math.hypot(bot.x - this.state.zone.x, bot.y - this.state.zone.y);
            const isOutsideZone = distToZone > this.state.zone.currentRadius * 0.85;
            // Find nearest alive enemy
            let nearestEnemy = null;
            let minEnemyDist = Infinity;
            for (const [_, p] of this.state.players) {
                if (p.id === bot.id || p.isGhost)
                    continue;
                // Don't target hidden enemies in bush unless very close
                if (p.isHidden && !bot.isHidden) {
                    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
                    if (d > 120)
                        continue;
                }
                const d = Math.hypot(p.x - bot.x, p.y - bot.y);
                if (d < minEnemyDist) {
                    minEnemyDist = d;
                    nearestEnemy = p;
                }
            }
            // Direction logic
            ctrl.changeDirTimer -= dt;
            ctrl.dashTimer -= dt;
            if (isOutsideZone) {
                // Urgent: run toward safe zone center!
                const angleToCenter = Math.atan2(this.state.zone.y - bot.y, this.state.zone.x - bot.x);
                ctrl.targetDx = Math.cos(angleToCenter);
                ctrl.targetDy = Math.sin(angleToCenter);
                bot.rotation = angleToCenter;
            }
            else if (nearestEnemy && minEnemyDist < 450) {
                // Combat mode
                const targetAngle = Math.atan2(nearestEnemy.y - bot.y, nearestEnemy.x - bot.x);
                const angleVar = nearestEnemy.isBot ? (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.2;
                bot.rotation = targetAngle + angleVar;
                // Shoot if line of sight
                if (bot.shootCooldown <= 0 && minEnemyDist < 380) {
                    this.spawnProjectiles(bot, bot.rotation);
                    bot.shootCooldown = nearestEnemy.isBot ? (1.8 + Math.random() * 1.0) : (1.2 + Math.random() * 0.6);
                }
                // Tactical movement: strafe or approach
                if (minEnemyDist < 140) {
                    // Back up or circle
                    const perpAngle = targetAngle + Math.PI / 2;
                    ctrl.targetDx = Math.cos(perpAngle);
                    ctrl.targetDy = Math.sin(perpAngle);
                }
                else {
                    // Advance gently
                    ctrl.targetDx = Math.cos(targetAngle) * 0.8;
                    ctrl.targetDy = Math.sin(targetAngle) * 0.8;
                }
                // Occasional combat dash
                if (ctrl.dashTimer <= 0 && bot.dashCooldown <= 0 && minEnemyDist < 200) {
                    bot.dashCooldown = 3.5;
                    ctrl.dashTimer = 4 + Math.random() * 3;
                    const dashNx = Math.cos(bot.rotation);
                    const dashNy = Math.sin(bot.rotation);
                    bot.x = Math.max(30, Math.min(this.state.worldWidth - 30, bot.x + dashNx * 120));
                    bot.y = Math.max(30, Math.min(this.state.worldHeight - 30, bot.y + dashNy * 120));
                    this.broadcast("playerDash", { id: bot.id, x: bot.x, y: bot.y });
                }
            }
            else {
                // Patrol wander
                if (ctrl.changeDirTimer <= 0) {
                    const wanderAngle = Math.random() * Math.PI * 2;
                    ctrl.targetDx = Math.cos(wanderAngle) * 0.7;
                    ctrl.targetDy = Math.sin(wanderAngle) * 0.7;
                    bot.rotation = wanderAngle;
                    ctrl.changeDirTimer = 1.5 + Math.random() * 2;
                }
            }
            // Move bot
            let speed = bot.isGhost ? 260 : 190;
            if (bot.activeBuff === "SPEED")
                speed *= 1.35;
            bot.x = Math.max(30, Math.min(this.state.worldWidth - 30, bot.x + ctrl.targetDx * speed * dt));
            bot.y = Math.max(30, Math.min(this.state.worldHeight - 30, bot.y + ctrl.targetDy * speed * dt));
        });
    }
    updateItems(dt) {
        this.state.items.forEach((item) => {
            if (!item.active) {
                item.respawnTimer -= dt;
                if (item.respawnTimer <= 0) {
                    item.active = true;
                }
                return;
            }
            // Check pickup overlap with alive players/bots
            this.state.players.forEach((player) => {
                if (!item.active || player.isGhost)
                    return;
                const dist = Math.hypot(player.x - item.x, player.y - item.y);
                if (dist < 34) {
                    item.active = false;
                    item.respawnTimer = 16.0; // 16 seconds to respawn
                    if (item.itemType === "MEDKIT") {
                        player.hp = Math.min(player.maxHp, player.hp + 35);
                    }
                    else if (item.itemType === "SPEED") {
                        player.activeBuff = "SPEED";
                        player.buffTimer = 7.0;
                    }
                    else if (item.itemType === "TRIPLE") {
                        player.activeBuff = "TRIPLE";
                        player.buffTimer = 9.0;
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
    updateAliveCount() {
        let alive = 0;
        let lastAlivePlayer = null;
        for (const [_, p] of this.state.players) {
            if (!p.isGhost) {
                alive++;
                lastAlivePlayer = p;
            }
        }
        this.state.aliveCount = alive;
        // Victory check
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
    restartMatch() {
        this.resetZone();
        this.state.status = "PLAYING";
        this.state.winnerId = "";
        this.state.winnerName = "";
        this.state.projectiles.clear();
        this.state.traps.clear();
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
    updateZone(dt) {
        const zone = this.state.zone;
        if (!zone.isShrinking) {
            zone.timer -= dt;
            if (zone.timer <= 0) {
                zone.isShrinking = true;
                this.zoneShrinkTimer = this.zoneShrinkDuration;
                this.targetRadius = Math.max(120, zone.currentRadius * 0.65);
                zone.targetRadius = this.targetRadius;
            }
        }
        else {
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
    checkInBush(px, py) {
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
    createStaticBushes() {
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
            const bush = new GameState_1.Bush();
            bush.id = b.id;
            bush.x = b.x;
            bush.y = b.y;
            bush.width = b.width;
            bush.height = b.height;
            this.state.bushes.set(b.id, bush);
        });
    }
    createItemPickups() {
        const itemsData = [
            { id: "item_med_1", x: 1000, y: 1000, type: "MEDKIT" },
            { id: "item_med_2", x: 700, y: 700, type: "MEDKIT" },
            { id: "item_med_3", x: 1300, y: 1300, type: "MEDKIT" },
            { id: "item_spd_1", x: 800, y: 1200, type: "SPEED" },
            { id: "item_spd_2", x: 1200, y: 800, type: "SPEED" },
            { id: "item_tri_1", x: 500, y: 1000, type: "TRIPLE" },
            { id: "item_tri_2", x: 1500, y: 1000, type: "TRIPLE" },
            { id: "item_tri_3", x: 1000, y: 400, type: "TRIPLE" },
        ];
        itemsData.forEach((d) => {
            const item = new GameState_1.ItemPickup();
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
exports.JungleRoom = JungleRoom;
