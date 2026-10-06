import Phaser from "phaser";
import { Room } from "colyseus.js";
import { NetworkClient } from "../NetworkManager";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup, Obstacle } from "../schema/GameState";
import { soundManager } from "../SoundManager";

/* ─── Tipos Gráficos ─────────────────────────────────────────── */
interface VPlayer {
  container: Phaser.GameObjects.Container;
  bodyGfx:   Phaser.GameObjects.Graphics;
  earsGfx:   Phaser.GameObjects.Graphics;
  faceGfx:   Phaser.GameObjects.Graphics;
  aimGfx:    Phaser.GameObjects.Graphics;
  hpBg:      Phaser.GameObjects.Graphics;
  hpFill:    Phaser.GameObjects.Graphics;
  shdFill:   Phaser.GameObjects.Graphics;
  label:     Phaser.GameObjects.Text;
  buffIcon:  Phaser.GameObjects.Text;
  emoteGfx:  Phaser.GameObjects.Container;
  emoteText: Phaser.GameObjects.Text;
  tx: number; ty: number; tr: number;
  hp: number; maxHp: number;
  shield: number; maxShield: number;
  equippedWeapon: string;
  isGhost: boolean; isHidden: boolean;
  isMe: boolean;
  catColor: number;
  name: string;
  // Performance flags
  lastGhost: boolean;
  lastHpRatio: number;
  lastShdRatio: number;
  lastAimRot: number;
  lastBuff: string;
  lastWeapon: string;
}

interface VProj {
  g: Phaser.GameObjects.Graphics;
  trail: Phaser.GameObjects.Graphics;
  tx: number; ty: number;
  projType: string;
}

interface VTrap {
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
}

interface VObstacle {
  container: Phaser.GameObjects.Container;
  gfx: Phaser.GameObjects.Graphics;
  obsType: string;
  radius: number;
  hp: number; maxHp: number;
  destroyed: boolean;
}

interface VItem {
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  itemType: string;
  active: boolean;
}

/* ─── Escena Principal Phaser (Optimizado & Game Feel) ───────── */
export class MainScene extends Phaser.Scene {
  public net!: NetworkClient;
  public playerOptions: { name?: string; skin?: number } = {};
  private room!: Room<GameState>;
  private myId = "";

  private players = new Map<string, VPlayer>();
  private projs   = new Map<string, VProj>();
  private traps   = new Map<string, VTrap>();
  private obstacles = new Map<string, VObstacle>();
  private items   = new Map<string, VItem>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private crosshairGfx!: Phaser.GameObjects.Graphics;
  private aimConeGfx!: Phaser.GameObjects.Graphics;

  private zone = { x: 1000, y: 1000, r: 950 };

  private styleScore = 0;
  private wasInBush = false;

  private lastSentDx = 0;
  private lastSentDy = 0;
  private lastSentRot = 0;
  private lastMoveSendTime = 0;

  // Dirty flags & throttle
  private zoneDirty = true;
  private lastZoneR = -1;
  private minimapThrottle = 0;

  // Object Pools for High FPS Zero-GC Performance
  private sparksPool!: Phaser.GameObjects.Group;
  private ghostTrailPool!: Phaser.GameObjects.Group;

  constructor() { super({ key: "MainScene" }); }

  create() {
    this.game.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.cameras.main.centerOn(1000, 1000);

    // 1. Mapa de batalla
    this.buildMap();

    // 2. Gráficos de Zona de Tinta
    this.zoneGfx = this.add.graphics().setDepth(8);

    // 3. Object Pools (Arcade Groups) para partículas y Ghost Trails
    this.sparksPool = this.add.group({
      defaultKey: "",
      maxSize: 120,
      runChildUpdate: false,
    });

    this.ghostTrailPool = this.add.group({
      defaultKey: "",
      maxSize: 60,
      runChildUpdate: false,
    });

    // 4. Retícula Crosshair y Arco de Apuntado
    this.aimConeGfx = this.add.graphics().setDepth(50);
    this.crosshairGfx = this.add.graphics().setDepth(180);

    // 5. Minimapa (overlay sobre cámara)
    this.minimapGfx = this.add.graphics().setDepth(200).setScrollFactor(0);

    // 6. Teclado
    const kb = this.input.keyboard!;
    this.keys = {
      W:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ONE:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      TWO:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      THREE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      FOUR:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      FIVE:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
      E:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };

    this.keys.SPACE.on("down", () => {
      const me = this.players.get(this.myId);
      if (me && !me.isGhost) {
        this.net.sendDash();
        soundManager.playDash();
        this.spawnGhostTrail(me);
      }
    });

    // Cambios de arma por números 1-5
    this.keys.ONE.on("down", () => this.switchWeapon("LASER"));
    this.keys.TWO.on("down", () => this.switchWeapon("SHOTGUN"));
    this.keys.THREE.on("down", () => this.switchWeapon("SNIPER"));
    this.keys.FOUR.on("down", () => this.switchWeapon("GRENADE"));
    this.keys.FIVE.on("down", () => this.switchWeapon("MELEE"));

    // Key E: emote rápido Miau
    this.keys.E.on("down", () => {
      this.triggerEmote("🐾");
    });

    // Rueda del ratón para cambio de arma
    this.input.on("wheel", (_ptr: any, _dx: number, dy: number) => {
      const weapons = ["LASER", "SHOTGUN", "SNIPER", "GRENADE", "MELEE"];
      const me = this.players.get(this.myId);
      if (!me) return;
      let currIndex = weapons.indexOf(me.equippedWeapon || "LASER");
      if (dy > 0) currIndex = (currIndex + 1) % weapons.length;
      else currIndex = (currIndex - 1 + weapons.length) % weapons.length;
      this.switchWeapon(weapons[currIndex]);
    });

    // 7. Puntero / Disparo
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      const me = this.players.get(this.myId);
      if (!me) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);

      if (ptr.leftButtonDown() && !me.isGhost) {
        const angle = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);
        this.net.sendShoot(angle);

        if (me.equippedWeapon === "SHOTGUN") soundManager.playShotgun();
        else if (me.equippedWeapon === "SNIPER") soundManager.playSniper();
        else soundManager.playShoot();

        this.cameras.main.shake(60, me.equippedWeapon === "SNIPER" ? 0.008 : 0.003);
      }

      if (ptr.rightButtonDown() && me.isGhost) {
        this.net.sendPlaceTrap(wp.x, wp.y);
        soundManager.playTrapPlace();
      }
    });

    window.addEventListener("restart-game", () => {
      this.net.sendRestart();
    });

    window.addEventListener("switch-weapon", (e: any) => {
      if (e.detail?.weapon) this.switchWeapon(e.detail.weapon);
    });

    window.addEventListener("send-emote", (e: any) => {
      if (e.detail?.emote) this.triggerEmote(e.detail.emote);
    });

    // 8. Conectar sala Colyseus
    this.connect();
  }

  private switchWeapon(w: string) {
    const me = this.players.get(this.myId);
    if (me && me.equippedWeapon !== w) {
      me.equippedWeapon = w;
      this.net.sendSwitchWeapon(w);
      this.drawCat(me);
    }
  }

  private triggerEmote(emote: string) {
    this.net.sendEmote(emote);
    soundManager.playEmote();
  }

  private async connect() {
    emit("conn", "CONNECTING");
    try {
      this.room = await this.net.connect(this.playerOptions);
      this.myId = this.net.sessionId;
      emit("conn", "CONNECTED");
      console.log("✅ Conectado como:", this.myId);
      this.bindRoom();
    } catch (e: any) {
      console.error("❌ Fallo de conexión:", e?.message || e);
      emit("conn", "ERROR");
    }
  }

  private bindRoom() {
    const s = this.room.state;

    // Bushes
    s.bushes.onAdd((b: Bush) => this.drawBush(b));

    // Obstacles
    s.obstacles.onAdd((obs: Obstacle, id: string) => this.createObstacle(id, obs));
    s.obstacles.onRemove((_: Obstacle, id: string) => {
      const v = this.obstacles.get(id);
      if (v) { v.container.destroy(); this.obstacles.delete(id); }
    });

    // Items
    s.items.onAdd((item: ItemPickup, id: string) => this.createItem(id, item));
    s.items.onRemove((_: ItemPickup, id: string) => {
      const v = this.items.get(id);
      if (v) { v.container.destroy(); this.items.delete(id); }
    });

    // Safe Zone
    const syncZone = () => {
      if (!s.zone) return;
      this.zone = { x: s.zone.x, y: s.zone.y, r: s.zone.currentRadius };
      this.zoneDirty = true;
      emit("zone", {
        timer: Math.ceil(s.zone.timer || 0),
        isShrinking: !!s.zone.isShrinking,
        phase: s.zone.phase || 1,
      });
    };
    syncZone();
    s.zone.onChange(syncZone);
    this.room.onStateChange(() => {
      syncZone();
      emit("alive", { alive: s.aliveCount || 1, total: s.players?.size || 1 });
      if (s.status === "VICTORY" && s.winnerName) {
        emit("victory", {
          winnerId: s.winnerId,
          winnerName: s.winnerName,
          isMe: s.winnerId === this.myId,
        });
      } else if (s.status === "PLAYING") {
        emit("playing", {});
      }
    });

    // Players
    s.players.onAdd((p: Player, id: string) => {
      this.createPlayer(id, p);
      p.onChange(() => this.updatePlayer(id, p));
    });
    s.players.onRemove((_: Player, id: string) => this.destroyPlayer(id));

    // Projectiles
    s.projectiles.onAdd((p: Projectile, id: string) => {
      this.createProj(id, p);
      p.onChange(() => {
        const v = this.projs.get(id);
        if (v) { v.tx = p.x; v.ty = p.y; }
      });
    });
    s.projectiles.onRemove((_: Projectile, id: string) => {
      const v = this.projs.get(id);
      if (v) {
        this.createSparksFX(v.g.x, v.g.y, 0xf472b6);
        v.g.destroy();
        v.trail.destroy();
        this.projs.delete(id);
      }
    });

    // Traps
    s.traps.onAdd((t: Trap, id: string) => this.createTrap(id, t));
    s.traps.onRemove((_: Trap, id: string) => {
      const v = this.traps.get(id);
      if (v) {
        soundManager.playTrapExplode();
        this.createExplosionFX(v.container.x, v.container.y);
        v.container.destroy();
        this.traps.delete(id);
      }
    });

    // Server messages
    this.room.onMessage("hit", (d: any) => {
      this.showDamageText(d.x, d.y, `-${d.damage}`, "#ef4444");
      this.createSparksFX(d.x, d.y, 0xff4444);
      if (d.victimId === this.myId) {
        soundManager.playHit();
        this.cameras.main.shake(120, 0.012);
      }
    });

    this.room.onMessage("explosion", (d: any) => {
      soundManager.playExplosion();
      this.createExplosionFX(d.x, d.y);
      this.cameras.main.shake(220, 0.016);
    });

    this.room.onMessage("meteor", (d: any) => {
      soundManager.playExplosion();
      this.createExplosionFX(d.x, d.y);
      this.cameras.main.shake(300, 0.022);
    });

    this.room.onMessage("kill", (d: any) => {
      emit("killFeed", { killer: d.killerName, victim: d.victimName, weapon: d.weapon || "Bláster" });
      if (d.killerId === this.myId) {
        soundManager.playKill();
        this.addStyle(250, "¡ELIMINACIÓN FELINA!");
      }
    });

    this.room.onMessage("playerEmote", (d: any) => {
      const p = this.players.get(d.id);
      if (p) this.showEmoteBubble(p, d.emote);
    });

    this.room.onMessage("itemPicked", (d: any) => {
      if (d.playerId === this.myId) {
        soundManager.playPickup(d.itemType);
        const labelMap: Record<string, string> = {
          MEDKIT: "+40 SALUD",
          SHIELD: "+50 ESCUDO 🛡️",
          SPEED: "¡SUPER VELOCIDAD!",
          TRIPLE: "¡TRIPLE LÁSER!",
          SHOTGUN: "¡ESCOPETA OBTENIDA!",
          SNIPER: "¡RIFLE SNIPER OBTENIDO!",
          GRENADE: "¡GRANADAS DE HIERBA!",
        };
        const label = labelMap[d.itemType] || "POWERUP";
        const color = d.itemType === "MEDKIT" ? "#10b981" : d.itemType === "SHIELD" ? "#38bdf8" : "#a855f7";
        this.showDamageText(d.x, d.y, label, color);
        this.addStyle(80, "EQUIPADO");
      }
      this.createSparksFX(d.x, d.y, 0x10b981);
    });

    this.room.onMessage("playerDash", (d: any) => {
      const p = this.players.get(d.id);
      if (p) {
        this.spawnGhostTrail(p);
        if (d.id === this.myId) this.addStyle(30, "DASH TÁCTICO");
      }
    });

    this.room.onMessage("matchVictory", (d: any) => {
      soundManager.playVictory();
      emit("victory", {
        winnerId: d.winnerId,
        winnerName: d.winnerName,
        isMe: d.winnerId === this.myId,
        kills: d.kills,
      });
    });

    this.room.onMessage("matchRestarted", () => {
      emit("restart", {});
    });
  }

  public addStyle(pts: number, reason: string) {
    this.styleScore = Math.min(1000, this.styleScore + pts);
    emit("style", { score: this.styleScore, reason });
  }

  /* ── Mapa y Vegetación ───────────────────────────────────── */
  private buildMap() {
    const g = this.add.graphics().setDepth(0);

    g.fillStyle(0x06150b, 1);
    g.fillRect(0, 0, 2000, 2000);

    g.lineStyle(1, 0x0e301e, 0.8);
    for (let i = 0; i <= 2000; i += 80) {
      g.moveTo(i, 0); g.lineTo(i, 2000);
      g.moveTo(0, i); g.lineTo(2000, i);
    }
    g.strokePath();

    g.lineStyle(1, 0x10b981, 0.3);
    for (let x = 160; x < 2000; x += 160) {
      for (let y = 160; y < 2000; y += 160) {
        g.strokeCircle(x, y, 4);
      }
    }

    g.lineStyle(6, 0x10b981, 1);
    g.strokeRect(4, 4, 1992, 1992);
    g.lineStyle(2, 0x34d399, 0.5);
    g.strokeRect(10, 10, 1980, 1980);
  }

  private drawBush(b: Bush) {
    const container = this.add.container(b.x, b.y).setDepth(20);
    const g = this.add.graphics();
    const w = b.width || 160, h = b.height || 120;

    g.fillStyle(0x04402a, 0.9);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    g.lineStyle(3, 0x10b981, 0.85);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);

    g.fillStyle(0x059669, 0.5);
    g.fillCircle(-w * 0.22, -h * 0.15, h * 0.35);
    g.fillCircle(w * 0.22, h * 0.15, h * 0.35);
    g.fillCircle(0, 0, h * 0.32);

    container.add(g);
  }

  /* ── Obstáculos (Cajas, Barriles, Rocas, Árboles) ────────── */
  private createObstacle(id: string, obs: Obstacle) {
    const container = this.add.container(obs.x, obs.y).setDepth(30);
    const gfx = this.add.graphics();
    container.add(gfx);

    const vo: VObstacle = {
      container, gfx, obsType: obs.obstacleType, radius: obs.radius || 30,
      hp: obs.hp, maxHp: obs.maxHp, destroyed: !!obs.destroyed
    };

    this.drawObstacleGfx(vo);
    this.obstacles.set(id, vo);

    obs.onChange(() => {
      vo.hp = obs.hp;
      vo.destroyed = !!obs.destroyed;
      this.drawObstacleGfx(vo);
    });
  }

  private drawObstacleGfx(vo: VObstacle) {
    const { gfx, obsType, radius, hp, maxHp, destroyed } = vo;
    gfx.clear();
    if (destroyed) {
      if (obsType === "CRATE") {
        gfx.fillStyle(0x451a03, 0.4);
        gfx.fillRect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6);
      } else if (obsType === "BARREL") {
        gfx.fillStyle(0x7f1d1d, 0.4);
        gfx.fillCircle(0, 0, radius * 0.7);
      }
      return;
    }

    if (obsType === "CRATE") {
      const s = radius * 1.8;
      gfx.fillStyle(0x78350f, 1);
      gfx.fillRoundedRect(-s/2, -s/2, s, s, 6);
      gfx.lineStyle(3, 0xd97706, 1);
      gfx.strokeRoundedRect(-s/2, -s/2, s, s, 6);
      gfx.lineStyle(2, 0x451a03, 0.8);
      gfx.lineBetween(-s/2, -s/2, s/2, s/2);
      gfx.lineBetween(-s/2, s/2, s/2, -s/2);
    } else if (obsType === "BARREL") {
      gfx.fillStyle(0xd97706, 0.3);
      gfx.fillCircle(0, 0, radius + 4);
      gfx.fillStyle(0xd97706, 1);
      gfx.fillCircle(0, 0, radius);
      gfx.lineStyle(3, 0xfef08a, 1);
      gfx.strokeCircle(0, 0, radius);
      gfx.fillStyle(0x7f1d1d, 1);
      gfx.fillCircle(0, 0, radius * 0.5);
    } else if (obsType === "BOULDER") {
      gfx.fillStyle(0x334155, 1);
      gfx.fillCircle(0, 0, radius);
      gfx.lineStyle(3, 0x64748b, 1);
      gfx.strokeCircle(0, 0, radius);
      gfx.fillStyle(0x1e293b, 0.6);
      gfx.fillCircle(-radius * 0.2, -radius * 0.2, radius * 0.5);
    } else if (obsType === "TREE") {
      gfx.fillStyle(0x064e3b, 0.95);
      gfx.fillCircle(0, 0, radius);
      gfx.fillStyle(0x047857, 0.8);
      gfx.fillCircle(-radius * 0.2, -radius * 0.2, radius * 0.6);
      gfx.lineStyle(3, 0x34d399, 0.85);
      gfx.strokeCircle(0, 0, radius);
    }

    if (hp < maxHp && hp > 0) {
      const w = 40;
      const ratio = hp / maxHp;
      gfx.fillStyle(0x0f172a, 0.8);
      gfx.fillRect(-w/2, -radius - 12, w, 5);
      gfx.fillStyle(0xef4444, 1);
      gfx.fillRect(-w/2, -radius - 12, w * ratio, 5);
    }
  }

  /* ── Pickups (Objetos, Armas, Escudos) ───────────────────── */
  private createItem(id: string, item: ItemPickup) {
    const container = this.add.container(item.x, item.y).setDepth(25);
    const g = this.add.graphics();

    let color = 0x10b981;
    let emoji = "🧪";
    if (item.itemType === "SHIELD") { color = 0x38bdf8; emoji = "🛡️"; }
    else if (item.itemType === "SPEED") { color = 0xf59e0b; emoji = "⚡"; }
    else if (item.itemType === "TRIPLE") { color = 0xa855f7; emoji = "🌟"; }
    else if (item.itemType === "SHOTGUN") { color = 0xef4444; emoji = "💥"; }
    else if (item.itemType === "SNIPER") { color = 0x06b6d4; emoji = "🎯"; }
    else if (item.itemType === "GRENADE") { color = 0x84cc16; emoji = "💣"; }

    g.fillStyle(color, 0.25);
    g.fillCircle(0, 0, 22);
    g.lineStyle(2, color, 0.9);
    g.strokeCircle(0, 0, 16);

    const icon = this.add.text(0, 0, emoji, { fontSize: "16px" }).setOrigin(0.5);
    container.add([g, icon]);

    this.tweens.add({
      targets: container,
      y: item.y - 6,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const vi: VItem = { container, g, icon, itemType: item.itemType, active: item.active };
    this.items.set(id, vi);

    item.onChange(() => {
      container.setVisible(item.active);
    });
  }

  /* ── Personajes Gatos (Battle Cats) ──────────────────────── */
  private createPlayer(id: string, p: Player) {
    const isMe = id === this.myId;
    const px = typeof p.x === "number" && p.x !== 0 ? p.x : 1000;
    const py = typeof p.y === "number" && p.y !== 0 ? p.y : 1000;

    const container = this.add.container(px, py).setDepth(60);

    const bodyGfx  = this.add.graphics();
    const earsGfx  = this.add.graphics();
    const faceGfx  = this.add.graphics();
    const aimGfx   = this.add.graphics();
    const hpBg     = this.add.graphics();
    const hpFill   = this.add.graphics();
    const shdFill  = this.add.graphics();

    hpBg.fillStyle(0x0f172a, 0.9);
    hpBg.fillRect(-26, -42, 52, 7);
    hpBg.lineStyle(1, 0x334155, 0.8);
    hpBg.strokeRect(-26, -42, 52, 7);

    const label = this.add.text(0, -54,
      isMe ? "TÚ 🐾" : (p.name || id.slice(0, 6)),
      {
        fontFamily: "Outfit, Inter, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        color: isMe ? "#10b981" : "#f1f5f9",
        stroke: "#000000",
        strokeThickness: 3,
      }
    ).setOrigin(0.5);

    const buffIcon = this.add.text(28, -45, "", { fontSize: "11px" }).setOrigin(0.5);

    const emoteGfx = this.add.container(0, -78).setVisible(false);
    const emoteBg = this.add.graphics();
    emoteBg.fillStyle(0xffffff, 0.95);
    emoteBg.fillRoundedRect(-18, -18, 36, 30, 8);
    emoteBg.lineStyle(2, 0x10b981, 1);
    emoteBg.strokeRoundedRect(-18, -18, 36, 30, 8);
    const emoteText = this.add.text(0, -3, "🐾", { fontSize: "18px" }).setOrigin(0.5);
    emoteGfx.add([emoteBg, emoteText]);

    container.add([bodyGfx, earsGfx, faceGfx, aimGfx, hpBg, hpFill, shdFill, label, buffIcon, emoteGfx]);

    const vp: VPlayer = {
      container, bodyGfx, earsGfx, faceGfx, aimGfx, hpBg, hpFill, shdFill, label, buffIcon,
      emoteGfx, emoteText,
      tx: px, ty: py, tr: p.rotation || 0,
      hp: p.hp ?? 100, maxHp: p.maxHp ?? 100,
      shield: p.shield ?? 0, maxShield: p.maxShield ?? 50,
      equippedWeapon: p.equippedWeapon || "LASER",
      isGhost: !!p.isGhost, isHidden: !!p.isHidden,
      isMe, catColor: p.catColor || 0,
      name: p.name || "Gato",
      lastGhost: !!p.isGhost,
      lastHpRatio: 1,
      lastShdRatio: 0,
      lastAimRot: p.rotation || 0,
      lastBuff: "",
      lastWeapon: p.equippedWeapon || "LASER",
    };

    this.drawCat(vp);
    this.redrawHp(vp, 1, 0);
    this.players.set(id, vp);

    if (isMe) {
      this.cameras.main.setScroll(px - this.scale.width / 2, py - this.scale.height / 2);
      this.cameras.main.startFollow(container, true, 0.15, 0.15);
    }
  }

  private spawnGhostTrail(v: VPlayer) {
    const shadow = this.add.graphics().setDepth(55).setPosition(v.container.x, v.container.y);
    shadow.fillStyle(v.isGhost ? 0x38bdf8 : 0x10b981, 0.45);
    shadow.fillCircle(0, 0, 22);
    shadow.rotation = v.tr;

    this.tweens.add({
      targets: shadow,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 350,
      onComplete: () => shadow.destroy(),
    });
  }

  private showEmoteBubble(v: VPlayer, emote: string) {
    v.emoteText.setText(emote);
    v.emoteGfx.setVisible(true);
    v.emoteGfx.setScale(0.2);
    this.tweens.add({
      targets: v.emoteGfx,
      scaleX: 1,
      scaleY: 1,
      duration: 200,
      ease: "Back.easeOut",
    });
    this.time.delayedCall(2200, () => {
      if (v.emoteGfx.active) v.emoteGfx.setVisible(false);
    });
  }

  private drawCat(v: VPlayer) {
    const { bodyGfx, earsGfx, faceGfx, aimGfx, isGhost, catColor } = v;

    bodyGfx.clear();
    earsGfx.clear();
    faceGfx.clear();
    aimGfx.clear();

    if (isGhost) {
      bodyGfx.fillStyle(0x38bdf8, 0.45);
      bodyGfx.fillCircle(0, 0, 22);
      bodyGfx.lineStyle(2, 0xbae6fd, 0.9);
      bodyGfx.strokeCircle(0, 0, 22);

      earsGfx.fillStyle(0x38bdf8, 0.55);
      earsGfx.fillTriangle(-14, -12, -22, -30, -6, -20);
      earsGfx.fillTriangle(14, -12, 22, -30, 6, -20);

      faceGfx.fillStyle(0xffffff, 0.9);
      faceGfx.fillCircle(-6, -4, 4);
      faceGfx.fillCircle(6, -4, 4);
      faceGfx.fillStyle(0x0284c7, 1);
      faceGfx.fillCircle(-6, -4, 2);
      faceGfx.fillCircle(6, -4, 2);
      return;
    }

    const colorTable = [
      { main: 0x10b981, inner: 0x6ee7b7, earInner: 0xf472b6, stroke: 0xffffff },
      { main: 0xef4444, inner: 0xfca5a5, earInner: 0xf43f5e, stroke: 0xffffff },
      { main: 0x8b5cf6, inner: 0xc4b5fd, earInner: 0xf472b6, stroke: 0xffffff },
      { main: 0xf97316, inner: 0xfed7aa, earInner: 0xfb7185, stroke: 0xffffff },
      { main: 0x06b6d4, inner: 0x67e8f9, earInner: 0xf472b6, stroke: 0xffffff },
      { main: 0xeab308, inner: 0xfef08a, earInner: 0xf43f5e, stroke: 0xffffff },
    ];

    const c = colorTable[catColor % colorTable.length];

    bodyGfx.fillStyle(c.main, 0.2);
    bodyGfx.fillCircle(0, 0, 30);

    earsGfx.fillStyle(c.main, 1);
    earsGfx.fillTriangle(-12, -12, -22, -28, -4, -18);
    earsGfx.fillTriangle(12, -12, 22, -28, 4, -18);
    earsGfx.lineStyle(2, c.stroke, 0.9);
    earsGfx.strokeTriangle(-12, -12, -22, -28, -4, -18);
    earsGfx.strokeTriangle(12, -12, 22, -28, 4, -18);

    earsGfx.fillStyle(c.earInner, 1);
    earsGfx.fillTriangle(-11, -13, -19, -25, -6, -18);
    earsGfx.fillTriangle(11, -13, 19, -25, 6, -18);

    bodyGfx.fillStyle(c.main, 1);
    bodyGfx.fillCircle(0, 0, 20);
    bodyGfx.lineStyle(3, c.stroke, 1);
    bodyGfx.strokeCircle(0, 0, 20);

    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillEllipse(-7, -4, 5, 7);
    faceGfx.fillEllipse(7, -4, 5, 7);

    faceGfx.fillStyle(0x0f172a, 1);
    faceGfx.fillCircle(-7, -4, 3);
    faceGfx.fillCircle(7, -4, 3);

    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillCircle(-8, -6, 1.5);
    faceGfx.fillCircle(6, -6, 1.5);

    faceGfx.fillStyle(0xf472b6, 1);
    faceGfx.fillTriangle(0, 4, -3, 1, 3, 1);

    faceGfx.lineStyle(1.5, 0xffffff, 0.85);
    faceGfx.moveTo(-12, 1); faceGfx.lineTo(-24, -1);
    faceGfx.moveTo(-12, 4); faceGfx.lineTo(-24, 6);
    faceGfx.moveTo(12, 1);  faceGfx.lineTo(24, -1);
    faceGfx.moveTo(12, 4);  faceGfx.lineTo(24, 6);
    faceGfx.strokePath();

    this.redrawAim(v);
  }

  private redrawAim(v: VPlayer) {
    if (Math.abs(v.tr - v.lastAimRot) < 0.015 && !v.isGhost && v.equippedWeapon === v.lastWeapon) return;
    v.lastAimRot = v.tr;
    v.lastWeapon = v.equippedWeapon;

    const { aimGfx, tr, isGhost, equippedWeapon } = v;
    aimGfx.clear();
    if (isGhost) return;

    let barrelLen = 24;
    let barrelColor = 0xf472b6;
    let barrelWidth = 3;

    if (equippedWeapon === "SHOTGUN") {
      barrelLen = 22;
      barrelColor = 0xef4444;
      barrelWidth = 6;
    } else if (equippedWeapon === "SNIPER") {
      barrelLen = 32;
      barrelColor = 0x06b6d4;
      barrelWidth = 4;
    } else if (equippedWeapon === "GRENADE") {
      barrelLen = 18;
      barrelColor = 0x84cc16;
      barrelWidth = 5;
    } else if (equippedWeapon === "MELEE") {
      barrelLen = 16;
      barrelColor = 0xfbbf24;
      barrelWidth = 4;
    }

    const bx = Math.cos(tr) * barrelLen;
    const by = Math.sin(tr) * barrelLen;

    aimGfx.lineStyle(6, 0x1e293b, 1);
    aimGfx.lineBetween(0, 0, bx, by);
    aimGfx.lineStyle(barrelWidth, barrelColor, 1);
    aimGfx.lineBetween(bx * 0.3, by * 0.3, bx, by);

    aimGfx.fillStyle(0xffffff, 1);
    aimGfx.fillCircle(bx, by, 3);
  }

  private redrawHp(v: VPlayer, ratio: number, shdRatio: number) {
    const { hpFill, shdFill } = v;
    hpFill.clear();
    shdFill.clear();

    const w = Math.max(0, 50 * ratio);
    const col = ratio < 0.3 ? 0xef4444 : ratio < 0.6 ? 0xf59e0b : 0x10b981;
    hpFill.fillStyle(col, 1);
    hpFill.fillRect(-25, -41, w, 5);

    if (shdRatio > 0) {
      const sw = Math.max(0, 50 * shdRatio);
      shdFill.fillStyle(0x38bdf8, 1);
      shdFill.fillRect(-25, -46, sw, 3);
    }
  }

  private updatePlayer(id: string, p: Player) {
    const v = this.players.get(id);
    if (!v) return;

    v.tx = p.x ?? v.tx;
    v.ty = p.y ?? v.ty;
    if (!v.isMe) {
      v.tr = p.rotation ?? v.tr;
    }
    v.hp = p.hp ?? v.hp;
    v.maxHp = p.maxHp ?? v.maxHp;
    v.shield = p.shield ?? v.shield;
    v.maxShield = p.maxShield ?? v.maxShield;
    v.equippedWeapon = p.equippedWeapon || "LASER";

    const newGhost = !!p.isGhost;
    const newHidden = !!p.isHidden;
    const ghostChanged = newGhost !== v.isGhost;
    v.isGhost = newGhost;
    v.isHidden = newHidden;

    if (p.lastEmote) {
      this.showEmoteBubble(v, p.lastEmote);
    }

    const newBuff = p.activeBuff ?? "";
    if (newBuff !== v.lastBuff) {
      v.lastBuff = newBuff;
      if (newBuff === "SPEED") v.buffIcon.setText("⚡");
      else if (newBuff === "TRIPLE") v.buffIcon.setText("🌟");
      else v.buffIcon.setText("");
    }

    const ratio = Math.max(0, Math.min(1, v.hp / v.maxHp));
    const shdRatio = Math.max(0, Math.min(1, v.shield / v.maxShield));
    if (Math.abs(ratio - v.lastHpRatio) > 0.01 || Math.abs(shdRatio - v.lastShdRatio) > 0.01) {
      v.lastHpRatio = ratio;
      v.lastShdRatio = shdRatio;
      this.redrawHp(v, ratio, shdRatio);
    }

    if (!v.isMe) {
      v.container.setVisible(!v.isHidden);
    } else {
      v.container.setAlpha(v.isHidden && !v.isGhost ? 0.5 : (v.isGhost ? 0.5 : 1));
      if (v.isHidden !== this.wasInBush) {
        soundManager.playBush();
        this.createLeavesFX(v.container.x, v.container.y);
        this.wasInBush = v.isHidden;
      }
    }

    if (ghostChanged) {
      if (v.isGhost) {
        v.hpBg.setVisible(false);
        v.hpFill.setVisible(false);
        v.shdFill.setVisible(false);
        v.label.setText((v.isMe ? "TÚ" : v.name) + " 👻");
        v.container.setAlpha(0.5);
      } else {
        v.hpBg.setVisible(true);
        v.hpFill.setVisible(true);
        v.shdFill.setVisible(true);
        v.label.setText(v.isMe ? "TÚ 🐾" : v.name);
        v.container.setAlpha(1);
      }
      v.lastGhost = v.isGhost;
      this.drawCat(v);
    }

    if (v.isMe) {
      emit("player", {
        hp: v.hp,
        maxHp: v.maxHp,
        shield: v.shield,
        maxShield: v.maxShield,
        equippedWeapon: v.equippedWeapon,
        isGhost: v.isGhost,
        isHidden: v.isHidden,
        dashCooldown: p.dashCooldown ?? 0,
        trapCooldown: p.trapCooldown ?? 0,
        kills: p.kills ?? 0,
        activeBuff: newBuff,
        buffTimer: p.buffTimer ?? 0,
      });
    }
  }

  private destroyPlayer(id: string) {
    const v = this.players.get(id);
    if (!v) return;
    v.container.destroy();
    this.players.delete(id);
  }

  /* ── Proyectiles ─────────────────────────────────────────── */
  private createProj(id: string, p: Projectile) {
    const g = this.add.graphics().setDepth(70).setPosition(p.x || 0, p.y || 0);
    const trail = this.add.graphics().setDepth(69);

    const type = p.projType || "LASER";
    if (type === "PELLET") {
      g.fillStyle(0xef4444, 1);
      g.fillCircle(0, 0, 4);
    } else if (type === "SNIPER_BEAM") {
      g.fillStyle(0x06b6d4, 1);
      g.fillCircle(0, 0, 7);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeCircle(0, 0, 8);
    } else if (type === "GRENADE") {
      g.fillStyle(0x84cc16, 1);
      g.fillCircle(0, 0, 8);
      g.lineStyle(2, 0x4d7c0f, 1);
      g.strokeCircle(0, 0, 8);
    } else {
      g.fillStyle(0xf43f5e, 1);
      g.fillCircle(0, 0, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(0, 0, 3);
      g.lineStyle(2, 0xfde047, 0.9);
      g.strokeCircle(0, 0, 7);
    }

    this.projs.set(id, { g, trail, tx: p.x || 0, ty: p.y || 0, projType: type });
  }

  /* ── Trampas Espectrales ─────────────────────────────────── */
  private createTrap(id: string, t: Trap) {
    const container = this.add.container(t.x, t.y).setDepth(22);
    const g = this.add.graphics();
    const ring = this.add.graphics();

    g.fillStyle(0x0284c7, 0.7);
    g.fillCircle(0, 0, 14);
    g.lineStyle(2, 0x38bdf8, 1);
    g.strokeCircle(0, 0, 14);

    ring.lineStyle(1.5, 0x7dd3fc, 0.6);
    ring.strokeCircle(0, 0, 26);

    this.tweens.add({
      targets: ring,
      scaleX: 1.4,
      scaleY: 1.4,
      alpha: 0,
      duration: 1200,
      repeat: -1,
    });

    container.add([ring, g]);
    this.traps.set(id, { container, g, ring });
  }

  /* ── Efectos Visuales ────────────────────────────────────── */
  private showDamageText(x: number, y: number, text: string, color = "#ef4444") {
    const txt = this.add.text(x, y - 20, text, {
      fontFamily: "Outfit, Inter, sans-serif",
      fontSize: "16px",
      fontStyle: "bold",
      color,
      stroke: "#000000",
      strokeThickness: 3,
    }).setDepth(150).setOrigin(0.5);

    this.tweens.add({
      targets: txt,
      y: y - 55,
      alpha: 0,
      duration: 750,
      ease: "Cubic.easeOut",
      onComplete: () => txt.destroy(),
    });
  }

  private createSparksFX(x: number, y: number, color = 0x10b981) {
    for (let i = 0; i < 6; i++) {
      const p = this.add.graphics().setDepth(80).setPosition(x, y);
      p.fillStyle(color, 1);
      p.fillCircle(0, 0, 2.5);

      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;

      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        duration: 300,
        onComplete: () => p.destroy(),
      });
    }
  }

  private createLeavesFX(x: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const leaf = this.add.graphics().setDepth(85).setPosition(x, y);
      leaf.fillStyle(0x34d399, 0.9);
      leaf.fillEllipse(0, 0, 6, 3);
      leaf.rotation = Math.random() * Math.PI;

      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 40;

      this.tweens.add({
        targets: leaf,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        rotation: leaf.rotation + 2,
        duration: 450,
        onComplete: () => leaf.destroy(),
      });
    }
  }

  private createExplosionFX(x: number, y: number) {
    const shock = this.add.graphics().setDepth(90).setPosition(x, y);
    shock.lineStyle(4, 0xef4444, 1);
    shock.strokeCircle(0, 0, 10);

    this.tweens.add({
      targets: shock,
      scaleX: 5,
      scaleY: 5,
      alpha: 0,
      duration: 400,
      onComplete: () => shock.destroy(),
    });

    this.createSparksFX(x, y, 0xf97316);
  }

  /* ── Loop Principal de Phaser (Update - Interpolación & Game Feel) ── */
  update(time: number, delta: number) {
    const me = this.players.get(this.myId);

    // 1. Client-Side Prediction y Retícula / Arco de Apuntado
    if (me && this.keys) {
      const isGhost = me.isGhost;

      let dx = 0, dy = 0;
      if (this.keys.W.isDown) dy -= 1;
      if (this.keys.S.isDown) dy += 1;
      if (this.keys.A.isDown) dx -= 1;
      if (this.keys.D.isDown) dx += 1;

      const wp = this.cameras.main.getWorldPoint(
        this.input.activePointer.x, this.input.activePointer.y
      );
      const rot = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);

      me.tr = rot;

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        const ndx = dx / mag;
        const ndy = dy / mag;
        const baseSpeed = isGhost ? 280 : 220;
        const dtSec = delta / 1000;
        
        let nextX = me.container.x + ndx * baseSpeed * dtSec;
        let nextY = me.container.y + ndy * baseSpeed * dtSec;

        // Obstacle collision response (0ms local prediction)
        if (!isGhost) {
          const pRadius = 22;
          this.obstacles.forEach((obs) => {
            if (obs.destroyed) return;
            const dist = Math.hypot(nextX - obs.container.x, nextY - obs.container.y);
            const minDist = pRadius + obs.radius;
            if (dist < minDist && dist > 0) {
              const overlap = minDist - dist;
              const nx = (nextX - obs.container.x) / dist;
              const ny = (nextY - obs.container.y) / dist;
              nextX += nx * overlap;
              nextY += ny * overlap;
            }
          });
        }

        me.container.x = Math.max(30, Math.min(2000 - 30, nextX));
        me.container.y = Math.max(30, Math.min(2000 - 30, nextY));
      }

      // Renderizar Retícula (Crosshair) y Arco de Apuntado si NO es fantasma
      this.drawAimArcAndCrosshair(me, wp.x, wp.y);

      const rotDiff = Math.abs(rot - this.lastSentRot);
      if (
        dx !== this.lastSentDx ||
        dy !== this.lastSentDy ||
        rotDiff > 0.025 ||
        time - this.lastMoveSendTime > 33
      ) {
        this.net.sendMove(dx, dy, rot);
        this.lastSentDx = dx;
        this.lastSentDy = dy;
        this.lastSentRot = rot;
        this.lastMoveSendTime = time;
      }
    }

    // 2. Interpolación Suave (Lerp) para Jugadores Remotos y Reconciliación
    this.players.forEach(v => {
      if (v.isMe) {
        const dist = Math.hypot(v.container.x - v.tx, v.container.y - v.ty);
        if (dist > 16) {
          v.container.x = Phaser.Math.Linear(v.container.x, v.tx, 0.25);
          v.container.y = Phaser.Math.Linear(v.container.y, v.ty, 0.25);
        }
      } else {
        // Smooth linear interpolation at 60 FPS
        v.container.x = Phaser.Math.Linear(v.container.x, v.tx, 0.38);
        v.container.y = Phaser.Math.Linear(v.container.y, v.ty, 0.38);
      }
      this.redrawAim(v);
    });

    // Interpolación proyectiles
    this.projs.forEach(v => {
      v.g.x = Phaser.Math.Linear(v.g.x, v.tx, 0.55);
      v.g.y = Phaser.Math.Linear(v.g.y, v.ty, 0.55);
    });

    // Zona de Tinta (Safe Zone Cutout)
    this.drawZone();

    // Minimapa
    this.minimapThrottle += delta;
    if (this.minimapThrottle >= 66) {
      this.minimapThrottle = 0;
      this.drawMinimap();
    }

    if (this.styleScore > 0) {
      this.styleScore = Math.max(0, this.styleScore - 0.08);
      emit("style", { score: this.styleScore });
    }
  }

  /* ── Retícula y Arco de Dispersión / Alcance (Aim Arc) ─────── */
  private drawAimArcAndCrosshair(me: VPlayer, wx: number, wy: number) {
    const cg = this.crosshairGfx;
    const ag = this.aimConeGfx;
    cg.clear();
    ag.clear();

    if (me.isGhost) return;

    // Retícula Crosshair en la posición del ratón
    cg.lineStyle(2, 0x10b981, 0.9);
    cg.strokeCircle(wx, wy, 10);
    cg.lineStyle(1.5, 0xffffff, 1);
    cg.lineBetween(wx - 14, wy, wx - 6, wy);
    cg.lineBetween(wx + 6, wy, wx + 14, wy);
    cg.lineBetween(wx, wy - 14, wx, wy - 6);
    cg.lineBetween(wx, wy + 6, wx, wy + 14);

    // Arco o abanico de disparo según arma equipada
    const weapon = me.equippedWeapon;
    const px = me.container.x;
    const py = me.container.y;
    const rot = me.tr;

    if (weapon === "SHOTGUN") {
      // Abanico ancho de escopeta
      const range = 320;
      const angleHalf = 0.26; // ~30° total
      ag.fillStyle(0xef4444, 0.15);
      ag.lineStyle(1.5, 0xef4444, 0.5);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();
    } else if (weapon === "SNIPER") {
      // Línea fina láser de gran alcance
      const range = 900;
      const endX = px + Math.cos(rot) * range;
      const endY = py + Math.sin(rot) * range;
      ag.lineStyle(2, 0x06b6d4, 0.4);
      ag.lineBetween(px, py, endX, endY);
      ag.fillStyle(0x06b6d4, 0.6);
      ag.fillCircle(endX, endY, 5);
    } else if (weapon === "GRENADE") {
      // Indicador de trayectoria y radio de explosión
      const dist = Math.min(380, Math.hypot(wx - px, wy - py));
      const targetX = px + Math.cos(rot) * dist;
      const targetY = py + Math.sin(rot) * dist;
      ag.lineStyle(1.5, 0x84cc16, 0.4);
      ag.lineBetween(px, py, targetX, targetY);
      ag.fillStyle(0x84cc16, 0.2);
      ag.fillCircle(targetX, targetY, 45);
      ag.lineStyle(2, 0x84cc16, 0.8);
      ag.strokeCircle(targetX, targetY, 45);
    } else if (weapon === "MELEE") {
      // Arco corto de zarpazo
      const range = 65;
      const angleHalf = 0.5;
      ag.fillStyle(0xfbbf24, 0.2);
      ag.lineStyle(2, 0xfbbf24, 0.6);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();
    } else {
      // Bláster estándar (cono estrecho)
      const range = 500;
      const angleHalf = 0.1;
      ag.fillStyle(0x10b981, 0.12);
      ag.lineStyle(1, 0x10b981, 0.4);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();
    }
  }

  /* ── Zona de Tinta (Safe Zone Cutout) ─────────────────────── */
  private drawZone() {
    if (!this.zoneDirty && Math.abs(this.zone.r - this.lastZoneR) < 0.5) return;
    this.zoneDirty = false;
    this.lastZoneR = this.zone.r;

    const g = this.zoneGfx;
    const { x, y, r } = this.zone;
    g.clear();

    // Niebla roja carmesí de tinta fuera de la zona
    g.fillStyle(0x881337, 0.42);
    const t  = Math.max(0, y - r);
    const b  = Math.min(2000, y + r);
    const l  = Math.max(0, x - r);
    const ri = Math.min(2000, x + r);
    if (t > 0)     g.fillRect(0,  0, 2000, t);
    if (b < 2000)  g.fillRect(0,  b, 2000, 2000 - b);
    if (l > 0)     g.fillRect(0,  t, l,    b - t);
    if (ri < 2000) g.fillRect(ri, t, 2000 - ri, b - t);

    // Anillo esmeralda neón
    g.lineStyle(8, 0x10b981, 0.95);
    g.strokeCircle(x, y, r);
    g.lineStyle(3, 0x6ee7b7, 0.8);
    g.strokeCircle(x, y, r - 5);
  }

  private drawMinimap() {
    const g = this.minimapGfx;
    g.clear();

    const SIZE = 130;
    const PAD = 20;
    const mx = this.scale.width - SIZE - PAD;
    const my = this.scale.height - SIZE - PAD;
    const sc = SIZE / 2000;

    g.fillStyle(0x020c06, 0.85);
    g.fillRoundedRect(mx, my, SIZE, SIZE, 12);
    g.lineStyle(2, 0x10b981, 0.6);
    g.strokeRoundedRect(mx, my, SIZE, SIZE, 12);

    const zx = mx + this.zone.x * sc;
    const zy = my + this.zone.y * sc;
    const zr = Math.max(2, this.zone.r * sc);
    g.lineStyle(2, 0x34d399, 0.85);
    g.strokeCircle(zx, zy, zr);

    this.players.forEach(p => {
      if (p.isGhost) return;
      if (p.isHidden && !p.isMe) return;

      const px = mx + p.container.x * sc;
      const py = my + p.container.y * sc;

      if (p.isMe) {
        g.fillStyle(0x10b981, 1);
        g.fillCircle(px, py, 4);
        g.lineStyle(1.5, 0xffffff, 1);
        g.strokeCircle(px, py, 4);
      } else {
        g.fillStyle(0xef4444, 0.9);
        g.fillCircle(px, py, 2.5);
      }
    });
  }
}

function emit(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(`${name}-update`, { detail }));
}
