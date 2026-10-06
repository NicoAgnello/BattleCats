"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JungleRoom = void 0;
const colyseus_1 = require("colyseus");
const GameState_1 = require("./schema/GameState");
class JungleRoom extends colyseus_1.Room {
    maxClients = 16;
    projectileIdCounter = 0;
    trapIdCounter = 0;
    zonePhaseDuration = 15; // seconds per safe phase
    zoneShrinkDuration = 10; // seconds per shrink transition
    zoneShrinkTimer = 0;
    startRadius = 950;
    targetRadius = 950;
    onCreate(options) {
        this.setState(new GameState_1.GameState());
        // Initialize static Bushes on map
        this.createStaticBushes();
        // Initialize Zone
        this.state.zone.x = this.state.worldWidth / 2;
        this.state.zone.y = this.state.worldHeight / 2;
        this.state.zone.currentRadius = this.startRadius;
        this.state.zone.targetRadius = this.startRadius;
        this.state.zone.timer = this.zonePhaseDuration;
        this.state.zone.phase = 1;
        this.state.zone.isShrinking = false;
        // Register Message Handlers
        this.onMessage("move", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player)
                return;
            // Update rotation
            if (typeof data.rotation === "number") {
                player.rotation = data.rotation;
            }
            // Calculate speed
            const speed = player.isGhost ? 280 : 220; // units per second
            let dx = Number(data.dx) || 0;
            let dy = Number(data.dy) || 0;
            // Normalize diagonal movement
            const mag = Math.hypot(dx, dy);
            if (mag > 0) {
                dx /= mag;
                dy /= mag;
            }
            const dt = 1 / 60; // approximate step
            const newX = player.x + dx * speed * dt;
            const newY = player.y + dy * speed * dt;
            // Map Boundaries
            player.x = Math.max(30, Math.min(this.state.worldWidth - 30, newX));
            player.y = Math.max(30, Math.min(this.state.worldHeight - 30, newY));
        });
        this.onMessage("dash", (client) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isGhost || player.dashCooldown > 0)
                return;
            // Dash impulse towards current rotation
            const dashDistance = 140;
            const nx = Math.cos(player.rotation);
            const ny = Math.sin(player.rotation);
            player.x = Math.max(30, Math.min(this.state.worldWidth - 30, player.x + nx * dashDistance));
            player.y = Math.max(30, Math.min(this.state.worldHeight - 30, player.y + ny * dashDistance));
            player.dashCooldown = 2.0; // 2 seconds cooldown
        });
        this.onMessage("shoot", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isGhost || player.shootCooldown > 0)
                return;
            const angle = typeof data.angle === "number" ? data.angle : player.rotation;
            const speed = 650; // projectile speed
            const proj = new GameState_1.Projectile();
            proj.id = `proj_${++this.projectileIdCounter}_${Date.now()}`;
            proj.x = player.x + Math.cos(angle) * 25;
            proj.y = player.y + Math.sin(angle) * 25;
            proj.vx = Math.cos(angle) * speed;
            proj.vy = Math.sin(angle) * speed;
            proj.ownerId = client.sessionId;
            proj.damage = 25;
            proj.lifetime = 2.5;
            this.state.projectiles.set(proj.id, proj);
            player.shootCooldown = 0.25; // 250ms cooldown
        });
        this.onMessage("placeTrap", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player || !player.isGhost || player.trapCooldown > 0)
                return;
            const trap = new GameState_1.Trap();
            trap.id = `trap_${++this.trapIdCounter}_${Date.now()}`;
            // Place trap at requested coordinates or at ghost location
            const posX = typeof data?.x === "number" ? data.x : player.x;
            const posY = typeof data?.y === "number" ? data.y : player.y;
            // Keep inside map limits
            trap.x = Math.max(40, Math.min(this.state.worldWidth - 40, posX));
            trap.y = Math.max(40, Math.min(this.state.worldHeight - 40, posY));
            trap.ownerId = client.sessionId;
            trap.active = true;
            this.state.traps.set(trap.id, trap);
            player.trapCooldown = 6.0; // 6 seconds cooldown
        });
        // 60 FPS Game Loop
        this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000), 1000 / 60);
    }
    onJoin(client, options) {
        console.log(`Player connected: ${client.sessionId}`);
        const player = new GameState_1.Player();
        player.id = client.sessionId;
        // Spawn inside initial safe zone area
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (this.state.zone.currentRadius * 0.6);
        player.x = this.state.zone.x + Math.cos(angle) * dist;
        player.y = this.state.zone.y + Math.sin(angle) * dist;
        player.rotation = 0;
        player.hp = 100;
        player.maxHp = 100;
        player.isGhost = false;
        player.isHidden = false;
        this.state.players.set(client.sessionId, player);
    }
    onLeave(client, consented) {
        console.log(`Player left: ${client.sessionId}`);
        this.state.players.delete(client.sessionId);
    }
    update(dt) {
        // 1. Update Cooldowns & Bush Status for Players
        this.state.players.forEach((player) => {
            if (player.dashCooldown > 0)
                player.dashCooldown = Math.max(0, player.dashCooldown - dt);
            if (player.trapCooldown > 0)
                player.trapCooldown = Math.max(0, player.trapCooldown - dt);
            if (player.shootCooldown > 0)
                player.shootCooldown = Math.max(0, player.shootCooldown - dt);
            // Check Bush Overlap
            player.isHidden = this.checkInBush(player.x, player.y);
            // Zone Damage to Alive Players outside safe circle
            if (!player.isGhost) {
                const distFromZoneCenter = Math.hypot(player.x - this.state.zone.x, player.y - this.state.zone.y);
                if (distFromZoneCenter > this.state.zone.currentRadius) {
                    const damageRate = 6.0 + this.state.zone.phase * 2.5; // Damage scales with zone phase
                    player.hp -= damageRate * dt;
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                    }
                }
            }
        });
        // 2. Update Projectiles & Check Collisions
        const projToDelete = [];
        this.state.projectiles.forEach((proj, key) => {
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;
            proj.lifetime -= dt;
            if (proj.lifetime <= 0 || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
                projToDelete.push(key);
                return;
            }
            // Collision check with alive players
            this.state.players.forEach((player) => {
                if (projToDelete.includes(key))
                    return;
                if (player.isGhost)
                    return; // Cannot hit ghosts
                if (player.id === proj.ownerId)
                    return; // Cannot self-hit
                const dist = Math.hypot(player.x - proj.x, player.y - proj.y);
                if (dist < 24) { // Player radius (20) + projectile radius (4)
                    player.hp -= proj.damage;
                    projToDelete.push(key);
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                        // Credit kill to owner
                        const shooter = this.state.players.get(proj.ownerId);
                        if (shooter)
                            shooter.kills += 1;
                    }
                }
            });
        });
        projToDelete.forEach((id) => this.state.projectiles.delete(id));
        // 3. Check Traps Collisions with Alive Players
        const trapToDelete = [];
        this.state.traps.forEach((trap, key) => {
            if (!trap.active)
                return;
            this.state.players.forEach((player) => {
                if (trapToDelete.includes(key))
                    return;
                if (player.isGhost)
                    return; // Ghosts trigger no traps
                const dist = Math.hypot(player.x - trap.x, player.y - trap.y);
                if (dist < 30) {
                    player.hp -= trap.damage;
                    trapToDelete.push(key);
                    if (player.hp <= 0) {
                        player.hp = 0;
                        player.isGhost = true;
                        const trapper = this.state.players.get(trap.ownerId);
                        if (trapper)
                            trapper.kills += 1;
                    }
                }
            });
        });
        trapToDelete.forEach((id) => this.state.traps.delete(id));
        // 4. Safe Zone Circle Progression
        this.updateZone(dt);
    }
    updateZone(dt) {
        const zone = this.state.zone;
        if (!zone.isShrinking) {
            zone.timer -= dt;
            if (zone.timer <= 0) {
                // Start shrinking to new smaller target
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
}
exports.JungleRoom = JungleRoom;
