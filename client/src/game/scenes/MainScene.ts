import Phaser from "phaser";
import { Room } from "colyseus.js";
import { NetworkClient } from "../NetworkManager";

/* ─── Tipos ─────────────────────────────────────────────────── */
interface VPlayer {
  body:   Phaser.GameObjects.Graphics;   // circulo principal
  aim:    Phaser.GameObjects.Graphics;   // cañon / puntero
  hpBg:   Phaser.GameObjects.Graphics;
  hpFill: Phaser.GameObjects.Graphics;
  label:  Phaser.GameObjects.Text;
  tx: number; ty: number; tr: number;
  hp: number; maxHp: number;
  isGhost: boolean; isHidden: boolean;
  isMe: boolean;
}

interface VProj {
  g: Phaser.GameObjects.Graphics;
  tx: number; ty: number;
}

interface VTrap {
  g: Phaser.GameObjects.Graphics;
}

/* ─── Escena ─────────────────────────────────────────────────── */
export class MainScene extends Phaser.Scene {
  public net!: NetworkClient;
  private room!: Room;
  private myId = "";

  private players = new Map<string, VPlayer>();
  private projs   = new Map<string, VProj>();
  private traps   = new Map<string, VTrap>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private zone = { x: 1000, y: 1000, r: 950 };

  constructor() { super({ key: "MainScene" }); }

  /* ── create ──────────────────────────────────────────────── */
  create() {
    this.game.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.physics.world.setBounds(0, 0, 2000, 2000);
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.cameras.main.centerOn(1000, 1000);

    this.buildMap();

    this.zoneGfx = this.add.graphics().setDepth(6);

    const kb = this.input.keyboard!;
    this.keys = {
      W:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };
    this.keys.SPACE.on("down", () => this.net.sendDash());

    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      const me = this.players.get(this.myId);
      if (!me) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      if (ptr.leftButtonDown() && !me.isGhost) {
        this.net.sendShoot(Phaser.Math.Angle.Between(me.body.x, me.body.y, wp.x, wp.y));
      }
      if (ptr.rightButtonDown() && me.isGhost) {
        this.net.sendPlaceTrap(wp.x, wp.y);
      }
    });

    this.connect();
  }

  /* ── red ─────────────────────────────────────────────────── */
  private async connect() {
    emit("conn", "CONNECTING");
    try {
      this.room  = await this.net.connect();
      this.myId  = this.net.sessionId;
      emit("conn", "CONNECTED");
      console.log("✅ myId =", this.myId);
      this.bindRoom();
    } catch (e: any) {
      console.error("❌ connect failed:", e?.message || e);
      emit("conn", "ERROR");
    }
  }

  private bindRoom() {
    const s = this.room.state;

    /* bushes */
    s.bushes.onAdd((b: any) => this.drawBush(b));

    /* zone */
    const syncZone = () => {
      this.zone = { x: s.zone.x, y: s.zone.y, r: s.zone.currentRadius };
      emit("zone", { timer: Math.ceil(s.zone.timer || 0),
                     isShrinking: !!s.zone.isShrinking,
                     phase: s.zone.phase || 1 });
    };
    syncZone();
    s.zone.onChange(syncZone);

    /* players */
    s.players.onAdd((p: any, id: string) => {
      console.log(`👤 addPlayer id=${id} x=${p.x} y=${p.y}`);
      this.createPlayer(id, p);
      p.onChange(() => this.updatePlayer(id, p));
    });
    s.players.onRemove((_: any, id: string) => this.destroyPlayer(id));

    /* projectiles */
    s.projectiles.onAdd((p: any, id: string) => {
      this.createProj(id, p);
      p.onChange(() => { const v = this.projs.get(id); if(v){ v.tx=p.x; v.ty=p.y; } });
    });
    s.projectiles.onRemove((_: any, id: string) => { const v=this.projs.get(id); if(v){ v.g.destroy(); this.projs.delete(id); } });

    /* traps */
    s.traps.onAdd((t: any, id: string) => this.createTrap(id, t));
    s.traps.onRemove((_: any, id: string) => { const v=this.traps.get(id); if(v){ v.g.destroy(); this.traps.delete(id); } });
  }

  /* ── mapa ────────────────────────────────────────────────── */
  private buildMap() {
    const g = this.add.graphics().setDepth(0);
    // suelo
    g.fillStyle(0x0a1e12, 1);
    g.fillRect(0, 0, 2000, 2000);
    // grid
    g.lineStyle(1, 0x1a4a2e, 0.9);
    for (let i = 0; i <= 2000; i += 100) {
      g.moveTo(i, 0); g.lineTo(i, 2000);
      g.moveTo(0, i); g.lineTo(2000, i);
    }
    g.strokePath();
    // marcas
    g.lineStyle(1, 0x2d7a50, 1);
    for (let x = 100; x < 2000; x += 100)
      for (let y = 100; y < 2000; y += 100) {
        g.moveTo(x-5, y); g.lineTo(x+5, y);
        g.moveTo(x, y-5); g.lineTo(x, y+5);
      }
    g.strokePath();
    // borde
    g.lineStyle(6, 0x10b981, 1);
    g.strokeRect(2, 2, 1996, 1996);
  }

  private drawBush(b: any) {
    const g = this.add.graphics().setDepth(14);
    const w = b.width||160, h = b.height||120;
    g.fillStyle(0x043e2b, 0.92);
    g.fillRoundedRect(b.x - w/2, b.y - h/2, w, h, 14);
    g.lineStyle(2, 0x10b981, 1);
    g.strokeRoundedRect(b.x - w/2, b.y - h/2, w, h, 14);
    g.fillStyle(0x059669, 0.45);
    g.fillCircle(b.x - w*0.18, b.y - h*0.12, h*0.32);
    g.fillCircle(b.x + w*0.2,  b.y + h*0.14, h*0.34);
  }

  /* ── jugadores ───────────────────────────────────────────── */
  private createPlayer(id: string, p: any) {
    const isMe = id === this.myId;
    const px = typeof p.x==="number" && p.x!==0 ? p.x : 1000;
    const py = typeof p.y==="number" && p.y!==0 ? p.y : 1000;

    /* cuerpo — graphics con glow + círculo */
    const body = this.add.graphics().setDepth(50).setPosition(px, py);
    this.redrawBody(body, isMe, false, 1);

    /* cañón */
    const aim = this.add.graphics().setDepth(51).setPosition(px, py);
    this.redrawAim(aim, 0);

    /* hp bar */
    const hpBg = this.add.graphics().setDepth(52).setPosition(px, py);
    hpBg.fillStyle(0x0f172a, 0.85);
    hpBg.fillRect(-24, -36, 48, 8);

    const hpFill = this.add.graphics().setDepth(53).setPosition(px, py);
    this.redrawHp(hpFill, 1, isMe);

    /* label */
    const label = this.add.text(px, py - 50,
      isMe ? "TÚ" : id.slice(0, 5),
      { fontFamily:"Outfit,sans-serif", fontSize:"11px", fontStyle:"bold",
        color: isMe ? "#10b981" : "#f1f5f9", stroke:"#000", strokeThickness:3 }
    ).setOrigin(0.5).setDepth(54);

    const vp: VPlayer = {
      body, aim, hpBg, hpFill, label,
      tx: px, ty: py, tr: 0,
      hp: p.hp??100, maxHp: p.maxHp??100,
      isGhost: !!p.isGhost, isHidden: !!p.isHidden,
      isMe,
    };
    this.players.set(id, vp);

    if (isMe) {
      /* snap inicial + follow */
      this.cameras.main.setScroll(px - this.scale.width/2, py - this.scale.height/2);
      this.cameras.main.startFollow(body, true, 0.1, 0.1);
    }
  }

  private redrawBody(g: Phaser.GameObjects.Graphics, isMe: boolean, isGhost: boolean, alpha: number) {
    g.clear();
    g.setAlpha(alpha);
    if (isGhost) {
      g.fillStyle(0x3b82f6, 0.45);
      g.fillCircle(0, 0, 24);
      g.lineStyle(3, 0x93c5fd, 0.8);
      g.strokeCircle(0, 0, 24);
    } else {
      /* glow */
      g.fillStyle(isMe ? 0x6ee7b7 : 0xfca5a5, 0.25);
      g.fillCircle(0, 0, 30);
      /* body */
      g.fillStyle(isMe ? 0x10b981 : 0xef4444, 1);
      g.fillCircle(0, 0, 20);
      g.lineStyle(3, 0xffffff, 1);
      g.strokeCircle(0, 0, 20);
    }
  }

  private redrawAim(g: Phaser.GameObjects.Graphics, rotation: number) {
    g.clear();
    const cx = Math.cos(rotation) * 22;
    const cy = Math.sin(rotation) * 22;
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(cx - 2, cy - 3, 18, 6);
  }

  private redrawHp(g: Phaser.GameObjects.Graphics, ratio: number, isMe: boolean) {
    g.clear();
    const w = Math.max(0, 44 * ratio);
    const col = ratio < 0.3 ? 0xef4444 : ratio < 0.6 ? 0xf59e0b : 0x10b981;
    g.fillStyle(col, 1);
    g.fillRect(-22, -36, w, 6);
  }

  private updatePlayer(id: string, p: any) {
    const v = this.players.get(id);
    if (!v) return;

    v.tx = p.x ?? v.tx;
    v.ty = p.y ?? v.ty;
    v.tr = p.rotation ?? v.tr;
    v.hp    = p.hp    ?? v.hp;
    v.maxHp = p.maxHp ?? v.maxHp;
    v.isGhost  = !!p.isGhost;
    v.isHidden = !!p.isHidden;

    /* redibuja estado */
    const ratio = Math.max(0, Math.min(1, v.hp / v.maxHp));
    this.redrawBody(v.body, v.isMe, v.isGhost, v.isMe ? (v.isHidden&&!v.isGhost ? 0.45 : 1) : 1);
    this.redrawHp(v.hpFill, ratio, v.isMe);

    /* visibilidad para otros jugadores */
    if (!v.isMe) {
      const show = !v.isHidden;
      v.body.setVisible(show);
      v.aim.setVisible(show);
      v.hpBg.setVisible(show);
      v.hpFill.setVisible(show);
      v.label.setVisible(show);
    }

    if (v.isGhost) {
      v.aim.setVisible(false);
      v.hpBg.setVisible(false);
      v.hpFill.setVisible(false);
      v.label.setText((v.isMe ? "TÚ" : id.slice(0,5)) + " 👻");
    } else if (v.isMe || !v.isHidden) {
      v.aim.setVisible(true);
      v.hpBg.setVisible(true);
      v.hpFill.setVisible(true);
    }

    /* UI React */
    if (v.isMe) {
      emit("player", { hp: v.hp, maxHp: v.maxHp, isGhost: v.isGhost, isHidden: v.isHidden,
                       dashCooldown: p.dashCooldown??0, trapCooldown: p.trapCooldown??0,
                       kills: p.kills??0 });
    }
  }

  private destroyPlayer(id: string) {
    const v = this.players.get(id);
    if (!v) return;
    v.body.destroy(); v.aim.destroy();
    v.hpBg.destroy(); v.hpFill.destroy(); v.label.destroy();
    this.players.delete(id);
  }

  /* ── proyectiles ─────────────────────────────────────────── */
  private createProj(id: string, p: any) {
    const g = this.add.graphics().setDepth(60).setPosition(p.x||0, p.y||0);
    g.fillStyle(0xf472b6, 1);
    g.fillCircle(0, 0, 5);
    g.lineStyle(1, 0xfef3c7, 1);
    g.strokeCircle(0, 0, 7);
    this.projs.set(id, { g, tx: p.x||0, ty: p.y||0 });
  }

  /* ── trampas ─────────────────────────────────────────────── */
  private createTrap(id: string, t: any) {
    const g = this.add.graphics().setDepth(30);
    g.fillStyle(0x8b5cf6, 0.7);
    g.fillCircle(t.x, t.y, 14);
    g.lineStyle(3, 0xc084fc, 1);
    g.strokeCircle(t.x, t.y, 14);
    g.lineStyle(2, 0xffffff, 0.8);
    g.moveTo(t.x-8, t.y-8); g.lineTo(t.x+8, t.y+8);
    g.moveTo(t.x-8, t.y+8); g.lineTo(t.x+8, t.y-8);
    g.strokePath();
    this.traps.set(id, { g });
    this.tweens.add({ targets: g, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
  }

  /* ── update ──────────────────────────────────────────────── */
  update() {
    /* inputs */
    const me = this.players.get(this.myId);
    if (me && this.keys) {
      let dx = 0, dy = 0;
      if (this.keys.W.isDown) dy -= 1;
      if (this.keys.S.isDown) dy += 1;
      if (this.keys.A.isDown) dx -= 1;
      if (this.keys.D.isDown) dx += 1;

      const wp  = this.cameras.main.getWorldPoint(
        this.input.activePointer.x, this.input.activePointer.y
      );
      const rot = Phaser.Math.Angle.Between(me.body.x, me.body.y, wp.x, wp.y);
      this.net.sendMove(dx, dy, rot);
    }

    /* lerp jugadores */
    this.players.forEach(v => {
      const lf = 0.22;
      v.body.x    = Phaser.Math.Linear(v.body.x,    v.tx, lf);
      v.body.y    = Phaser.Math.Linear(v.body.y,    v.ty, lf);
      v.aim.x     = v.body.x;
      v.aim.y     = v.body.y;
      v.hpBg.x    = v.body.x;
      v.hpBg.y    = v.body.y;
      v.hpFill.x  = v.body.x;
      v.hpFill.y  = v.body.y;
      v.label.x   = v.body.x;
      v.label.y   = v.body.y - 50;

      /* redibuja cañón en cada frame con la rotación actual */
      this.redrawAim(v.aim, v.tr);
    });

    /* lerp proyectiles */
    this.projs.forEach(v => {
      v.g.x = Phaser.Math.Linear(v.g.x, v.tx, 0.4);
      v.g.y = Phaser.Math.Linear(v.g.y, v.ty, 0.4);
    });

    /* zona de peligro */
    this.drawZone();
  }

  private drawZone() {
    const g = this.zoneGfx;
    const { x, y, r } = this.zone;
    g.clear();
    g.fillStyle(0x7f1d1d, 0.4);
    const t  = Math.max(0, y - r);
    const b  = Math.min(2000, y + r);
    const l  = Math.max(0, x - r);
    const ri = Math.min(2000, x + r);
    if (t > 0)     g.fillRect(0,  0, 2000, t);
    if (b < 2000)  g.fillRect(0,  b, 2000, 2000 - b);
    if (l > 0)     g.fillRect(0,  t, l,    b - t);
    if (ri < 2000) g.fillRect(ri, t, 2000 - ri, b - t);
    g.lineStyle(7, 0x10b981, 1);
    g.strokeCircle(x, y, r);
    g.lineStyle(2, 0x6ee7b7, 0.7);
    g.strokeCircle(x, y, r - 5);
  }
}

function emit(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(`${name}-update`, { detail }));
}
