import Phaser from "phaser";
import { Room } from "colyseus.js";
import { NetworkClient } from "../NetworkManager";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup } from "../schema/GameState";
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
  label:     Phaser.GameObjects.Text;
  buffIcon:  Phaser.GameObjects.Text;
  tx: number; ty: number; tr: number;
  hp: number; maxHp: number;
  isGhost: boolean; isHidden: boolean;
  isMe: boolean;
  catColor: number;
  name: string;
}

interface VProj {
  g: Phaser.GameObjects.Graphics;
  trail: Phaser.GameObjects.Graphics;
  tx: number; ty: number;
}

interface VTrap {
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
}

interface VItem {
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  itemType: string;
  active: boolean;
}

/* ─── Escena Principal Phaser ────────────────────────────────── */
export class MainScene extends Phaser.Scene {
  public net!: NetworkClient;
  private room!: Room<GameState>;
  private myId = "";

  private players = new Map<string, VPlayer>();
  private projs   = new Map<string, VProj>();
  private traps   = new Map<string, VTrap>();
  private items   = new Map<string, VItem>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private zone = { x: 1000, y: 1000, r: 950 };

  private styleScore = 0;
  private wasInBush = false;

  constructor() { super({ key: "MainScene" }); }

  create() {
    this.game.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.cameras.main.centerOn(1000, 1000);

    // 1. Mapa de batalla
    this.buildMap();

    // 2. Gráficos de Zona
    this.zoneGfx = this.add.graphics().setDepth(8);

    // 3. Minimapa (overlay sobre cámara)
    this.minimapGfx = this.add.graphics().setDepth(200).setScrollFactor(0);

    // 4. Teclado
    const kb = this.input.keyboard!;
    this.keys = {
      W:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    this.keys.SPACE.on("down", () => {
      const me = this.players.get(this.myId);
      if (me && !me.isGhost) {
        this.net.sendDash();
        soundManager.playDash();
        this.createDashFX(me.tx, me.ty, me.tr);
      }
    });

    // 5. Puntero / Disparo
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      const me = this.players.get(this.myId);
      if (!me) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);

      if (ptr.leftButtonDown() && !me.isGhost) {
        const angle = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);
        this.net.sendShoot(angle);
        soundManager.playShoot();
        this.cameras.main.shake(60, 0.003);
      }

      if (ptr.rightButtonDown() && me.isGhost) {
        this.net.sendPlaceTrap(wp.x, wp.y);
        soundManager.playTrapPlace();
      }
    });

    window.addEventListener("restart-game", () => {
      this.net.sendRestart();
    });

    // 6. Conectar sala Colyseus
    this.connect();
  }

  private async connect() {
    emit("conn", "CONNECTING");
    try {
      this.room = await this.net.connect();
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

    // Eventos del servidor
    this.room.onMessage("hit", (d: any) => {
      this.showDamageText(d.x, d.y, `-${d.damage}`, "#ef4444");
      this.createSparksFX(d.x, d.y, 0xff4444);
      if (d.victimId === this.myId) {
        soundManager.playHit();
        this.cameras.main.shake(120, 0.012);
      }
    });

    this.room.onMessage("kill", (d: any) => {
      emit("killFeed", { killer: d.killerName, victim: d.victimName });
      if (d.killerId === this.myId) {
        soundManager.playKill();
        this.addStyle(250, "¡ELIMINACIÓN FELINA!");
      }
    });

    this.room.onMessage("itemPicked", (d: any) => {
      if (d.playerId === this.myId) {
        soundManager.playPickup(d.itemType);
        const label = d.itemType === "MEDKIT" ? "+35 SALUD" : d.itemType === "SPEED" ? "¡SUPER VELOCIDAD!" : "¡TRIPLE LÁSER!";
        const color = d.itemType === "MEDKIT" ? "#10b981" : d.itemType === "SPEED" ? "#fbbf24" : "#a855f7";
        this.showDamageText(d.x, d.y, label, color);
        this.addStyle(80, "POWERUP");
      }
      this.createSparksFX(d.x, d.y, 0x10b981);
    });

    this.room.onMessage("playerDash", (d: any) => {
      const p = this.players.get(d.id);
      if (p) {
        this.createDashFX(p.container.x, p.container.y, p.tr);
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

  /* ── Estilo (Devil May Cry style) ────────────────────────── */
  public addStyle(pts: number, reason: string) {
    this.styleScore = Math.min(1000, this.styleScore + pts);
    emit("style", { score: this.styleScore, reason });
  }

  /* ── Mapa y Vegetación ───────────────────────────────────── */
  private buildMap() {
    const g = this.add.graphics().setDepth(0);

    // Suelo jungla oscuro
    g.fillStyle(0x06150b, 1);
    g.fillRect(0, 0, 2000, 2000);

    // Patrón de cuadrícula tecnológica
    g.lineStyle(1, 0x0e301e, 0.8);
    for (let i = 0; i <= 2000; i += 80) {
      g.moveTo(i, 0); g.lineTo(i, 2000);
      g.moveTo(0, i); g.lineTo(2000, i);
    }
    g.strokePath();

    // Marcadores cyberpunk
    g.lineStyle(1, 0x10b981, 0.3);
    for (let x = 160; x < 2000; x += 160) {
      for (let y = 160; y < 2000; y += 160) {
        g.strokeCircle(x, y, 4);
      }
    }

    // Bordes energéticos
    g.lineStyle(6, 0x10b981, 1);
    g.strokeRect(4, 4, 1992, 1992);
    g.lineStyle(2, 0x34d399, 0.5);
    g.strokeRect(10, 10, 1980, 1980);
  }

  private drawBush(b: Bush) {
    const container = this.add.container(b.x, b.y).setDepth(20);
    const g = this.add.graphics();
    const w = b.width || 160, h = b.height || 120;

    // Follaje base
    g.fillStyle(0x04402a, 0.9);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    g.lineStyle(3, 0x10b981, 0.85);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);

    // Copas de hojas
    g.fillStyle(0x059669, 0.5);
    g.fillCircle(-w * 0.22, -h * 0.15, h * 0.35);
    g.fillCircle(w * 0.22, h * 0.15, h * 0.35);
    g.fillCircle(0, 0, h * 0.32);

    container.add(g);
  }

  /* ── Pickups (Objetos y Armas) ───────────────────────────── */
  private createItem(id: string, item: ItemPickup) {
    const container = this.add.container(item.x, item.y).setDepth(25);
    const g = this.add.graphics();

    let color = 0x10b981;
    let emoji = "🧪";
    if (item.itemType === "SPEED") { color = 0xf59e0b; emoji = "⚡"; }
    if (item.itemType === "TRIPLE") { color = 0xa855f7; emoji = "🌟"; }

    // Glow aura
    g.fillStyle(color, 0.25);
    g.fillCircle(0, 0, 22);
    g.lineStyle(2, color, 0.9);
    g.strokeCircle(0, 0, 16);

    const icon = this.add.text(0, 0, emoji, { fontSize: "16px" }).setOrigin(0.5);
    container.add([g, icon]);

    // Animación de flotado
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

    // HP background bar
    hpBg.fillStyle(0x0f172a, 0.9);
    hpBg.fillRect(-26, -42, 52, 7);
    hpBg.lineStyle(1, 0x334155, 0.8);
    hpBg.strokeRect(-26, -42, 52, 7);

    // Etiqueta de nombre
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

    container.add([bodyGfx, earsGfx, faceGfx, aimGfx, hpBg, hpFill, label, buffIcon]);

    const vp: VPlayer = {
      container, bodyGfx, earsGfx, faceGfx, aimGfx, hpBg, hpFill, label, buffIcon,
      tx: px, ty: py, tr: p.rotation || 0,
      hp: p.hp ?? 100, maxHp: p.maxHp ?? 100,
      isGhost: !!p.isGhost, isHidden: !!p.isHidden,
      isMe, catColor: p.catColor || 0,
      name: p.name || "Gato",
    };

    this.drawCat(vp);
    this.redrawHp(vp, 1);
    this.players.set(id, vp);

    if (isMe) {
      this.cameras.main.setScroll(px - this.scale.width / 2, py - this.scale.height / 2);
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  private drawCat(v: VPlayer) {
    const { bodyGfx, earsGfx, faceGfx, aimGfx, isGhost, isMe, catColor } = v;

    bodyGfx.clear();
    earsGfx.clear();
    faceGfx.clear();
    aimGfx.clear();

    if (isGhost) {
      // 👻 MODO FANTASMA FELINO
      bodyGfx.fillStyle(0x38bdf8, 0.45);
      bodyGfx.fillCircle(0, 0, 22);
      bodyGfx.lineStyle(2, 0xbae6fd, 0.9);
      bodyGfx.strokeCircle(0, 0, 22);

      // Orejitas de gato fantasma
      earsGfx.fillStyle(0x38bdf8, 0.55);
      earsGfx.fillTriangle(-14, -12, -22, -30, -6, -20);
      earsGfx.fillTriangle(14, -12, 22, -30, 6, -20);

      // Ojos espectrales
      faceGfx.fillStyle(0xffffff, 0.9);
      faceGfx.fillCircle(-6, -4, 4);
      faceGfx.fillCircle(6, -4, 4);
      faceGfx.fillStyle(0x0284c7, 1);
      faceGfx.fillCircle(-6, -4, 2);
      faceGfx.fillCircle(6, -4, 2);
      return;
    }

    // Paletas de color para gatos
    const colorTable = [
      { main: 0x10b981, inner: 0x6ee7b7, earInner: 0xf472b6, stroke: 0xffffff }, // 0: Player Emerald
      { main: 0xef4444, inner: 0xfca5a5, earInner: 0xf43f5e, stroke: 0xffffff }, // 1: Crimson Ninja
      { main: 0x8b5cf6, inner: 0xc4b5fd, earInner: 0xf472b6, stroke: 0xffffff }, // 2: Royal Violet
      { main: 0xf97316, inner: 0xfed7aa, earInner: 0xfb7185, stroke: 0xffffff }, // 3: Orange Garfield
      { main: 0x06b6d4, inner: 0x67e8f9, earInner: 0xf472b6, stroke: 0xffffff }, // 4: Neon Azure
      { main: 0xeab308, inner: 0xfef08a, earInner: 0xf43f5e, stroke: 0xffffff }, // 5: Golden Legend
    ];

    const c = colorTable[catColor % colorTable.length];

    // Aura / Glow
    bodyGfx.fillStyle(c.main, 0.2);
    bodyGfx.fillCircle(0, 0, 30);

    // Orejas de gato (triángulos 3D)
    earsGfx.fillStyle(c.main, 1);
    earsGfx.fillTriangle(-12, -12, -22, -28, -4, -18);
    earsGfx.fillTriangle(12, -12, 22, -28, 4, -18);
    earsGfx.lineStyle(2, c.stroke, 0.9);
    earsGfx.strokeTriangle(-12, -12, -22, -28, -4, -18);
    earsGfx.strokeTriangle(12, -12, 22, -28, 4, -18);

    // Interior de las orejas (rosita tierno)
    earsGfx.fillStyle(c.earInner, 1);
    earsGfx.fillTriangle(-11, -13, -19, -25, -6, -18);
    earsGfx.fillTriangle(11, -13, 19, -25, 6, -18);

    // Cabeza del gato
    bodyGfx.fillStyle(c.main, 1);
    bodyGfx.fillCircle(0, 0, 20);
    bodyGfx.lineStyle(3, c.stroke, 1);
    bodyGfx.strokeCircle(0, 0, 20);

    // Ojos y detalles felinos
    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillEllipse(-7, -4, 5, 7);
    faceGfx.fillEllipse(7, -4, 5, 7);

    // Pupilas
    faceGfx.fillStyle(0x0f172a, 1);
    faceGfx.fillCircle(-7, -4, 3);
    faceGfx.fillCircle(7, -4, 3);

    // Destellos en los ojos
    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillCircle(-8, -6, 1.5);
    faceGfx.fillCircle(6, -6, 1.5);

    // Naricita rosa y bigotes
    faceGfx.fillStyle(0xf472b6, 1);
    faceGfx.fillTriangle(0, 4, -3, 1, 3, 1);

    // Bigotes
    faceGfx.lineStyle(1.5, 0xffffff, 0.85);
    faceGfx.moveTo(-12, 1); faceGfx.lineTo(-24, -1);
    faceGfx.moveTo(-12, 4); faceGfx.lineTo(-24, 6);
    faceGfx.moveTo(12, 1);  faceGfx.lineTo(24, -1);
    faceGfx.moveTo(12, 4);  faceGfx.lineTo(24, 6);
    faceGfx.strokePath();

    // Cañón bláster que rota
    this.redrawAim(v);
  }

  private redrawAim(v: VPlayer) {
    const { aimGfx, tr, isGhost } = v;
    aimGfx.clear();
    if (isGhost) return;

    const barrelLen = 24;
    const bx = Math.cos(tr) * barrelLen;
    const by = Math.sin(tr) * barrelLen;

    // Pata con arma láser
    aimGfx.lineStyle(6, 0x1e293b, 1);
    aimGfx.lineBetween(0, 0, bx, by);
    aimGfx.lineStyle(3, 0xf472b6, 1);
    aimGfx.lineBetween(bx * 0.4, by * 0.4, bx, by);

    // Puntero láser
    aimGfx.fillStyle(0xffffff, 1);
    aimGfx.fillCircle(bx, by, 3);
  }

  private redrawHp(v: VPlayer, ratio: number) {
    const { hpFill } = v;
    hpFill.clear();
    const w = Math.max(0, 50 * ratio);
    const col = ratio < 0.3 ? 0xef4444 : ratio < 0.6 ? 0xf59e0b : 0x10b981;
    hpFill.fillStyle(col, 1);
    hpFill.fillRect(-25, -41, w, 5);
  }

  private updatePlayer(id: string, p: Player) {
    const v = this.players.get(id);
    if (!v) return;

    v.tx = p.x ?? v.tx;
    v.ty = p.y ?? v.ty;
    v.tr = p.rotation ?? v.tr;
    v.hp = p.hp ?? v.hp;
    v.maxHp = p.maxHp ?? v.maxHp;
    v.isGhost = !!p.isGhost;
    v.isHidden = !!p.isHidden;

    // Actualizar icono de Buff
    if (p.activeBuff === "SPEED") v.buffIcon.setText("⚡");
    else if (p.activeBuff === "TRIPLE") v.buffIcon.setText("🌟");
    else v.buffIcon.setText("");

    const ratio = Math.max(0, Math.min(1, v.hp / v.maxHp));
    this.redrawHp(v, ratio);

    // Visibilidad por arbustos
    if (!v.isMe) {
      const show = !v.isHidden;
      v.container.setVisible(show);
    } else {
      v.container.setAlpha(v.isHidden && !v.isGhost ? 0.5 : 1);
      // Sonido de arbusto al entrar
      if (v.isHidden !== this.wasInBush) {
        soundManager.playBush();
        this.createLeavesFX(v.container.x, v.container.y);
        this.wasInBush = v.isHidden;
      }
    }

    if (v.isGhost) {
      v.hpBg.setVisible(false);
      v.hpFill.setVisible(false);
      v.label.setText((v.isMe ? "TÚ" : v.name) + " 👻");
      this.drawCat(v);
    } else {
      v.hpBg.setVisible(true);
      v.hpFill.setVisible(true);
      v.label.setText(v.isMe ? "TÚ 🐾" : v.name);
      this.drawCat(v);
    }

    // Actualizar UI React
    if (v.isMe) {
      emit("player", {
        hp: v.hp,
        maxHp: v.maxHp,
        isGhost: v.isGhost,
        isHidden: v.isHidden,
        dashCooldown: p.dashCooldown ?? 0,
        trapCooldown: p.trapCooldown ?? 0,
        kills: p.kills ?? 0,
        activeBuff: p.activeBuff ?? "",
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

    g.fillStyle(0xf43f5e, 1);
    g.fillCircle(0, 0, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, 3);
    g.lineStyle(2, 0xfde047, 0.9);
    g.strokeCircle(0, 0, 7);

    this.projs.set(id, { g, trail, tx: p.x || 0, ty: p.y || 0 });
  }

  /* ── Trampas Espectrales ─────────────────────────────────── */
  private createTrap(id: string, t: Trap) {
    const container = this.add.container(t.x, t.y).setDepth(35);
    const g = this.add.graphics();
    const ring = this.add.graphics();

    g.fillStyle(0x7c3aed, 0.75);
    g.fillCircle(0, 0, 16);
    g.lineStyle(3, 0xa855f7, 1);
    g.strokeCircle(0, 0, 16);

    // Calavera/Garra rúnica
    g.lineStyle(2, 0xffffff, 0.9);
    g.moveTo(-7, -7); g.lineTo(7, 7);
    g.moveTo(-7, 7);  g.lineTo(7, -7);
    g.strokePath();

    ring.lineStyle(2, 0xc084fc, 0.5);
    ring.strokeCircle(0, 0, 26);

    container.add([ring, g]);
    this.traps.set(id, { container, g, ring });

    this.tweens.add({
      targets: ring,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0.1,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });
  }

  /* ── Efectos Visuales (Partículas y FX) ──────────────────── */
  private showDamageText(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y - 20, text, {
      fontFamily: "Outfit, Inter, sans-serif",
      fontSize: "15px",
      fontStyle: "900",
      color,
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(150);

    this.tweens.add({
      targets: t,
      y: y - 55,
      alpha: 0,
      duration: 750,
      onComplete: () => t.destroy(),
    });
  }

  private createSparksFX(x: number, y: number, color: number) {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const p = this.add.graphics().setDepth(100).setPosition(x, y);
      p.fillStyle(color, 1);
      p.fillCircle(0, 0, 3 + Math.random() * 2);

      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;

      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 350,
        onComplete: () => p.destroy(),
      });
    }
  }

  private createDashFX(x: number, y: number, rot: number) {
    for (let i = 0; i < 4; i++) {
      const g = this.add.graphics().setDepth(55).setPosition(x - Math.cos(rot) * i * 22, y - Math.sin(rot) * i * 22);
      g.fillStyle(0x34d399, 0.5 - i * 0.1);
      g.fillCircle(0, 0, 16 - i * 3);
      this.tweens.add({
        targets: g,
        alpha: 0,
        scaleX: 0.4,
        scaleY: 0.4,
        duration: 300 + i * 50,
        onComplete: () => g.destroy(),
      });
    }
  }

  private createLeavesFX(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const leaf = this.add.graphics().setDepth(25).setPosition(x, y);
      leaf.fillStyle(0x10b981, 0.85);
      leaf.fillEllipse(0, 0, 6, 12);
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
    shock.lineStyle(4, 0xa855f7, 1);
    shock.strokeCircle(0, 0, 10);

    this.tweens.add({
      targets: shock,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 400,
      onComplete: () => shock.destroy(),
    });

    this.createSparksFX(x, y, 0xc084fc);
  }

  /* ── Loop Principal de Phaser (Update) ───────────────────── */
  update() {
    const me = this.players.get(this.myId);

    // Inputs locales hacia el servidor
    if (me && this.keys) {
      let dx = 0, dy = 0;
      if (this.keys.W.isDown) dy -= 1;
      if (this.keys.S.isDown) dy += 1;
      if (this.keys.A.isDown) dx -= 1;
      if (this.keys.D.isDown) dx += 1;

      const wp = this.cameras.main.getWorldPoint(
        this.input.activePointer.x, this.input.activePointer.y
      );
      const rot = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);
      this.net.sendMove(dx, dy, rot);
    }

    // Interpolación LERP suave de jugadores
    this.players.forEach(v => {
      const lf = 0.24;
      v.container.x = Phaser.Math.Linear(v.container.x, v.tx, lf);
      v.container.y = Phaser.Math.Linear(v.container.y, v.ty, lf);
      this.redrawAim(v);
    });

    // Interpolación de proyectiles
    this.projs.forEach(v => {
      v.g.x = Phaser.Math.Linear(v.g.x, v.tx, 0.45);
      v.g.y = Phaser.Math.Linear(v.g.y, v.ty, 0.45);
    });

    // Zona de peligro
    this.drawZone();

    // Minimapa dinámico
    this.drawMinimap();

    // Reducción lenta de barra de estilo
    if (this.styleScore > 0) {
      this.styleScore = Math.max(0, this.styleScore - 0.08);
      emit("style", { score: this.styleScore });
    }
  }

  private drawZone() {
    const g = this.zoneGfx;
    const { x, y, r } = this.zone;
    g.clear();

    // Niebla roja carmesí fuera de la zona
    g.fillStyle(0x881337, 0.38);
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

    const size = 130;
    const padding = 20;
    const mx = this.scale.width - size - padding;
    const my = this.scale.height - size - padding;
    const scale = size / 2000;

    // Fondo del minimapa glassmorphic
    g.fillStyle(0x020c06, 0.85);
    g.fillRoundedRect(mx, my, size, size, 12);
    g.lineStyle(2, 0x10b981, 0.6);
    g.strokeRoundedRect(mx, my, size, size, 12);

    // Círculo de la zona segura
    const zx = mx + this.zone.x * scale;
    const zy = my + this.zone.y * scale;
    const zr = Math.max(2, this.zone.r * scale);
    g.lineStyle(2, 0x34d399, 0.85);
    g.strokeCircle(zx, zy, zr);

    // Puntos de jugadores y bots
    this.players.forEach(p => {
      if (p.isGhost) return;
      if (p.isHidden && !p.isMe) return; // Enemigos en arbusto no aparecen en radar

      const px = mx + p.container.x * scale;
      const py = my + p.container.y * scale;

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
