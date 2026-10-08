"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = exports.ZoneState = exports.ItemPickup = exports.Obstacle = exports.Bush = exports.Trap = exports.Projectile = exports.Player = exports.AOI_DISTANCE_SQ = exports.AOI_DISTANCE = void 0;
exports.aoiDistanceFilter = aoiDistanceFilter;
const schema_1 = require("@colyseus/schema");
/**
 * Radio límite del Área de Interés (AoI) en píxeles.
 * 1200 px cubre la resolución máxima de pantalla visible (ej. 1920x1080 centrado = ~960px al borde)
 * más un margen de seguridad generoso de ~240px para evitar pop-in en las orillas.
 */
exports.AOI_DISTANCE = 1200;
exports.AOI_DISTANCE_SQ = exports.AOI_DISTANCE * exports.AOI_DISTANCE; // 1,440,000 px^2
/**
 * Función de filtrado por distancia para @filter.
 * Valida la distancia entre el receptor y la entidad.
 * Si excede 1200px, descarta la sincronización para ese cliente.
 */
function aoiDistanceFilter(client, value, root) {
    if (!root || !client || !client.sessionId)
        return true;
    const me = root.players?.get(client.sessionId);
    if (!me)
        return true;
    // Siempre sincronizar con el propio jugador o sus propios proyectiles/trampas
    if (this.id === client.sessionId || this.ownerId === client.sessionId) {
        return true;
    }
    const dx = this.x - me.x;
    const dy = this.y - me.y;
    return (dx * dx + dy * dy) <= exports.AOI_DISTANCE_SQ;
}
class Player extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.name = "Gato";
        this.isBot = false;
        this.catColor = 0;
        this.x = 0;
        this.y = 0;
        this.rotation = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.shield = 0;
        this.maxShield = 50;
        this.isGhost = false;
        this.isHidden = false;
        this.dashCooldown = 0; // remaining s
        this.trapCooldown = 0; // remaining s
        this.shootCooldown = 0; // remaining s
        this.kills = 0;
        this.activeBuff = ""; // "SPEED", "TRIPLE", ""
        this.buffTimer = 0;
        this.equippedWeapon = "LASER"; // "LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"
        this.ammo = 12;
        this.maxAmmo = 12;
        this.reserveAmmo = 24;
        this.isReloading = false;
        this.reloadTimer = 0;
        this.maxReloadTimer = 2.0;
        this.lastEmote = ""; // "🐾", "🔥", "💀", "😎", "😿", "🏆"
        this.emoteTimer = 0;
    }
}
exports.Player = Player;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "name", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "isBot", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "catColor", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "x", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "y", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "rotation", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "hp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "maxHp", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "shield", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "maxShield", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "isGhost", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "isHidden", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "dashCooldown", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "trapCooldown", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "shootCooldown", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "kills", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "activeBuff", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "buffTimer", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "equippedWeapon", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "ammo", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "maxAmmo", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "reserveAmmo", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "isReloading", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "reloadTimer", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "maxReloadTimer", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "lastEmote", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "emoteTimer", void 0);
class Projectile extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.ownerId = "";
        this.damage = 25;
        this.lifetime = 2.0;
        this.projType = "LASER"; // "LASER", "PELLET", "SNIPER_BEAM", "GRENADE"
        this.radius = 6;
        this.targetX = 0;
        this.targetY = 0;
        this.isArmed = false;
    }
}
exports.Projectile = Projectile;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Projectile.prototype, "id", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "x", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "y", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "vx", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "vy", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Projectile.prototype, "ownerId", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "damage", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "lifetime", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Projectile.prototype, "projType", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "radius", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "targetX", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "targetY", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Projectile.prototype, "isArmed", void 0);
class Trap extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.ownerId = "";
        this.active = true;
        this.damage = 35;
    }
}
exports.Trap = Trap;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Trap.prototype, "id", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Trap.prototype, "x", void 0);
__decorate([
    (0, schema_1.filter)(aoiDistanceFilter),
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Trap.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Trap.prototype, "ownerId", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Trap.prototype, "active", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Trap.prototype, "damage", void 0);
class Bush extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.width = 160;
        this.height = 120;
    }
}
exports.Bush = Bush;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Bush.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Bush.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Bush.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Bush.prototype, "width", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Bush.prototype, "height", void 0);
class Obstacle extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.obstacleType = "CRATE"; // "CRATE", "BARREL", "BOULDER", "TREE"
        this.hp = 60;
        this.maxHp = 60;
        this.radius = 32;
        this.destroyed = false;
    }
}
exports.Obstacle = Obstacle;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Obstacle.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Obstacle.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Obstacle.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Obstacle.prototype, "obstacleType", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Obstacle.prototype, "hp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Obstacle.prototype, "maxHp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Obstacle.prototype, "radius", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Obstacle.prototype, "destroyed", void 0);
class ItemPickup extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.itemType = "MEDKIT"; // "MEDKIT", "SPEED", "TRIPLE", "SHIELD", "SHOTGUN", "SNIPER", "GRENADE"
        this.active = true;
        this.respawnTimer = 0;
    }
}
exports.ItemPickup = ItemPickup;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], ItemPickup.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ItemPickup.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ItemPickup.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], ItemPickup.prototype, "itemType", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], ItemPickup.prototype, "active", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ItemPickup.prototype, "respawnTimer", void 0);
class ZoneState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.x = 2400;
        this.y = 2400;
        this.currentRadius = 2300;
        this.targetRadius = 2300;
        this.phase = 1;
        this.timer = 35;
        this.isShrinking = false;
    }
}
exports.ZoneState = ZoneState;
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "currentRadius", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "targetRadius", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "phase", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], ZoneState.prototype, "timer", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], ZoneState.prototype, "isShrinking", void 0);
class GameState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        /**
         * Filtrado a nivel de MapSchema de Jugadores (Area of Interest).
         * Solo sincroniza jugadores que estén a menos de 1200 píxeles del cliente receptor.
         */
        this.players = new schema_1.MapSchema();
        /**
         * Filtrado a nivel de MapSchema de Proyectiles (Area of Interest).
         * No sincroniza balas disparadas en el otro extremo del mapa gigante.
         */
        this.projectiles = new schema_1.MapSchema();
        /**
         * Filtrado a nivel de MapSchema de Trampas (Area of Interest).
         */
        this.traps = new schema_1.MapSchema();
        this.bushes = new schema_1.MapSchema();
        this.obstacles = new schema_1.MapSchema();
        this.items = new schema_1.MapSchema();
        this.zone = new ZoneState();
        this.worldWidth = 8000;
        this.worldHeight = 8000;
        this.status = "PLAYING"; // WAITING, PLAYING, VICTORY
        this.aliveCount = 1;
        this.winnerId = "";
        this.winnerName = "";
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.filterChildren)(function (client, key, value) {
        if (!client || !client.sessionId)
            return true;
        const me = this.players.get(client.sessionId);
        if (!me)
            return true;
        if (key === client.sessionId)
            return true; // El cliente siempre se sincroniza a sí mismo
        const dx = value.x - me.x;
        const dy = value.y - me.y;
        return (dx * dx + dy * dy) <= exports.AOI_DISTANCE_SQ;
    }),
    (0, schema_1.type)({ map: Player }),
    __metadata("design:type", Object)
], GameState.prototype, "players", void 0);
__decorate([
    (0, schema_1.filterChildren)(function (client, key, value) {
        if (!client || !client.sessionId)
            return true;
        const me = this.players.get(client.sessionId);
        if (!me)
            return true;
        if (value.ownerId === client.sessionId)
            return true; // Siempre ver proyectiles propios
        const dx = value.x - me.x;
        const dy = value.y - me.y;
        return (dx * dx + dy * dy) <= exports.AOI_DISTANCE_SQ;
    }),
    (0, schema_1.type)({ map: Projectile }),
    __metadata("design:type", Object)
], GameState.prototype, "projectiles", void 0);
__decorate([
    (0, schema_1.filterChildren)(function (client, key, value) {
        if (!client || !client.sessionId)
            return true;
        const me = this.players.get(client.sessionId);
        if (!me)
            return true;
        if (value.ownerId === client.sessionId)
            return true;
        const dx = value.x - me.x;
        const dy = value.y - me.y;
        return (dx * dx + dy * dy) <= exports.AOI_DISTANCE_SQ;
    }),
    (0, schema_1.type)({ map: Trap }),
    __metadata("design:type", Object)
], GameState.prototype, "traps", void 0);
__decorate([
    (0, schema_1.type)({ map: Bush }),
    __metadata("design:type", Object)
], GameState.prototype, "bushes", void 0);
__decorate([
    (0, schema_1.type)({ map: Obstacle }),
    __metadata("design:type", Object)
], GameState.prototype, "obstacles", void 0);
__decorate([
    (0, schema_1.type)({ map: ItemPickup }),
    __metadata("design:type", Object)
], GameState.prototype, "items", void 0);
__decorate([
    (0, schema_1.type)(ZoneState),
    __metadata("design:type", Object)
], GameState.prototype, "zone", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameState.prototype, "worldWidth", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameState.prototype, "worldHeight", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameState.prototype, "status", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameState.prototype, "aliveCount", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameState.prototype, "winnerId", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameState.prototype, "winnerName", void 0);
