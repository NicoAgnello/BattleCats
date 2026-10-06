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
exports.GameState = exports.ZoneState = exports.ItemPickup = exports.Bush = exports.Trap = exports.Projectile = exports.Player = void 0;
const schema_1 = require("@colyseus/schema");
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
        this.isGhost = false;
        this.isHidden = false;
        this.dashCooldown = 0; // remaining s
        this.trapCooldown = 0; // remaining s
        this.shootCooldown = 0; // remaining s
        this.kills = 0;
        this.activeBuff = ""; // "SPEED", "TRIPLE", ""
        this.buffTimer = 0;
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
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "rotation", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "hp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Player.prototype, "maxHp", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "isGhost", void 0);
__decorate([
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
    }
}
exports.Projectile = Projectile;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Projectile.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Projectile.prototype, "vx", void 0);
__decorate([
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
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], Trap.prototype, "x", void 0);
__decorate([
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
class ItemPickup extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.x = 0;
        this.y = 0;
        this.itemType = "MEDKIT"; // "MEDKIT", "SPEED", "TRIPLE"
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
        this.x = 1000;
        this.y = 1000;
        this.currentRadius = 950;
        this.targetRadius = 950;
        this.phase = 1;
        this.timer = 15;
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
        this.players = new schema_1.MapSchema();
        this.projectiles = new schema_1.MapSchema();
        this.traps = new schema_1.MapSchema();
        this.bushes = new schema_1.MapSchema();
        this.items = new schema_1.MapSchema();
        this.zone = new ZoneState();
        this.worldWidth = 2000;
        this.worldHeight = 2000;
        this.status = "PLAYING"; // WAITING, PLAYING, VICTORY
        this.aliveCount = 1;
        this.winnerId = "";
        this.winnerName = "";
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.type)({ map: Player }),
    __metadata("design:type", Object)
], GameState.prototype, "players", void 0);
__decorate([
    (0, schema_1.type)({ map: Projectile }),
    __metadata("design:type", Object)
], GameState.prototype, "projectiles", void 0);
__decorate([
    (0, schema_1.type)({ map: Trap }),
    __metadata("design:type", Object)
], GameState.prototype, "traps", void 0);
__decorate([
    (0, schema_1.type)({ map: Bush }),
    __metadata("design:type", Object)
], GameState.prototype, "bushes", void 0);
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
