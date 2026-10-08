import Phaser from "phaser";
import { Room } from "colyseus.js";
import { NetworkClient } from "../NetworkManager";
import { GameState, Player, Projectile, Trap, Bush, ItemPickup, Obstacle } from "../schema/GameState";
import { soundManager } from "../SoundManager";
import { sseManager } from "../SSEClient";

const WEAPON_CONFIGS: Record<string, { shootCooldown: number; speed: number; range: number; pellets?: number }> = {
  LASER:   { shootCooldown: 0.3, speed: 800, range: 480 },
  SHOTGUN: { shootCooldown: 1.0, speed: 680, range: 310, pellets: 5 },
  SNIPER:  { shootCooldown: 0.5, speed: 1400, range: 980 },
  GRENADE: { shootCooldown: 1.0, speed: 500, range: 400 },
  MELEE:   { shootCooldown: 0.3, speed: 0, range: 75 },
};

/* ─── Tipos Gráficos ─────────────────────────────────────────── */
interface VPlayer {
  container:   Phaser.GameObjects.Container; // Contenedor visual rotativo del personaje (gato + arma)
  uiContainer: Phaser.GameObjects.Container; // Contenedor HUD superior que NUNCA rota (barra vida, nombre)
  bodyGfx:     Phaser.GameObjects.Graphics;
  earsGfx:     Phaser.GameObjects.Graphics;
  faceGfx:     Phaser.GameObjects.Graphics;
  aimGfx:      Phaser.GameObjects.Graphics;
  leftHandGfx: Phaser.GameObjects.Graphics;  // Mano izquierda estilo Suroi.io
  rightHandGfx: Phaser.GameObjects.Graphics; // Mano derecha estilo Suroi.io
  punchAlternator: number;                   // Alternador de puñetazo / zarpazo
  hpBg:        Phaser.GameObjects.Graphics;
  hpFill:      Phaser.GameObjects.Graphics;
  shdFill:     Phaser.GameObjects.Graphics;
  label:       Phaser.GameObjects.Text;
  buffIcon:    Phaser.GameObjects.Text;
  reloadBarGfx: Phaser.GameObjects.Graphics;
  emoteGfx:    Phaser.GameObjects.Container;
  emoteText:   Phaser.GameObjects.Text;
  tx: number; ty: number; tr: number;
  hp: number; maxHp: number;
  shield: number; maxShield: number;
  equippedWeapon: string;
  ammo: number; maxAmmo: number;
  reserveAmmo: number;
  isReloading: boolean;
  reloadTimer: number;
  maxReloadTimer: number;
  dashCooldown: number;
  isRolling?: boolean;
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
  vx: number; vy: number;
  projType: string;
  targetX?: number;
  targetY?: number;
  isArmed?: boolean;
  blinkTimer?: number;
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
  id: string;
  container: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  weaponGfx: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  itemType: string;
  active: boolean;
  x: number;
  y: number;
}

/* ─── Bala Local Pre-alocada (Object Pool de 200 Balas) ────────── */
export class VisualBullet extends Phaser.GameObjects.Graphics {
  public vx = 0;
  public vy = 0;
  public life = 0;
  public maxLife = 0;
  public radius = 4;
  public color = 0xffffff;
  public trailGfx!: Phaser.GameObjects.Graphics;

  init(x: number, y: number, angle: number, speed: number, lifetime: number, radius: number, color: number) {
    this.setPosition(x, y);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = lifetime;
    this.maxLife = lifetime;
    this.radius = radius;
    this.color = color;
    this.setActive(true);
    this.setVisible(true);

    this.clear();
    this.fillStyle(color, 1);
    this.fillCircle(0, 0, radius);
    this.fillStyle(0xffffff, 1);
    this.fillCircle(0, 0, radius * 0.45);

    if (this.trailGfx) {
      this.trailGfx.clear();
      this.trailGfx.setActive(true);
      this.trailGfx.setVisible(true);
    }
  }

  deactivate() {
    this.setActive(false);
    this.setVisible(false);
    this.clear();
    if (this.trailGfx) {
      this.trailGfx.clear();
      this.trailGfx.setActive(false);
      this.trailGfx.setVisible(false);
    }
  }
}

/* ─── Escena Principal Phaser (Optimizado & Game Feel) ───────── */
export class MainScene extends Phaser.Scene {
  public net!: NetworkClient;
  public playerOptions: { name?: string; skin?: number } = {};
  private room!: Room<GameState>;
  private myId = "";

  private bulletPool!: Phaser.GameObjects.Group;

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

  private zone = { x: 2400, y: 2400, r: 2300 };

  private styleScore = 0;
  private wasInBush = false;

  private lastSentDx = 0;
  private lastSentDy = 0;
  private lastSentRot = 0;
  private lastMoveSendTime = 0;

  // Suroi-style dynamic camera target & look-ahead
  private camTargetDummy!: Phaser.GameObjects.Arc;
  private camTarget = { x: 2400, y: 2400 };

  // Suroi-style interaction prompt & loot beacon
  private interactPromptGfx!: Phaser.GameObjects.Container;
  private interactTitleText!: Phaser.GameObjects.Text;
  private interactStatsText!: Phaser.GameObjects.Text;
  private nearestItem: VItem | null = null;
  private lootBeaconGfx!: Phaser.GameObjects.Graphics;

  // Footsteps & water movement tracking
  private lastFootstepDist = 0;
  private lastPlayerPos = { x: 2400, y: 2400 };

  // Dirty flags & throttle
  private zoneDirty = true;
  private lastZoneR = -1;
  private minimapThrottle = 0;
  private localShootCooldown = 0;

  // Object Pools for High FPS Zero-GC Performance
  private sparksPool!: Phaser.GameObjects.Group;
  private ghostTrailPool!: Phaser.GameObjects.Group;

  constructor() { super({ key: "MainScene" }); }

  create() {
    this.game.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.physics.world.setBounds(0, 0, 4800, 4800);
    this.cameras.main.setBounds(0, 0, 4800, 4800);
    this.cameras.main.centerOn(2400, 2400);

    // 1. Mapa de batalla estilo Suroi.io
    this.buildMap();

    // 2. Gráficos de Zona de Tinta y Beacons de Loot
    this.zoneGfx = this.add.graphics().setDepth(8);
    this.lootBeaconGfx = this.add.graphics().setDepth(24);

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

    // 3.1 Pre-alocación fija de Object Pool de 200 balas locales (Zero-GC y Culling)
    this.bulletPool = this.add.group({
      maxSize: 200,
      runChildUpdate: false,
    });
    for (let i = 0; i < 200; i++) {
      const b = new VisualBullet(this);
      b.trailGfx = this.add.graphics().setDepth(69);
      b.trailGfx.setActive(false).setVisible(false);
      b.setDepth(70);
      b.setActive(false).setVisible(false);
      this.add.existing(b);
      this.bulletPool.add(b);
    }

    // 4. Retícula Crosshair y Arco de Apuntado
    this.aimConeGfx = this.add.graphics().setDepth(50);
    this.crosshairGfx = this.add.graphics().setDepth(180);

    // 5. Minimapa (overlay sobre cámara)
    this.minimapGfx = this.add.graphics().setDepth(200).setScrollFactor(0);

    // 5.1 Dummy para Cámara Dinámica con Anticipación (Mouse Look-Ahead)
    this.camTargetDummy = this.add.circle(2400, 2400, 2, 0x000000, 0).setDepth(0);
    this.cameras.main.startFollow(this.camTargetDummy, true, 0.12, 0.12);

    // 5.2 Prompt de Interacción Flotante Estilo Suroi ([F] Recoger / Cambiar)
    this.interactPromptGfx = this.add.container(0, 0).setDepth(195).setVisible(false);
    const pBg = this.add.graphics();
    pBg.fillStyle(0x090d16, 0.94);
    pBg.fillRoundedRect(-115, -23, 230, 46, 12);
    pBg.lineStyle(2, 0x10b981, 0.95);
    pBg.strokeRoundedRect(-115, -23, 230, 46, 12);

    const keyBg = this.add.graphics();
    keyBg.fillStyle(0x10b981, 1);
    keyBg.fillRoundedRect(-103, -14, 28, 28, 6);
    const keyText = this.add.text(-89, 0, "F", {
      fontFamily: "Outfit, Inter, sans-serif",
      fontSize: "16px",
      fontStyle: "bold",
      color: "#022c22"
    }).setOrigin(0.5);

    this.interactTitleText = this.add.text(-64, -6, "RECOGER ARMA", {
      fontFamily: "Outfit, Inter, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#ffffff"
    }).setOrigin(0, 0.5);

    this.interactStatsText = this.add.text(-64, 10, "Daño: 25 | Rango: Medio", {
      fontFamily: "Outfit, Inter, sans-serif",
      fontSize: "10px",
      color: "#94a3b8"
    }).setOrigin(0, 0.5);

    this.interactPromptGfx.add([pBg, keyBg, keyText, this.interactTitleText, this.interactStatsText]);

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
      F:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      R:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

    // Tecla F: Recoger / Cambiar arma estilo Suroi
    this.keys.F.on("down", () => {
      this.tryInteract();
    });

    // Tecla R: Recargar arma actual
    this.keys.R.on("down", () => {
      this.tryReload();
    });

    this.keys.SPACE.on("down", () => {
      const me = this.players.get(this.myId);
      if (me && !me.isGhost) {
        this.performLocalDash(me);
      }
    });

    // Cambios de arma por números 1-5
    this.keys.ONE.on("down", () => this.switchWeapon("LASER"));
    this.keys.TWO.on("down", () => this.switchWeapon("SHOTGUN"));
    this.keys.THREE.on("down", () => this.switchWeapon("SNIPER"));
    this.keys.FOUR.on("down", () => this.switchWeapon("GRENADE"));
    this.keys.FIVE.on("down", () => this.switchWeapon("MELEE"));

    // Key E: emote rápido Miau o interactuar
    this.keys.E.on("down", () => {
      if (this.nearestItem) {
        this.tryInteract();
      } else {
        this.triggerEmote("🐾");
      }
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

    // 7. Puntero / Disparo con Retroceso Táctil (Weapon Kickback)
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      const me = this.players.get(this.myId);
      if (!me) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);

      if (ptr.leftButtonDown() && !me.isGhost) {
        this.executeLocalShoot(me);
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

    window.addEventListener("reload-weapon", () => {
      this.tryReload();
    });

    window.addEventListener("send-emote", (e: any) => {
      if (e.detail?.emote) this.triggerEmote(e.detail.emote);
    });

    // 8. Integración con Pipeline Ultra-Rápido SSE (Server-Sent Events)
    window.addEventListener("sse-tick", (e: any) => {
      const data = e.detail;
      if (!data?.players) return;
      data.players.forEach((pState: any) => {
        const v = this.players.get(pState.id);
        if (v && !v.isMe) {
          // Push autoritativo en tiempo real a 60/30Hz sin retardo de websocket
          v.tx = pState.x;
          v.ty = pState.y;
          v.tr = pState.rot;
          v.hp = pState.hp;
          v.shield = pState.shield;
          if (pState.w && pState.w !== v.equippedWeapon) {
            v.equippedWeapon = pState.w;
            this.drawCat(v);
          }
        }
      });
      if (data.zone) {
        this.zone.x = data.zone.x;
        this.zone.y = data.zone.y;
        this.zone.r = data.zone.r;
        this.zoneDirty = true;
      }
    });

    window.addEventListener("sse-shoot", (e: any) => {
      const d = e.detail;
      if (!d || d.id === this.myId) return;
      const p = this.players.get(d.id);
      if (p) {
        if (d.weapon === "SHOTGUN") soundManager.playShotgun();
        else if (d.weapon === "SNIPER") soundManager.playSniper();
        else if (d.weapon === "GRENADE") soundManager.playGrenadeThrow();
        else soundManager.playShoot();

        // Retroceso en arma y manos estilo Suroi.io
        const kick = d.weapon === "SNIPER" ? 10 : d.weapon === "SHOTGUN" ? 8 : 4;
        p.aimGfx.setPosition(-kick, 0);

        const lx = p.leftHandGfx.getData("baseX") ?? 16;
        const ly = p.leftHandGfx.getData("baseY") ?? -4;
        const rx = p.rightHandGfx.getData("baseX") ?? 12;
        const ry = p.rightHandGfx.getData("baseY") ?? 6.5;

        p.leftHandGfx.setPosition(lx - kick, ly);
        p.rightHandGfx.setPosition(rx - kick, ry);

        this.tweens.killTweensOf([p.aimGfx, p.leftHandGfx, p.rightHandGfx]);
        this.tweens.add({ targets: p.aimGfx, x: 0, duration: 65, ease: "Quad.easeOut" });
        this.tweens.add({ targets: p.leftHandGfx, x: lx, duration: 65, ease: "Quad.easeOut" });
        this.tweens.add({ targets: p.rightHandGfx, x: rx, duration: 65, ease: "Quad.easeOut" });
      }
    });

    window.addEventListener("sse-melee", (e: any) => {
      const d = e.detail;
      if (!d || d.id === this.myId) return;
      this.showGraphicClawSlash(d.x, d.y, d.angle);

      const p = this.players.get(d.id);
      if (p) {
        p.punchAlternator = (p.punchAlternator || 0) + 1;
        const isRight = p.punchAlternator % 2 === 1;
        const hand = isRight ? p.rightHandGfx : p.leftHandGfx;
        const bx = hand.getData("baseX") ?? 18;
        const by = hand.getData("baseY") ?? (isRight ? 13 : -13);

        this.tweens.killTweensOf(hand);
        hand.setPosition(bx + 15, by);
        this.tweens.add({ targets: hand, x: bx, duration: 110, ease: "Cubic.easeOut" });
      }
    });

    window.addEventListener("sse-dash", (e: any) => {
      const d = e.detail;
      if (!d || d.id === this.myId) return;
      const p = this.players.get(d.id);
      if (p) {
        if (d.isRoll) {
          this.playRollAnimation(p, d.dirX || 0, d.dirY || 0, 120, d.x, d.y);
        } else {
          this.playFastDashAnimation(p, d.dirX || 0, d.dirY || 0, 160, d.x, d.y);
        }
      }
    });

    window.addEventListener("sse-hit", (e: any) => {
      const d = e.detail;
      if (!d) return;
      this.showDamageText(d.x, d.y, `-${d.damage}`, "#ef4444");
      this.createSparksFX(d.x, d.y, 0xff4444);
      if (d.victimId === this.myId) {
        soundManager.playHit();
        this.cameras.main.shake(120, 0.012);
      }
    });

    window.addEventListener("sse-explosion", (e: any) => {
      const d = e.detail;
      if (!d) return;
      soundManager.playExplosion();
      this.createExplosionFX(d.x, d.y, d.type === "GRENADE", d.radius || 140, d.innerRadius || 70);
      this.cameras.main.shake(d.type === "GRENADE" ? 320 : 220, d.type === "GRENADE" ? 0.022 : 0.016);
    });

    // 9. Conectar sala Colyseus
    this.connect();
  }

  private executeLocalShoot(me: VPlayer) {
    if (me.isGhost || me.isReloading || this.localShootCooldown > 0) return;

    const w = me.equippedWeapon || "LASER";
    const cfg = WEAPON_CONFIGS[w] || WEAPON_CONFIGS.LASER;

    // Comprobar munición si el arma no es cuerpo a cuerpo
    if (w !== "MELEE" && typeof me.ammo === "number" && me.ammo <= 0) {
      if (typeof me.reserveAmmo === "number" && me.reserveAmmo > 0) {
        this.tryReload();
      } else {
        soundManager.playEmptyClick();
        this.showDamageText(me.container.x, me.container.y - 25, "¡SIN BALAS!", "#f87171");
        this.localShootCooldown = 0.4;
      }
      return;
    }

    const wp = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
    const angle = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);

    this.localShootCooldown = cfg.shootCooldown;

    // Descontar munición local predictiva y notificar a la UI
    if (w !== "MELEE" && typeof me.ammo === "number") {
      me.ammo = Math.max(0, me.ammo - 1);
      emit("ammo", {
        weapon: w,
        ammo: me.ammo,
        maxAmmo: me.maxAmmo,
        reserveAmmo: me.reserveAmmo,
        isReloading: me.isReloading,
      });
    }

    // Enviar disparo al servidor
    this.net.sendShoot(angle, wp.x, wp.y);

    // Audio y retroceso instantáneo a 0ms
    if (w === "SHOTGUN") soundManager.playShotgun();
    else if (w === "SNIPER") soundManager.playSniper();
    else if (w === "GRENADE") soundManager.playGrenadeThrow();
    else if (w === "MELEE") soundManager.playClawSlash();
    else soundManager.playShoot();

    this.cameras.main.shake(60, w === "SNIPER" ? 0.008 : 0.003);

    if (w === "MELEE") {
      me.punchAlternator = (me.punchAlternator || 0) + 1;
      const isRight = me.punchAlternator % 2 === 1;
      const punchingHand = isRight ? me.rightHandGfx : me.leftHandGfx;
      const bx = punchingHand.getData("baseX") ?? 18;
      const by = punchingHand.getData("baseY") ?? (isRight ? 13 : -13);

      this.tweens.killTweensOf(punchingHand);
      punchingHand.setPosition(bx + 16, by);
      this.tweens.add({
        targets: punchingHand,
        x: bx,
        y: by,
        duration: 120,
        ease: "Cubic.easeOut",
      });
    } else {
      const kickAmt = w === "SNIPER" ? 11 : w === "SHOTGUN" ? 9 : 5;
      me.aimGfx.setPosition(-kickAmt, 0);

      const lx = me.leftHandGfx.getData("baseX") ?? 16;
      const ly = me.leftHandGfx.getData("baseY") ?? -4;
      const rx = me.rightHandGfx.getData("baseX") ?? 12;
      const ry = me.rightHandGfx.getData("baseY") ?? 6.5;

      me.leftHandGfx.setPosition(lx - kickAmt, ly);
      me.rightHandGfx.setPosition(rx - kickAmt, ry);

      this.tweens.killTweensOf([me.aimGfx, me.leftHandGfx, me.rightHandGfx]);
      this.tweens.add({
        targets: me.aimGfx,
        x: 0,
        y: 0,
        duration: 75,
        ease: "Quad.easeOut",
      });
      this.tweens.add({
        targets: me.leftHandGfx,
        x: lx,
        y: ly,
        duration: 75,
        ease: "Quad.easeOut",
      });
      this.tweens.add({
        targets: me.rightHandGfx,
        x: rx,
        y: ry,
        duration: 75,
        ease: "Quad.easeOut",
      });
    }

    // Proyectil visual predictivo instantáneo
    this.spawnPredictedProjectile(me, angle, wp.x, wp.y, w);
  }

  private spawnPredictedProjectile(me: VPlayer, angle: number, targetX: number, targetY: number, weapon: string) {
    if (weapon === "MELEE") {
      const slashX = me.container.x + Math.cos(angle) * 36;
      const slashY = me.container.y + Math.sin(angle) * 36;
      this.showGraphicClawSlash(slashX, slashY, angle);
      return;
    }

    const barrelDist = weapon === "SNIPER" ? 32 : weapon === "SHOTGUN" ? 22 : 28;
    const spawnX = me.container.x + Math.cos(angle) * barrelDist;
    const spawnY = me.container.y + Math.sin(angle) * barrelDist;

    // Destello de boca de cañón
    this.createSparksFX(spawnX, spawnY, weapon === "SNIPER" ? 0x06b6d4 : weapon === "SHOTGUN" ? 0xef4444 : 0x10b981);

    if (weapon === "SHOTGUN") {
      const pellets = 5;
      const spread = 0.28;
      const speed = 680;
      for (let i = 0; i < pellets; i++) {
        const offset = (i - (pellets - 1) / 2) * (spread / (pellets - 1));
        const a = angle + offset;
        this.createLocalVisualBullet(spawnX, spawnY, a, speed, 310 / speed, 4, 0xef4444);
      }
    } else if (weapon === "SNIPER") {
      const speed = 1400;
      this.createLocalVisualBullet(spawnX, spawnY, angle, speed, 980 / speed, 7, 0x06b6d4);
    } else if (weapon === "GRENADE") {
      const rawDist = Math.hypot(targetX - me.container.x, targetY - me.container.y);
      const dist = Math.min(400, rawDist);
      const destX = me.container.x + Math.cos(angle) * dist;
      const destY = me.container.y + Math.sin(angle) * dist;
      const speed = 500;
      const flightDuration = Math.max(0.08, dist / speed);
      const gObj = this.add.graphics().setDepth(70).setPosition(spawnX, spawnY);
      gObj.fillStyle(0x84cc16, 1);
      gObj.fillCircle(0, 0, 9);
      gObj.lineStyle(2, 0xffffff, 1);
      gObj.strokeCircle(0, 0, 9);
      this.tweens.add({
        targets: gObj,
        x: destX,
        y: destY,
        duration: flightDuration * 1000,
        ease: "Linear",
        onComplete: () => {
          this.time.delayedCall(2200, () => {
            if (gObj && gObj.active) gObj.destroy();
          });
        }
      });
    } else { // LASER
      const isTriple = me.lastBuff === "TRIPLE";
      const angles = isTriple ? [angle - 0.18, angle, angle + 0.18] : [angle];
      const speed = 800;
      for (const a of angles) {
        this.createLocalVisualBullet(spawnX, spawnY, a, speed, 480 / speed, 6, 0xf472b6);
      }
    }
  }

  public isInCameraView(x: number, y: number, padding = 100): boolean {
    const cam = this.cameras.main.worldView;
    return (
      x >= cam.x - padding &&
      x <= cam.right + padding &&
      y >= cam.y - padding &&
      y <= cam.bottom + padding
    );
  }

  private createLocalVisualBullet(x: number, y: number, angle: number, speed: number, lifetime: number, radius: number, color: number) {
    const children = this.bulletPool.getChildren() as VisualBullet[];
    let bullet: VisualBullet | null = null;

    // 1. Buscar bala inactiva en el Object Pool
    for (let i = 0; i < children.length; i++) {
      if (!children[i].active) {
        bullet = children[i];
        break;
      }
    }

    // 2. Si las 200 balas están en uso activo, reciclar la más antigua (menor vida restante)
    if (!bullet && children.length > 0) {
      let lowestLife = Infinity;
      let oldestIdx = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].life < lowestLife) {
          lowestLife = children[i].life;
          oldestIdx = i;
        }
      }
      bullet = children[oldestIdx];
      bullet.deactivate();
    }

    if (bullet) {
      bullet.init(x, y, angle, speed, lifetime, radius, color);
    }
  }

  private tryReload() {
    const me = this.players.get(this.myId);
    if (!me || me.isGhost || me.isReloading) return;
    if (me.equippedWeapon === "MELEE" || me.equippedWeapon === "GRENADE") return;
    if (typeof me.ammo === "number" && typeof me.maxAmmo === "number" && me.ammo >= me.maxAmmo) return;
    if (typeof me.reserveAmmo === "number" && me.reserveAmmo <= 0) {
      soundManager.playEmptyClick();
      this.showDamageText(me.container.x, me.container.y - 25, "¡SIN RESERVA!", "#f87171");
      return;
    }
    this.net.sendReload();
    soundManager.playReload();
    this.showDamageText(me.container.x, me.container.y - 25, "RECARGANDO...", "#fbbf24");
  }

  private performLocalDash(me: VPlayer) {
    if (me.isGhost || (me.dashCooldown || 0) > 0) return;

    let dx = 0;
    let dy = 0;
    if (this.keys.W.isDown) dy -= 1;
    if (this.keys.S.isDown) dy += 1;
    if (this.keys.A.isDown) dx -= 1;
    if (this.keys.D.isDown) dx += 1;

    let dirX = 0;
    let dirY = 0;
    const mag = Math.hypot(dx, dy);

    if (mag > 0) {
      // Movimiento con WASD activo: se desplaza hacia la dirección de WASD
      dirX = dx / mag;
      dirY = dy / mag;
    } else {
      // Estacionario (sin movimiento): se desplaza hacia donde apunta el cursor del ratón
      const wp = this.cameras.main.getWorldPoint(
        this.input.activePointer.x, this.input.activePointer.y
      );
      const angle = Phaser.Math.Angle.Between(me.container.x, me.container.y, wp.x, wp.y);
      dirX = Math.cos(angle);
      dirY = Math.sin(angle);
    }

    const isMelee = me.equippedWeapon === "MELEE";
    const isRoll = !isMelee;
    const cooldown = isMelee ? 1.8 : 2.5;
    const dashDist = isMelee ? 160 : 120; // 160px para garras (rápido), 120px para roll de arma (más lento pero esquiva)

    me.dashCooldown = cooldown;
    this.net.sendDash(dirX, dirY);

    if (isRoll) {
      soundManager.playRoll();
      this.playRollAnimation(me, dirX, dirY, dashDist);
    } else {
      soundManager.playDash();
      this.playFastDashAnimation(me, dirX, dirY, dashDist);
    }
  }

  public playFastDashAnimation(
    v: VPlayer,
    dirX: number,
    dirY: number,
    distance: number,
    targetX?: number,
    targetY?: number
  ) {
    this.cameras.main.shake(90, 0.006);

    let destX = typeof targetX === "number" ? targetX : v.container.x + dirX * distance;
    let destY = typeof targetY === "number" ? targetY : v.container.y + dirY * distance;

    if (typeof targetX !== "number") {
      const pRadius = 22;
      this.obstacles.forEach((obs) => {
        if (obs.destroyed) return;
        const dist = Math.hypot(destX - obs.container.x, destY - obs.container.y);
        const minDist = pRadius + obs.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          destX += ((destX - obs.container.x) / dist) * overlap;
          destY += ((destY - obs.container.y) / dist) * overlap;
        }
      });
    }
    destX = Math.max(30, Math.min(4800 - 30, destX));
    destY = Math.max(30, Math.min(4800 - 30, destY));

    // Estelas doradas rápidas
    for (let i = 0; i < 4; i++) {
      this.time.delayedCall(i * 30, () => {
        if (v.container && v.container.active) {
          this.spawnGhostTrail(v, 0xfbbf24);
        }
      });
    }

    this.tweens.killTweensOf(v.container);
    this.tweens.add({
      targets: v.container,
      x: destX,
      y: destY,
      duration: 140,
      ease: "Quad.easeOut",
    });
  }

  public playRollAnimation(
    v: VPlayer,
    dirX: number,
    dirY: number,
    distance: number,
    targetX?: number,
    targetY?: number
  ) {
    this.cameras.main.shake(70, 0.004);
    v.isRolling = true;

    let destX = typeof targetX === "number" ? targetX : v.container.x + dirX * distance;
    let destY = typeof targetY === "number" ? targetY : v.container.y + dirY * distance;

    if (typeof targetX !== "number") {
      const pRadius = 22;
      this.obstacles.forEach((obs) => {
        if (obs.destroyed) return;
        const dist = Math.hypot(destX - obs.container.x, destY - obs.container.y);
        const minDist = pRadius + obs.radius;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          destX += ((destX - obs.container.x) / dist) * overlap;
          destY += ((destY - obs.container.y) / dist) * overlap;
        }
      });
    }
    destX = Math.max(30, Math.min(4800 - 30, destX));
    destY = Math.max(30, Math.min(4800 - 30, destY));

    // Partículas de polvo al rodar
    this.createDustPuffFX(v.container.x, v.container.y);
    this.time.delayedCall(90, () => {
      if (v.container && v.container.active) this.createDustPuffFX(v.container.x, v.container.y);
    });

    // Giro acrobático 360° en la dirección del movimiento
    const spinDir = dirX >= 0 ? 1 : -1;
    const initialRot = v.container.rotation;

    this.tweens.add({
      targets: v.container,
      rotation: initialRot + spinDir * Math.PI * 2,
      duration: 220,
      ease: "Cubic.easeInOut",
      onComplete: () => {
        v.isRolling = false;
      },
    });

    this.tweens.killTweensOf(v.container);
    this.tweens.add({
      targets: v.container,
      x: destX,
      y: destY,
      duration: 220,
      ease: "Cubic.easeOut",
    });
  }

  private switchWeapon(w: string) {
    const me = this.players.get(this.myId);
    if (me && me.equippedWeapon !== w) {
      me.equippedWeapon = w;
      this.net.sendSwitchWeapon(w);
      this.drawCat(me);
      emit("player", {
        hp: me.hp,
        maxHp: me.maxHp,
        shield: me.shield,
        maxShield: me.maxShield,
        equippedWeapon: me.equippedWeapon,
        ammo: me.ammo,
        maxAmmo: me.maxAmmo,
        reserveAmmo: me.reserveAmmo,
        isGhost: me.isGhost,
        activeBuff: "",
        dashCooldown: me.dashCooldown,
      });
      emit("ammo", {
        weapon: w,
        ammo: me.ammo,
        maxAmmo: me.maxAmmo,
        reserveAmmo: me.reserveAmmo,
        isReloading: me.isReloading,
      });
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
      if (p.ownerId === this.myId) return; // El cliente local ya cuenta con su proyectil predictivo instantáneo a 0ms
      this.createProj(id, p);
      p.onChange(() => {
        const v = this.projs.get(id);
        if (v) {
          v.tx = p.x;
          v.ty = p.y;
          v.vx = p.vx || 0;
          v.vy = p.vy || 0;
          v.isArmed = !!p.isArmed;
          v.targetX = p.targetX;
          v.targetY = p.targetY;
        }
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

    this.room.onMessage("playerMelee", (d: any) => {
      this.showGraphicClawSlash(d.x, d.y, d.angle);
    });

    this.room.onMessage("playerReloading", (d: any) => {
      if (d.id === this.myId) {
        soundManager.playReload();
      }
    });

    this.room.onMessage("playerReloadComplete", (_d: any) => {
      // Reload complete event
    });

    this.room.onMessage("explosion", (d: any) => {
      soundManager.playExplosion();
      this.createExplosionFX(d.x, d.y, d.type === "GRENADE", d.radius || 140, d.innerRadius || 70);
      this.cameras.main.shake(d.type === "GRENADE" ? 320 : 220, d.type === "GRENADE" ? 0.022 : 0.016);
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
        p.dashCooldown = d.cooldown ?? (d.isRoll ? 2.5 : 1.8);
        if (d.id !== this.myId) {
          if (d.isRoll) {
            this.playRollAnimation(p, d.dirX || 0, d.dirY || 0, 120, d.x, d.y);
          } else {
            this.playFastDashAnimation(p, d.dirX || 0, d.dirY || 0, 160, d.x, d.y);
          }
        }
        if (d.id === this.myId) {
          this.addStyle(30, d.isRoll ? "ESQUIVA TÁCTICA" : "DASH FELINO");
        }
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

  /* ── Mapa y Vegetación Optimizado (Phaser 3 Tilemap + Culling) ─── */
  private buildMap() {
    const tileW = 80;
    const tileH = 80;
    const numCols = 60; // 4800 / 80
    const numRows = 60; // 4800 / 80
    const totalTileTypes = 10;

    // 1. Textura procedural para el Tileset oficial
    if (this.textures.exists("jungleTileset")) {
      this.textures.remove("jungleTileset");
    }

    const canvasTex = this.textures.createCanvas("jungleTileset", tileW * totalTileTypes, tileH);
    if (!canvasTex) return;
    const ctx = canvasTex.getContext();

    // Helper para dibujar cada tipo de tile en su slot horizontal
    const drawTileBase = (idx: number, fill: string) => {
      const tx = idx * tileW;
      ctx.fillStyle = fill;
      ctx.fillRect(tx, 0, tileW, tileH);
      // Cuadrícula táctica sutil (estilo Suroi)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, 0.5, tileW - 1, tileH - 1);
    };

    // Tile 0: Océano Profundo Exterior (0x1c497d)
    drawTileBase(0, "#1c497d");
    ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
    ctx.beginPath();
    ctx.arc(0 * tileW + 40, 40, 24, 0, Math.PI * 2);
    ctx.stroke();

    // Tile 1: Océano Costero (0x2767ae)
    drawTileBase(1, "#2767ae");
    ctx.strokeStyle = "rgba(65, 139, 214, 0.4)";
    ctx.beginPath();
    ctx.arc(1 * tileW + 28, 30, 14, 0, Math.PI * 2);
    ctx.arc(1 * tileW + 56, 56, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Tile 2: Playa de Arena (0xbc9f5d)
    drawTileBase(2, "#bc9f5d");
    ctx.fillStyle = "#a58849";
    ctx.fillRect(2 * tileW + 18, 22, 4, 4);
    ctx.fillRect(2 * tileW + 48, 52, 4, 4);
    ctx.fillRect(2 * tileW + 62, 16, 3, 3);

    // Tile 3: Hierba Principal (0x53893a)
    drawTileBase(3, "#53893a");
    ctx.fillStyle = "#44752c";
    ctx.fillRect(3 * tileW + 24, 26, 3, 6);
    ctx.fillRect(3 * tileW + 54, 48, 3, 6);
    ctx.fillStyle = "#5c9641";
    ctx.fillRect(3 * tileW + 38, 60, 4, 3);

    // Tile 4: Claro Soleado de Hierba (0x5c9641)
    drawTileBase(4, "#5c9641");
    ctx.fillStyle = "#68a74b";
    ctx.fillRect(4 * tileW + 20, 20, 4, 4);
    ctx.fillRect(4 * tileW + 50, 40, 4, 4);

    // Tile 5: Bosque Denso (0x45732f)
    drawTileBase(5, "#45732f");
    ctx.fillStyle = "#3b6228";
    ctx.fillRect(5 * tileW + 16, 28, 5, 5);
    ctx.fillRect(5 * tileW + 46, 54, 5, 5);

    // Tile 6: Camino de Tierra (0x996733)
    drawTileBase(6, "#996733");
    ctx.fillStyle = "#7c4f22";
    ctx.fillRect(6 * tileW, 0, 4, tileH);
    ctx.fillRect(6 * tileW + tileW - 4, 0, 4, tileH);
    ctx.fillStyle = "#b47f44";
    ctx.fillRect(6 * tileW + 30, 24, 5, 5);
    ctx.fillRect(6 * tileW + 50, 52, 4, 4);

    // Tile 7: Orilla del Río / Lodo Ribereño (0x735130)
    drawTileBase(7, "#735130");
    ctx.fillStyle = "#5a3e23";
    ctx.fillRect(7 * tileW + 24, 28, 6, 6);
    ctx.fillRect(7 * tileW + 52, 48, 5, 5);

    // Tile 8: Agua Viva del Río (0x2767ae)
    drawTileBase(8, "#2767ae");
    ctx.strokeStyle = "rgba(94, 166, 243, 0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(8 * tileW + 10, 20);
    ctx.lineTo(8 * tileW + 70, 20);
    ctx.moveTo(8 * tileW + 20, 55);
    ctx.lineTo(8 * tileW + 60, 55);
    ctx.stroke();

    // Tile 9: Tablones del Puente de Madera (0x784421)
    drawTileBase(9, "#784421");
    ctx.fillStyle = "#4d2810";
    ctx.fillRect(9 * tileW, 10, tileW, 4);
    ctx.fillRect(9 * tileW, 36, tileW, 4);
    ctx.fillRect(9 * tileW, 62, tileW, 4);
    ctx.fillStyle = "#d97706";
    ctx.fillRect(9 * tileW + 12, 22, 5, 5);
    ctx.fillRect(9 * tileW + 62, 22, 5, 5);
    ctx.fillRect(9 * tileW + 12, 48, 5, 5);
    ctx.fillRect(9 * tileW + 62, 48, 5, 5);

    canvasTex.refresh();

    // 2. Generación matricial del mapa 60x60
    const riverPoints = [
      { x: 2400, y: 0 },
      { x: 2520, y: 900 },
      { x: 2360, y: 1900 },
      { x: 2260, y: 2900 },
      { x: 2580, y: 3900 },
      { x: 2480, y: 4800 },
    ];

    const distToRiver = (x: number, y: number): number => {
      let minDist = Infinity;
      for (let i = 0; i < riverPoints.length - 1; i++) {
        const p1 = riverPoints[i];
        const p2 = riverPoints[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const l2 = dx * dx + dy * dy;
        if (l2 === 0) continue;
        let t = ((x - p1.x) * dx + (y - p1.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const px = p1.x + t * dx;
        const py = p1.y + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d < minDist) minDist = d;
      }
      return minDist;
    };

    const isBridge = (x: number, y: number): boolean => {
      if (x >= 2440 && x <= 2600 && y >= 1110 && y <= 1210) return true;
      if (x >= 2230 && x <= 2390 && y >= 2350 && y <= 2450) return true;
      if (x >= 2460 && x <= 2620 && y >= 3550 && y <= 3650) return true;
      return false;
    };

    const clearings = [
      { x: 1200, y: 1100, rx: 260, ry: 180 },
      { x: 3600, y: 1200, rx: 280, ry: 190 },
      { x: 1300, y: 3500, rx: 270, ry: 180 },
      { x: 3500, y: 3600, rx: 260, ry: 190 },
      { x: 2400, y: 2400, rx: 320, ry: 240 },
      { x: 2400, y: 700,  rx: 200, ry: 150 },
      { x: 2400, y: 4100, rx: 200, ry: 150 },
    ];

    const densePatches = [
      { x: 800,  y: 1800, rx: 220, ry: 170 },
      { x: 3900, y: 2000, rx: 230, ry: 160 },
      { x: 900,  y: 2800, rx: 240, ry: 160 },
      { x: 3800, y: 2900, rx: 220, ry: 170 },
      { x: 1700, y: 2400, rx: 250, ry: 180 },
      { x: 3100, y: 2400, rx: 250, ry: 180 },
    ];

    const mapData: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      const rowData: number[] = [];
      for (let col = 0; col < numCols; col++) {
        const wx = col * tileW + tileW / 2;
        const wy = row * tileH + tileH / 2;

        let tile = 3; // Hierba por defecto

        // Océano y Playa en los bordes
        if (wx < 120 || wx > 4680 || wy < 120 || wy > 4680) {
          tile = 0; // Océano profundo
        } else if (wx < 220 || wx > 4580 || wy < 220 || wy > 4580) {
          tile = 1; // Océano costero
        } else if (wx < 360 || wx > 4440 || wy < 360 || wy > 4440) {
          tile = 2; // Playa de arena
        } else {
          // Puente de madera prioritario
          if (isBridge(wx, wy)) {
            tile = 9;
          } else {
            const rDist = distToRiver(wx, wy);
            if (rDist < 42) {
              tile = 8; // Agua de río
            } else if (rDist < 65) {
              tile = 7; // Orilla de lodo
            } else if (Math.abs(wy - 2400) <= 32 && wx >= 400 && wx <= 4400) {
              tile = 6; // Carretera central E-O
            } else if (wx >= 2490 && wx <= 2550 && wy >= 400 && wy <= 1160) {
              tile = 6; // Conector puente norte
            } else if (wx >= 2510 && wx <= 2570 && wy >= 3600 && wy <= 4400) {
              tile = 6; // Conector puente sur
            } else {
              // Comprobar parches de biomas
              let inClearing = false;
              for (const c of clearings) {
                const ex = (wx - c.x) / c.rx;
                const ey = (wy - c.y) / c.ry;
                if (ex * ex + ey * ey <= 1) {
                  inClearing = true;
                  break;
                }
              }

              if (inClearing) {
                tile = 4; // Claro soleado
              } else {
                let inDense = false;
                for (const d of densePatches) {
                  const ex = (wx - d.x) / d.rx;
                  const ey = (wy - d.y) / d.ry;
                  if (ex * ex + ey * ey <= 1) {
                    inDense = true;
                    break;
                  }
                }
                if (inDense) tile = 5; // Bosque denso
              }
            }
          }
        }

        rowData.push(tile);
      }
      mapData.push(rowData);
    }

    // 3. Crear Tilemap oficial de Phaser 3 con Culling activado
    const tilemap = this.make.tilemap({
      data: mapData,
      tileWidth: tileW,
      tileHeight: tileH,
    });

    const tileset = tilemap.addTilesetImage("jungleTileset", "jungleTileset", tileW, tileH, 0, 0, 0);
    if (tileset) {
      const layer = tilemap.createLayer(0, tileset, 0, 0);
      if (layer) {
        layer.setDepth(0);
        layer.skipCull = false; // Culling activo en WebGL
        layer.setCullPadding(2, 2); // 2 celdas de margen alrededor del frustum de cámara
      }
    }

    // Estructuras de puente de madera con relieve para máximo contraste visual
    const bridgeGfx = this.add.graphics().setDepth(1);
    this.drawWoodenBridge(bridgeGfx, 2520, 1160, 140, 70);
    this.drawWoodenBridge(bridgeGfx, 2310, 2400, 140, 70);
    this.drawWoodenBridge(bridgeGfx, 2540, 3600, 140, 70);

    // Límites de frontera exterior decorativos
    const borderGfx = this.add.graphics().setDepth(2);
    borderGfx.lineStyle(8, 0x1c497d, 1);
    borderGfx.strokeRect(4, 4, 4792, 4792);
    borderGfx.lineStyle(2, 0x38bdf8, 0.4);
    borderGfx.strokeRect(12, 12, 4776, 4776);
  }

  private drawWoodenBridge(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number) {
    g.fillStyle(0x000000, 0.35);
    g.fillRect(cx - w/2 + 4, cy - h/2 + 4, w, h);

    g.fillStyle(0x784421, 1);
    g.fillRect(cx - w/2, cy - h/2, w, h);

    g.lineStyle(2, 0x4d2810, 0.85);
    for (let x = cx - w/2 + 10; x < cx + w/2; x += 10) {
      g.lineBetween(x, cy - h/2, x, cy + h/2);
    }

    g.lineStyle(4, 0x3d1f0a, 1);
    g.lineBetween(cx - w/2, cy - h/2, cx + w/2, cy - h/2);
    g.lineBetween(cx - w/2, cy + h/2, cx + w/2, cy + h/2);

    g.fillStyle(0xd97706, 1);
    for (let x = cx - w/2 + 8; x < cx + w/2; x += 22) {
      g.fillCircle(x, cy - h/2, 2.5);
      g.fillCircle(x, cy + h/2, 2.5);
    }
  }

  public checkInRiver(x: number, y: number): boolean {
    if (x >= 2440 && x <= 2600 && y >= 1110 && y <= 1210) return false;
    if (x >= 2230 && x <= 2390 && y >= 2350 && y <= 2450) return false;
    if (x >= 2460 && x <= 2620 && y >= 3550 && y <= 3650) return false;

    const pts = [
      { x: 2400, y: 0 },
      { x: 2520, y: 900 },
      { x: 2360, y: 1900 },
      { x: 2260, y: 2900 },
      { x: 2580, y: 3900 },
      { x: 2480, y: 4800 },
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
      if (Math.hypot(x - px, y - py) < 55) return true;
    }
    return false;
  }

  private drawBush(b: Bush) {
    const container = this.add.container(b.x, b.y).setDepth(20);
    const g = this.add.graphics();
    const w = b.width || 160, h = b.height || 120;

    // Sombra proyectada del arbusto
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(4, 5, w * 0.48, h * 0.45);

    // Arbusto estilo Suroi con lóbulos verdes orgánicos
    g.fillStyle(0x274e22, 0.92);
    g.fillEllipse(0, 0, w * 0.46, h * 0.42);

    g.fillStyle(0x35632e, 0.90);
    g.fillCircle(-w * 0.22, -h * 0.14, h * 0.32);
    g.fillCircle(w * 0.22, -h * 0.12, h * 0.30);
    g.fillCircle(-w * 0.18, h * 0.14, h * 0.30);
    g.fillCircle(w * 0.18, h * 0.14, h * 0.32);

    g.fillStyle(0x44773b, 0.85);
    g.fillCircle(-w * 0.1, -h * 0.08, h * 0.24);
    g.fillCircle(w * 0.1, h * 0.08, h * 0.24);

    container.add(g);
  }

  /* ── Obstáculos Vectoriales Estilo Suroi.io ────────────────── */
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
        gfx.fillStyle(0x3f2e16, 0.45);
        gfx.fillRect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6);
      } else if (obsType === "BARREL") {
        gfx.fillStyle(0x450a0a, 0.45);
        gfx.fillCircle(0, 0, radius * 0.7);
      }
      return;
    }

    if (obsType === "CRATE") {
      // Caja regular estilo Suroi.io regular_crate.svg
      const s = radius * 1.85;
      // Sombra proyectada en el suelo
      gfx.fillStyle(0x000000, 0.28);
      gfx.fillRect(-s/2 + 5, -s/2 + 5, s, s);

      // Fondo de tablones de madera
      gfx.fillStyle(0x674b24, 1);
      gfx.fillRect(-s/2, -s/2, s, s);

      // Separaciones verticales entre tablones (grooves oscuros)
      gfx.lineStyle(1.5, 0x342612, 1);
      gfx.lineBetween(-s/6, -s/2, -s/6, s/2);
      gfx.lineBetween(s/6, -s/2, s/6, s/2);

      // Marco perimetral de madera gruesa
      gfx.lineStyle(4, 0x9e7437, 1);
      gfx.strokeRect(-s/2 + 2, -s/2 + 2, s - 4, s - 4);
      gfx.lineStyle(1.5, 0x3f2e16, 1);
      gfx.strokeRect(-s/2, -s/2, s, s);

      // Travesaño diagonal central reforzado estilo Suroi
      gfx.lineStyle(5.5, 0x9e7437, 1);
      gfx.lineBetween(-s/2 + 3, -s/2 + 3, s/2 - 3, s/2 - 3);
      gfx.lineStyle(1.5, 0x3f2e16, 1);
      gfx.lineBetween(-s/2 + 3, -s/2 + 3, s/2 - 3, s/2 - 3);

      // 4 Remaches esquineros metálicos con borde oscuro
      const rivetOff = s/2 - 5;
      const rivets = [
        [-rivetOff, -rivetOff], [rivetOff, -rivetOff],
        [-rivetOff, rivetOff], [rivetOff, rivetOff]
      ];
      rivets.forEach(([rx, ry]) => {
        gfx.fillStyle(0x808080, 1);
        gfx.fillCircle(rx, ry, 2.2);
        gfx.lineStyle(1, 0x2e2e2e, 1);
        gfx.strokeCircle(rx, ry, 2.2);
      });

    } else if (obsType === "BARREL") {
      // Barril explosivo estilo Suroi
      gfx.fillStyle(0x000000, 0.35);
      gfx.fillCircle(4, 5, radius);

      // Cuerpo rojo intenso
      gfx.fillStyle(0xb91c1c, 1);
      gfx.fillCircle(0, 0, radius);
      gfx.lineStyle(3, 0x1f2937, 1);
      gfx.strokeCircle(0, 0, radius);

      // Aro interior metálico
      gfx.fillStyle(0x7f1d1d, 1);
      gfx.fillCircle(0, 0, radius * 0.72);

      // Franja de peligro amarilla
      gfx.lineStyle(3.5, 0xfacc15, 1);
      gfx.strokeCircle(0, 0, radius * 0.52);

      // Tapa central industrial
      gfx.fillStyle(0xfef08a, 1);
      gfx.fillCircle(0, 0, radius * 0.25);

    } else if (obsType === "BOULDER") {
      // Roca facetada estilo Suroi.io rock_1.svg
      gfx.fillStyle(0x000000, 0.28);
      gfx.fillCircle(4, 5, radius);

      const r = radius;
      const pts = [
        { x: -r * 0.75, y: -r * 0.25 },
        { x: -r * 0.40, y: -r * 0.85 },
        { x:  r * 0.45, y: -r * 0.80 },
        { x:  r * 0.88, y: -r * 0.20 },
        { x:  r * 0.80, y:  r * 0.65 },
        { x:  r * 0.10, y:  r * 0.90 },
        { x: -r * 0.68, y:  r * 0.60 }
      ];

      // Cuerpo base
      gfx.fillStyle(0x787f86, 1);
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.closePath();
      gfx.fillPath();

      // Faceta de sombra inferior derecha
      gfx.fillStyle(0x555a60, 1);
      gfx.beginPath();
      gfx.moveTo(pts[4].x, pts[4].y);
      gfx.lineTo(pts[5].x, pts[5].y);
      gfx.lineTo(pts[6].x, pts[6].y);
      gfx.lineTo(0, r * 0.2);
      gfx.closePath();
      gfx.fillPath();

      // Faceta de luz superior izquierda
      gfx.fillStyle(0x9ba1a8, 1);
      gfx.beginPath();
      gfx.moveTo(pts[1].x, pts[1].y);
      gfx.lineTo(pts[2].x, pts[2].y);
      gfx.lineTo(pts[3].x, pts[3].y);
      gfx.lineTo(0, -r * 0.25);
      gfx.closePath();
      gfx.fillPath();

      // Contorno oscuro nítido
      gfx.lineStyle(2.8, 0x27292c, 1);
      gfx.beginPath();
      gfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i].x, pts[i].y);
      gfx.closePath();
      gfx.strokePath();

    } else if (obsType === "TREE") {
      // Árbol estilo Suroi.io oak_tree_leaves_1.svg
      gfx.fillStyle(0x000000, 0.28);
      gfx.fillCircle(5, 7, radius * 1.05);

      const r = radius;
      // Lóbulos base oscuros
      gfx.fillStyle(0x416631, 1);
      gfx.fillCircle(-r * 0.28,  r * 0.22, r * 0.58);
      gfx.fillCircle( r * 0.28,  r * 0.25, r * 0.60);
      gfx.fillCircle( r * 0.32, -r * 0.22, r * 0.55);
      gfx.fillCircle(-r * 0.25, -r * 0.28, r * 0.58);

      // Lóbulos intermedios
      gfx.fillStyle(0x4a7538, 0.95);
      gfx.fillCircle(0, 0, r * 0.68);
      gfx.fillCircle(-r * 0.15, -r * 0.12, r * 0.52);
      gfx.fillCircle( r * 0.15,  r * 0.12, r * 0.52);

      // Crestas de hojas iluminadas verde Suroi
      gfx.fillStyle(0x588a42, 0.92);
      gfx.fillCircle(-r * 0.18, -r * 0.25, r * 0.38);
      gfx.fillCircle( r * 0.22, -r * 0.18, r * 0.35);
      gfx.fillCircle( r * 0.12,  r * 0.28, r * 0.34);

      // Tronco central visible entre las hojas
      gfx.fillStyle(0x5c3a21, 1);
      gfx.fillCircle(0, 0, r * 0.22);
      gfx.lineStyle(1.5, 0x3d2311, 1);
      gfx.strokeCircle(0, 0, r * 0.22);
    }

    if (hp < maxHp && hp > 0) {
      const w = 42;
      const ratio = hp / maxHp;
      gfx.fillStyle(0x0f172a, 0.85);
      gfx.fillRect(-w/2, -radius - 14, w, 5);
      gfx.fillStyle(0xef4444, 1);
      gfx.fillRect(-w/2, -radius - 14, w * ratio, 5);
    }
  }

  /* ── Pickups (Loot en el Suelo Estilo Suroi.io) ─────────────── */
  private createItem(id: string, item: ItemPickup) {
    const container = this.add.container(item.x, item.y).setDepth(25);
    const g = this.add.graphics();
    const weaponGfx = this.add.graphics();

    let color = 0x10b981;
    let emoji = "🧪";
    const isGun = ["SHOTGUN", "SNIPER", "GRENADE", "LASER"].includes(item.itemType);

    if (item.itemType === "SHIELD") { color = 0x38bdf8; emoji = "🛡️"; }
    else if (item.itemType === "SPEED") { color = 0xf59e0b; emoji = "⚡"; }
    else if (item.itemType === "TRIPLE") { color = 0xa855f7; emoji = "🌟"; }
    else if (item.itemType === "SHOTGUN") { color = 0xef4444; emoji = "💥"; }
    else if (item.itemType === "SNIPER") { color = 0x06b6d4; emoji = "🎯"; }
    else if (item.itemType === "GRENADE") { color = 0x84cc16; emoji = "💣"; }

    // Pedestal de Loot Circular con Resplandor Suroi
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(2, 4, 22);

    g.fillStyle(0x0a101d, 0.92);
    g.fillCircle(0, 0, 22);

    g.fillStyle(color, 0.22);
    g.fillCircle(0, 0, 20);

    g.lineStyle(2.5, color, 0.95);
    g.strokeCircle(0, 0, 22);

    // Silueta vectorial de arma rotada a -15° (Estilo Gun Suroi)
    this.drawLootGraphic(weaponGfx, item.itemType, color);

    const icon = this.add.text(0, isGun ? 14 : 0, isGun ? "" : emoji, { fontSize: "15px" }).setOrigin(0.5);
    container.add([g, weaponGfx, icon]);

    // Soporte táctil y de clic directo para recoger
    container.setSize(48, 48);
    container.setInteractive({ useHandCursor: true });
    container.on("pointerdown", () => {
      this.tryInteract(id);
    });

    // Animación suave de flotación
    this.tweens.add({
      targets: container,
      y: item.y - 5,
      duration: 900 + Math.random() * 250,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const vi: VItem = {
      id, container, g, weaponGfx, icon, itemType: item.itemType, active: item.active,
      x: item.x, y: item.y
    };
    this.items.set(id, vi);

    item.onChange(() => {
      container.setVisible(item.active);
      vi.active = item.active;
    });
  }

  private drawLootGraphic(wg: Phaser.GameObjects.Graphics, type: string, _color: number) {
    wg.clear();
    // Armas inclinadas a -15° (-0.26 radianes) exactamente como Suroi.io
    if (type === "SHOTGUN") {
      wg.rotation = -0.26;
      wg.fillStyle(0x92400e, 1); // Culata madera
      wg.fillRect(-15, -3, 8, 6);
      wg.fillStyle(0x1e293b, 1); // Recámara
      wg.fillRect(-7, -4, 9, 8);
      wg.fillStyle(0x475569, 1); // Cañones dobles
      wg.fillRect(2, -4, 14, 3.5);
      wg.fillRect(2, 0.5, 14, 3.5);
      wg.fillStyle(0xd97706, 1); // Agarre bomba
      wg.fillRect(4, -5, 6, 10);
    } else if (type === "SNIPER") {
      wg.rotation = -0.26;
      wg.fillStyle(0x1e293b, 1); // Culata
      wg.fillRect(-17, -2.5, 8, 5);
      wg.fillStyle(0x0f172a, 1); // Cuerpo
      wg.fillRect(-9, -3.5, 9, 7);
      wg.fillStyle(0x334155, 1); // Cañón largo
      wg.fillRect(0, -2, 21, 4);
      wg.fillStyle(0x06b6d4, 1); // Mira telescópica
      wg.fillRect(-5, -8, 13, 3.5);
      wg.fillStyle(0x38bdf8, 1); // Lente
      wg.fillCircle(8, -6.25, 2);
    } else if (type === "GRENADE") {
      wg.rotation = -0.15;
      wg.fillStyle(0x3f6212, 1);
      wg.fillRoundedRect(-8, -9, 16, 18, 5);
      wg.lineStyle(1.5, 0x65a30d, 0.9);
      wg.strokeRoundedRect(-8, -9, 16, 18, 5);
      wg.fillStyle(0x64748b, 1);
      wg.fillRect(-4, -13, 8, 4);
      wg.lineStyle(1.5, 0x94a3b8, 1);
      wg.strokeCircle(-5, -12, 3);
    } else if (type === "LASER") {
      wg.rotation = -0.26;
      wg.fillStyle(0x0f172a, 1);
      wg.fillRect(-13, -3, 9, 6);
      wg.fillStyle(0x1e293b, 1);
      wg.fillRect(-4, -4, 11, 8);
      wg.fillStyle(0x10b981, 1); // Núcleo energía
      wg.fillRect(7, -2.5, 9, 5);
      wg.fillStyle(0x34d399, 1);
      wg.fillCircle(16, 0, 2);
    }
  }

  private tryInteract(specificItemId?: string) {
    const me = this.players.get(this.myId);
    if (!me || me.isGhost) return;

    let targetItem = this.nearestItem;
    if (specificItemId && this.items.has(specificItemId)) {
      const it = this.items.get(specificItemId)!;
      if (it.active && Math.hypot(me.container.x - it.x, me.container.y - it.y) <= 85) {
        targetItem = it;
      }
    }

    if (!targetItem || !targetItem.active) return;

    this.net.sendInteract(targetItem.id);
    soundManager.playPickup();
    this.createSparksFX(targetItem.x, targetItem.y, 0x10b981);
    this.showDamageText(targetItem.x, targetItem.y - 14, `+${targetItem.itemType}`, "#34d399");
  }

  private createWaterSplashFX(x: number, y: number) {
    if (!this.isInCameraView(x, y, 60)) return;
    const splash = this.add.graphics().setDepth(21).setPosition(x, y);
    splash.lineStyle(2, 0x7dd3fc, 0.85);
    splash.strokeCircle(0, 0, 8);

    this.tweens.add({
      targets: splash,
      scaleX: 2.2,
      scaleY: 2.2,
      alpha: 0,
      duration: 320,
      onComplete: () => splash.destroy(),
    });

    for (let i = 0; i < 3; i++) {
      const drop = this.add.graphics().setDepth(22).setPosition(x, y);
      drop.fillStyle(0x38bdf8, 0.9);
      drop.fillCircle(0, 0, 2);
      const a = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 25;
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(a) * spd,
        y: y + Math.sin(a) * spd,
        alpha: 0,
        duration: 220,
        onComplete: () => drop.destroy(),
      });
    }
  }

  private createDustPuffFX(x: number, y: number) {
    if (!this.isInCameraView(x, y, 60)) return;
    const dust = this.add.graphics().setDepth(15).setPosition(x, y);
    dust.fillStyle(0x785532, 0.35);
    dust.fillCircle(0, 0, 4);

    this.tweens.add({
      targets: dust,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 260,
      onComplete: () => dust.destroy(),
    });
  }

  /* ── Personajes Gatos (Battle Cats) ──────────────────────── */
  private createPlayer(id: string, p: Player) {
    const isMe = id === this.myId;
    const px = typeof p.x === "number" && p.x !== 0 ? p.x : 2400;
    const py = typeof p.y === "number" && p.y !== 0 ? p.y : 2400;

    const container = this.add.container(px, py).setDepth(60);
    const uiContainer = this.add.container(px, py).setDepth(65);

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

    const reloadBarGfx = this.add.graphics();
    const leftHandGfx = this.add.graphics();
    const rightHandGfx = this.add.graphics();

    // El contenedor de visuales del gato rota con la dirección de apuntado (cuerpo + manos + arma)
    container.add([bodyGfx, earsGfx, faceGfx, aimGfx, leftHandGfx, rightHandGfx]);

    // El contenedor de interfaz de usuario SOBRE EL PERSONAJE (HUD Billboard)
    // NUNCA rota, siempre permanece horizontal arriba del personaje (y = -42px)
    uiContainer.add([hpBg, hpFill, shdFill, label, buffIcon, emoteGfx, reloadBarGfx]);
    uiContainer.setRotation(0);

    const vp: VPlayer = {
      container, uiContainer, bodyGfx, earsGfx, faceGfx, aimGfx, leftHandGfx, rightHandGfx,
      punchAlternator: 0,
      hpBg, hpFill, shdFill, label, buffIcon,
      reloadBarGfx, emoteGfx, emoteText,
      tx: px, ty: py, tr: p.rotation || 0,
      hp: p.hp ?? 100, maxHp: p.maxHp ?? 100,
      shield: p.shield ?? 0, maxShield: p.maxShield ?? 50,
      equippedWeapon: p.equippedWeapon || "LASER",
      ammo: p.ammo ?? 12, maxAmmo: p.maxAmmo ?? 12,
      reserveAmmo: p.reserveAmmo ?? 24,
      isReloading: !!p.isReloading,
      reloadTimer: p.reloadTimer ?? 0,
      maxReloadTimer: p.maxReloadTimer ?? 2.0,
      dashCooldown: p.dashCooldown ?? 0,
      isRolling: false,
      isGhost: !!p.isGhost, isHidden: !!p.isHidden,
      isMe, catColor: p.catColor || 0,
      name: p.name || "Gato",
      lastGhost: !!p.isGhost,
      lastHpRatio: 1,
      lastShdRatio: 0,
      lastAimRot: p.rotation || 0,
      lastBuff: "",
      lastWeapon: "",
    };


    this.drawCat(vp);
    this.redrawHp(vp, 1, 0);
    this.players.set(id, vp);

    if (isMe) {
      this.cameras.main.setScroll(px - this.scale.width / 2, py - this.scale.height / 2);
      this.camTargetDummy.setPosition(px, py);
      this.camTarget.x = px;
      this.camTarget.y = py;
      this.cameras.main.startFollow(this.camTargetDummy, true, 0.12, 0.12);
    }
  }

  private spawnGhostTrail(v: VPlayer, tintColor?: number) {
    const shadow = this.add.graphics().setDepth(55).setPosition(v.container.x, v.container.y);
    shadow.fillStyle(tintColor ?? (v.isGhost ? 0x38bdf8 : 0x10b981), 0.45);
    shadow.fillCircle(0, 0, 22);
    shadow.rotation = v.container.rotation;

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
    const { bodyGfx, earsGfx, faceGfx, aimGfx, leftHandGfx, rightHandGfx, isGhost, catColor } = v;

    bodyGfx.clear();
    earsGfx.clear();
    faceGfx.clear();

    if (isGhost) {
      bodyGfx.fillStyle(0x38bdf8, 0.45);
      bodyGfx.fillCircle(0, 0, 22);
      bodyGfx.lineStyle(2, 0xbae6fd, 0.9);
      bodyGfx.strokeCircle(0, 0, 22);

      // Orejas espectrales hacia atrás (-X)
      earsGfx.fillStyle(0x38bdf8, 0.55);
      earsGfx.fillTriangle(-8, -14, -20, -22, -2, -18);
      earsGfx.fillTriangle(-8, 14, -20, 22, -2, 18);

      // Ojos espectrales mirando hacia adelante (+X)
      faceGfx.fillStyle(0xffffff, 0.9);
      faceGfx.fillCircle(6, -6, 4);
      faceGfx.fillCircle(6, 6, 4);
      faceGfx.fillStyle(0x0284c7, 1);
      faceGfx.fillCircle(7, -6, 2);
      faceGfx.fillCircle(7, 6, 2);

      aimGfx.clear();
      leftHandGfx.clear();
      rightHandGfx.clear();
      return;
    }

    const colorTable = [
      { main: 0x10b981, inner: 0x6ee7b7, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xef4444, inner: 0xfca5a5, earInner: 0xf43f5e, stroke: 0x1e293b },
      { main: 0x8b5cf6, inner: 0xc4b5fd, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xf97316, inner: 0xfed7aa, earInner: 0xfb7185, stroke: 0x1e293b },
      { main: 0x06b6d4, inner: 0x67e8f9, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xeab308, inner: 0xfef08a, earInner: 0xf43f5e, stroke: 0x1e293b },
    ];

    const c = colorTable[catColor % colorTable.length];

    // Aura suave exterior
    bodyGfx.fillStyle(c.main, 0.15);
    bodyGfx.fillCircle(0, 0, 27);

    // Orejas felinas hacia atrás/laterales (-X, ±Y) con contorno oscuro Suroi
    earsGfx.fillStyle(c.main, 1);
    earsGfx.fillTriangle(-6, -13, -19, -23, 2, -18);
    earsGfx.fillTriangle(-6, 13, -19, 23, 2, 18);
    earsGfx.lineStyle(2.2, 0x1e293b, 1);
    earsGfx.strokeTriangle(-6, -13, -19, -23, 2, -18);
    earsGfx.strokeTriangle(-6, 13, -19, 23, 2, 18);

    // Interior rosado de las orejas
    earsGfx.fillStyle(c.earInner, 1);
    earsGfx.fillTriangle(-7, -14, -17, -21, 0, -17);
    earsGfx.fillTriangle(-7, 14, -17, 21, 0, 17);

    // Cuerpo circular del gato con contorno oscuro de 2.5px estilo Suroi
    bodyGfx.fillStyle(c.main, 1);
    bodyGfx.fillCircle(0, 0, 20);
    bodyGfx.lineStyle(2.5, 0x1e293b, 1);
    bodyGfx.strokeCircle(0, 0, 20);

    // Ojos felinos mirando hacia adelante (+X)
    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillEllipse(5, -6, 6, 4.5);
    faceGfx.fillEllipse(5, 6, 6, 4.5);
    faceGfx.lineStyle(1, 0x1e293b, 0.5);
    faceGfx.strokeEllipse(5, -6, 6, 4.5);
    faceGfx.strokeEllipse(5, 6, 6, 4.5);

    // Pupilas
    faceGfx.fillStyle(0x0f172a, 1);
    faceGfx.fillCircle(6, -6, 2.8);
    faceGfx.fillCircle(6, 6, 2.8);

    // Brillos de ojos
    faceGfx.fillStyle(0xffffff, 1);
    faceGfx.fillCircle(7, -7, 1.2);
    faceGfx.fillCircle(7, 5, 1.2);

    // Naricita rosada al frente
    faceGfx.fillStyle(0xf472b6, 1);
    faceGfx.fillTriangle(13, 0, 9, -2.5, 9, 2.5);

    // Bigotes laterales
    faceGfx.lineStyle(1.5, 0xffffff, 0.9);
    faceGfx.moveTo(4, -11); faceGfx.lineTo(1, -22);
    faceGfx.moveTo(8, -10); faceGfx.lineTo(7, -22);
    faceGfx.moveTo(4, 11);  faceGfx.lineTo(1, 22);
    faceGfx.moveTo(8, 10);  faceGfx.lineTo(7, 22);
    faceGfx.strokePath();

    this.redrawAim(v, true);
  }

  private redrawAim(v: VPlayer, forceRedraw = false) {
    if (!forceRedraw && v.equippedWeapon === v.lastWeapon && v.aimGfx.visible) return;
    v.lastWeapon = v.equippedWeapon;

    const { aimGfx, leftHandGfx, rightHandGfx, isGhost, equippedWeapon, catColor } = v;
    aimGfx.clear();
    leftHandGfx.clear();
    rightHandGfx.clear();

    if (isGhost) {
      aimGfx.setVisible(false);
      leftHandGfx.setVisible(false);
      rightHandGfx.setVisible(false);
      return;
    }

    aimGfx.setVisible(true);
    leftHandGfx.setVisible(true);
    rightHandGfx.setVisible(true);

    const colorTable = [
      { main: 0x10b981, inner: 0x6ee7b7, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xef4444, inner: 0xfca5a5, earInner: 0xf43f5e, stroke: 0x1e293b },
      { main: 0x8b5cf6, inner: 0xc4b5fd, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xf97316, inner: 0xfed7aa, earInner: 0xfb7185, stroke: 0x1e293b },
      { main: 0x06b6d4, inner: 0x67e8f9, earInner: 0xf472b6, stroke: 0x1e293b },
      { main: 0xeab308, inner: 0xfef08a, earInner: 0xf43f5e, stroke: 0x1e293b },
    ];
    const c = colorTable[catColor % colorTable.length];

    // Posiciones relativas de las manos según el arma empuñada
    let lx = 16, ly = -10;
    let rx = 16, ry = 10;

    if (equippedWeapon === "SHOTGUN") {
      // Escopeta táctica estilo Suroi
      aimGfx.fillStyle(0x1e293b, 1);
      aimGfx.fillRect(8, -4, 20, 8);
      aimGfx.lineStyle(2, 0x0f172a, 1);
      aimGfx.strokeRect(8, -4, 20, 8);

      aimGfx.fillStyle(0x334155, 1);
      aimGfx.fillRect(20, -3.5, 12, 3);
      aimGfx.fillRect(20, 0.5, 12, 3);
      aimGfx.lineStyle(1.5, 0x0f172a, 1);
      aimGfx.strokeRect(20, -3.5, 12, 3);
      aimGfx.strokeRect(20, 0.5, 12, 3);

      // Guardamanos de madera bombeable
      aimGfx.fillStyle(0x854d0e, 1);
      aimGfx.fillRoundedRect(17, -4.5, 8, 9, 2);
      aimGfx.lineStyle(1.5, 0x451a03, 1);
      aimGfx.strokeRoundedRect(17, -4.5, 8, 9, 2);

      rx = 11; ry = 6.5;
      lx = 21.5; ly = 0;

    } else if (equippedWeapon === "SNIPER") {
      // Rifle francotirador de precisión (Largo alcance)
      aimGfx.fillStyle(0x0f172a, 1);
      aimGfx.fillRect(6, -3, 24, 6);
      aimGfx.lineStyle(2, 0x020617, 1);
      aimGfx.strokeRect(6, -3, 24, 6);

      aimGfx.fillStyle(0x06b6d4, 1);
      aimGfx.fillRect(24, -2, 17, 4);
      aimGfx.lineStyle(1.5, 0x083344, 1);
      aimGfx.strokeRect(24, -2, 17, 4);

      aimGfx.fillStyle(0x1e293b, 1);
      aimGfx.fillRect(41, -3, 4, 6);

      // Mira telescópica con reflejo
      aimGfx.fillStyle(0x1e293b, 1);
      aimGfx.fillRect(10, -8, 14, 4);
      aimGfx.lineStyle(1.5, 0x020617, 1);
      aimGfx.strokeRect(10, -8, 14, 4);
      aimGfx.fillStyle(0x38bdf8, 1);
      aimGfx.fillRect(23, -7.5, 2, 3);
      aimGfx.fillRect(9, -7.5, 2, 3);

      rx = 11; ry = 6.5;
      lx = 26; ly = -1.5;

    } else if (equippedWeapon === "GRENADE") {
      // Granada táctica fragmentaria
      aimGfx.fillStyle(0x365314, 1);
      aimGfx.fillCircle(18, 5, 7);
      aimGfx.lineStyle(2, 0x14532d, 1);
      aimGfx.strokeCircle(18, 5, 7);

      aimGfx.lineStyle(1.5, 0x4d7c0f, 1);
      aimGfx.lineBetween(14, 5, 22, 5);
      aimGfx.lineBetween(18, 1, 18, 9);

      aimGfx.fillStyle(0x94a3b8, 1);
      aimGfx.fillRect(13, 2, 4, 3);
      aimGfx.lineStyle(1.5, 0xfacc15, 1);
      aimGfx.strokeCircle(12, 1, 3);

      rx = 17; ry = 6;
      lx = 13; ly = -12;

    } else if (equippedWeapon === "MELEE") {
      // Garras felinas afiladas listas para el combate
      rx = 18; ry = 13;
      lx = 18; ly = -13;

      // Destellos de garras
      aimGfx.lineStyle(2, 0xffffff, 0.85);
      aimGfx.lineBetween(rx + 5, ry - 3, rx + 10, ry - 5);
      aimGfx.lineBetween(rx + 6, ry, rx + 12, ry);
      aimGfx.lineBetween(rx + 5, ry + 3, rx + 10, ry + 5);

      aimGfx.lineBetween(lx + 5, ly - 3, lx + 10, ly - 5);
      aimGfx.lineBetween(lx + 6, ly, lx + 12, ry ? -12 : -12);
      aimGfx.lineBetween(lx + 5, ly + 3, lx + 10, ly - 1);

    } else {
      // LASER / Pistola táctica estándar Suroi
      aimGfx.fillStyle(0x1e293b, 1);
      aimGfx.fillRect(9, -3.5, 17, 7);
      aimGfx.lineStyle(2, 0x0f172a, 1);
      aimGfx.strokeRect(9, -3.5, 17, 7);

      aimGfx.fillStyle(0x334155, 1);
      aimGfx.fillRect(14, -2.5, 14, 5);
      aimGfx.lineStyle(1.5, 0x10b981, 1);
      aimGfx.lineBetween(12, 0, 24, 0);

      aimGfx.fillStyle(0x10b981, 1);
      aimGfx.fillCircle(27, 0, 2);

      rx = 12; ry = 6.5;
      lx = 17; ly = -4;
    }

    // Dibujar las Manos / Garras circulares estilo Suroi con borde oscuro (r = 6.2px)
    const drawPaw = (handGfx: Phaser.GameObjects.Graphics) => {
      handGfx.clear();
      handGfx.fillStyle(c.main, 1);
      handGfx.fillCircle(0, 0, 6.2);
      handGfx.lineStyle(2, 0x1e293b, 1);
      handGfx.strokeCircle(0, 0, 6.2);

      // Almohadilla plantar rosada central
      handGfx.fillStyle(c.earInner, 0.95);
      handGfx.fillCircle(0, 0, 2.8);

      // 3 deditos
      handGfx.fillCircle(3.2, -2.5, 1.2);
      handGfx.fillCircle(4.2, 0, 1.2);
      handGfx.fillCircle(3.2, 2.5, 1.2);
    };

    drawPaw(leftHandGfx);
    leftHandGfx.setData("baseX", lx);
    leftHandGfx.setData("baseY", ly);
    leftHandGfx.setPosition(lx, ly);

    drawPaw(rightHandGfx);
    rightHandGfx.setData("baseX", rx);
    rightHandGfx.setData("baseY", ry);
    rightHandGfx.setPosition(rx, ry);
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
    v.ammo = p.ammo ?? v.ammo ?? 12;
    v.maxAmmo = p.maxAmmo ?? v.maxAmmo ?? 12;
    v.reserveAmmo = p.reserveAmmo ?? v.reserveAmmo ?? 24;
    v.isReloading = !!p.isReloading;
    v.reloadTimer = p.reloadTimer ?? 0;
    v.maxReloadTimer = p.maxReloadTimer ?? 2.0;
    v.dashCooldown = p.dashCooldown ?? v.dashCooldown ?? 0;

    // Barra de progreso de recarga overhead
    v.reloadBarGfx.clear();
    if (v.isReloading && v.maxReloadTimer > 0 && !v.isGhost) {
      const reloadPct = Math.max(0, Math.min(1, 1 - (v.reloadTimer / v.maxReloadTimer)));
      v.reloadBarGfx.fillStyle(0x020617, 0.85);
      v.reloadBarGfx.fillRoundedRect(-22, -62, 44, 5, 2);
      v.reloadBarGfx.fillStyle(0xfbbf24, 1);
      v.reloadBarGfx.fillRoundedRect(-21, -61, 42 * reloadPct, 3, 2);
    }

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
      v.uiContainer.setVisible(!v.isHidden);
    } else {
      const alphaVal = v.isHidden && !v.isGhost ? 0.5 : (v.isGhost ? 0.5 : 1);
      v.container.setAlpha(alphaVal);
      v.uiContainer.setAlpha(alphaVal);
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
        v.uiContainer.setAlpha(0.7);
      } else {
        v.hpBg.setVisible(true);
        v.hpFill.setVisible(true);
        v.shdFill.setVisible(true);
        v.label.setText(v.isMe ? "TÚ 🐾" : v.name);
        v.container.setAlpha(1);
        v.uiContainer.setAlpha(1);
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
        ammo: v.ammo,
        maxAmmo: v.maxAmmo,
        reserveAmmo: v.reserveAmmo,
        isReloading: v.isReloading,
        reloadTimer: v.reloadTimer,
        maxReloadTimer: v.maxReloadTimer,
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
    v.uiContainer.destroy();
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

    this.projs.set(id, {
      g,
      trail,
      tx: p.x || 0,
      ty: p.y || 0,
      vx: p.vx || 0,
      vy: p.vy || 0,
      projType: type,
      targetX: p.targetX || 0,
      targetY: p.targetY || 0,
      isArmed: !!p.isArmed,
      blinkTimer: 0,
    });
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
    if (!this.isInCameraView(x, y, 80)) return;
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
    if (!this.isInCameraView(x, y, 80)) return;
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

  public showGraphicClawSlash(x: number, y: number, angle: number) {
    soundManager.playClawSlash();
    this.cameras.main.shake(70, 0.006);

    // Contenedor rotado en la dirección del zarpazo
    const slashCont = this.add.container(x, y).setDepth(85).setRotation(angle);
    const slashGfx = this.add.graphics();
    slashCont.add(slashGfx);

    // 3 marcas de garra felina afiladas y curvadas (arañazo gráfico)
    const offsets = [-14, 0, 14];
    offsets.forEach((offY, idx) => {
      const len = idx === 1 ? 52 : 42;
      const startX = -len * 0.5;
      const endX = len * 0.5;

      // Resplandor exterior carmesí / sangre felina
      slashGfx.lineStyle(5, 0xef4444, 0.9);
      slashGfx.beginPath();
      slashGfx.moveTo(startX, offY - 6);
      slashGfx.lineTo(0, offY);
      slashGfx.lineTo(endX, offY + 6);
      slashGfx.strokePath();

      // Centro ardiente afilado amarillo relámpago
      slashGfx.lineStyle(2, 0xfef08a, 1);
      slashGfx.beginPath();
      slashGfx.moveTo(startX + 3, offY - 6);
      slashGfx.lineTo(0, offY);
      slashGfx.lineTo(endX - 3, offY + 6);
      slashGfx.strokePath();
    });

    slashCont.setScale(0.3, 0.3);
    slashCont.setAlpha(1);

    this.tweens.add({
      targets: slashCont,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0,
      duration: 250,
      ease: "Quad.easeOut",
      onComplete: () => slashCont.destroy(),
    });

    // Salpicaduras de arañazo (chispas y gotas rojas)
    for (let i = 0; i < 8; i++) {
      const sp = this.add.graphics().setDepth(86).setPosition(x, y);
      const col = i % 2 === 0 ? 0xfbbf24 : 0xef4444;
      sp.fillStyle(col, 1);
      sp.fillCircle(0, 0, Math.random() * 2.5 + 1.5);

      const pAngle = angle + (Math.random() - 0.5) * 1.3;
      const pDist = 20 + Math.random() * 45;
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(pAngle) * pDist,
        y: y + Math.sin(pAngle) * pDist,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 220 + Math.random() * 100,
        ease: "Quad.easeOut",
        onComplete: () => sp.destroy(),
      });
    }
  }

  private createExplosionFX(x: number, y: number, isGrenade = false, outerR = 140, innerR = 70) {
    if (!this.isInCameraView(x, y, 160)) return;
    if (isGrenade) {
      // Explosión de Granada con circunferencia el doble de grande y 2 zonas
      // Zona interna: fuego blanco y núcleo amarillo cegador (100 dmg)
      const innerGfx = this.add.graphics().setDepth(92).setPosition(x, y);
      innerGfx.fillStyle(0xfef08a, 0.95);
      innerGfx.fillCircle(0, 0, 16);
      innerGfx.lineStyle(4, 0xfacc15, 1);
      innerGfx.strokeCircle(0, 0, 16);

      this.tweens.add({
        targets: innerGfx,
        scaleX: Math.max(2, innerR / 16),
        scaleY: Math.max(2, innerR / 16),
        alpha: 0,
        duration: 500,
        ease: "Cubic.easeOut",
        onComplete: () => innerGfx.destroy(),
      });

      // Zona externa: onda expansiva masiva el doble de grande (70 dmg)
      const outerGfx = this.add.graphics().setDepth(91).setPosition(x, y);
      outerGfx.lineStyle(6, 0xef4444, 0.95);
      outerGfx.strokeCircle(0, 0, 20);

      this.tweens.add({
        targets: outerGfx,
        scaleX: Math.max(3, outerR / 20),
        scaleY: Math.max(3, outerR / 20),
        alpha: 0,
        duration: 650,
        ease: "Quad.easeOut",
        onComplete: () => outerGfx.destroy(),
      });

      // Ráfaga masiva de fuego y humo
      for (let i = 0; i < 20; i++) {
        const p = this.add.graphics().setDepth(93).setPosition(x, y);
        const col = i % 3 === 0 ? 0xffffff : i % 2 === 0 ? 0xfacc15 : 0xef4444;
        p.fillStyle(col, 1);
        p.fillCircle(0, 0, Math.random() * 4 + 2);

        const a = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * (outerR * 0.85);
        this.tweens.add({
          targets: p,
          x: x + Math.cos(a) * dist,
          y: y + Math.sin(a) * dist,
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          duration: 400 + Math.random() * 250,
          onComplete: () => p.destroy(),
        });
      }
      return;
    }

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

      // Rotación 0ms ultra reactiva (Responsive Rotation estilo Suroi)
      me.tr = rot;
      if (!me.isRolling) {
        me.container.rotation = rot;
      }

      if (typeof me.dashCooldown === "number" && me.dashCooldown > 0) {
        me.dashCooldown = Math.max(0, me.dashCooldown - delta / 1000);
      }

      if (this.localShootCooldown > 0) {
        this.localShootCooldown = Math.max(0, this.localShootCooldown - delta / 1000);
      }

      // Auto-Disparo Continuo y Fluido al sostener clic izquierdo presionado (Suroi Auto-Fire)
      if (
        this.input.activePointer.isDown &&
        this.input.activePointer.leftButtonDown() &&
        !me.isGhost &&
        this.localShootCooldown <= 0
      ) {
        this.executeLocalShoot(me);
      }

      const mag = Math.hypot(dx, dy);
      if (mag > 0) {
        const ndx = dx / mag;
        const ndy = dy / mag;
        let baseSpeed = isGhost ? 280 : 220;
        if (!isGhost && me.equippedWeapon === "MELEE") baseSpeed *= 1.15; // +15% de velocidad al usar las garras felinas
        if (me.lastBuff === "SPEED") baseSpeed *= 1.4;

        // Fricción de agua si camina por el río (0.75x velocidad estilo Suroi)
        const inRiver = !isGhost && this.checkInRiver(me.container.x, me.container.y);
        if (inRiver) baseSpeed *= 0.75;

        const dtSec = Math.min(0.04, delta / 1000);
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

        me.container.x = Math.max(30, Math.min(4800 - 30, nextX));
        me.container.y = Math.max(30, Math.min(4800 - 30, nextY));

        // Partículas de pasos y chapoteo de agua
        const stepDist = Math.hypot(me.container.x - this.lastPlayerPos.x, me.container.y - this.lastPlayerPos.y);
        this.lastFootstepDist += stepDist;
        this.lastPlayerPos.x = me.container.x;
        this.lastPlayerPos.y = me.container.y;

        if (this.lastFootstepDist >= 26) {
          this.lastFootstepDist = 0;
          if (inRiver) {
            this.createWaterSplashFX(me.container.x, me.container.y);
            soundManager.playWaterSplash();
          } else {
            this.createDustPuffFX(me.container.x, me.container.y);
          }
        }
      }

      // Cámara Dinámica con Anticipación de Ratón (Suroi Mouse Look-Ahead)
      const mouseDist = Phaser.Math.Distance.Between(me.container.x, me.container.y, wp.x, wp.y);
      const isSniper = me.equippedWeapon === "SNIPER";
      const maxLead = isSniper ? 180 : 105;
      const leadRatio = isSniper ? 0.35 : 0.24;
      const leadDist = Math.min(maxLead, mouseDist * leadRatio);
      const desiredCamX = me.container.x + Math.cos(rot) * leadDist;
      const desiredCamY = me.container.y + Math.sin(rot) * leadDist;

      this.camTarget.x = Phaser.Math.Linear(this.camTarget.x, desiredCamX, 0.14);
      this.camTarget.y = Phaser.Math.Linear(this.camTarget.y, desiredCamY, 0.14);
      this.camTargetDummy.setPosition(this.camTarget.x, this.camTarget.y);

      // Renderizar Retícula (Crosshair) y Arco de Apuntado si NO es fantasma
      this.drawAimArcAndCrosshair(me, wp.x, wp.y);

      // Enviar movimiento al servidor a 60 FPS con posición predicha validada
      const rotDiff = Math.abs(rot - this.lastSentRot);
      if (
        dx !== this.lastSentDx ||
        dy !== this.lastSentDy ||
        rotDiff > 0.02 ||
        time - this.lastMoveSendTime >= 16
      ) {
        this.net.sendMove(dx, dy, rot, me.container.x, me.container.y);
        this.lastSentDx = dx;
        this.lastSentDy = dy;
        this.lastSentRot = rot;
        this.lastMoveSendTime = time;
      }

      // Transparencia Dinámica de Árboles (ver el personaje bajo copas frondosas)
      this.obstacles.forEach((obs) => {
        if (obs.obsType === "TREE" && !obs.destroyed) {
          const d = Math.hypot(me.container.x - obs.container.x, me.container.y - obs.container.y);
          if (d < obs.radius + 18) {
            obs.container.setAlpha(0.38);
          } else {
            obs.container.setAlpha(1);
          }
        }
      });

      // Sistema de Detección de Proximidad y Prompt de Loot ([F] Recoger / Cambiar)
      this.updateLootInteraction(me, time);
    }

    // 2. Interpolación Suave (Lerp) para Jugadores Remotos y Frustum Culling
    this.players.forEach(v => {
      const isLocal = v.isMe;
      const inCam = isLocal || this.isInCameraView(v.container.x, v.container.y, 120);

      if (isLocal) {
        v.uiContainer.setPosition(v.container.x, v.container.y);
        v.uiContainer.setRotation(0);

        const dist = Math.hypot(v.container.x - v.tx, v.container.y - v.ty);
        if (dist > 160) {
          v.container.x = v.tx;
          v.container.y = v.ty;
        } else if (dist > 80) {
          v.container.x = Phaser.Math.Linear(v.container.x, v.tx, 0.02);
          v.container.y = Phaser.Math.Linear(v.container.y, v.ty, 0.02);
        }
        this.redrawAim(v);
      } else {
        // Interpolación física para mantener coordenadas sincronizadas
        v.container.x = Phaser.Math.Linear(v.container.x, v.tx, 0.38);
        v.container.y = Phaser.Math.Linear(v.container.y, v.ty, 0.38);

        const angleDiff = Phaser.Math.Angle.Wrap(v.tr - v.container.rotation);
        v.container.rotation += angleDiff * 0.35;

        if (!inCam) {
          // Fuera de vista de cámara: ocultar y pausar redraws
          if (v.container.visible) v.container.setVisible(false);
          if (v.uiContainer.visible) v.uiContainer.setVisible(false);
        } else {
          // Dentro de vista de cámara: mostrar y sincronizar visuales
          if (!v.container.visible) {
            v.container.setVisible(true);
            this.redrawAim(v, true);
          }
          if (!v.uiContainer.visible) v.uiContainer.setVisible(true);

          v.uiContainer.setPosition(v.container.x, v.container.y);
          v.uiContainer.setRotation(0);
          this.redrawAim(v);
        }
      }
    });

    // 2.1 Interpolación de proyectiles de red con Culling
    const dtSecProj = Math.min(0.04, delta / 1000);
    this.projs.forEach(v => {
      v.g.x += v.vx * dtSecProj;
      v.g.y += v.vy * dtSecProj;
      v.g.x = Phaser.Math.Linear(v.g.x, v.tx, 0.25);
      v.g.y = Phaser.Math.Linear(v.g.y, v.ty, 0.25);

      const inCam = this.isInCameraView(v.g.x, v.g.y, 80);
      if (!inCam) {
        if (v.g.visible) v.g.setVisible(false);
        if (v.trail.visible) {
          v.trail.clear();
          v.trail.setVisible(false);
        }
        return;
      }

      if (!v.g.visible) v.g.setVisible(true);
      if (!v.trail.visible) v.trail.setVisible(true);

      if (v.projType === "GRENADE") {
        // Si está en el suelo (armada o velocidad de vuelo casi nula): titilará 2 segundos antes de explotar
        if (v.isArmed || Math.hypot(v.vx, v.vy) < 15) {
          const prevPhase = Math.floor((v.blinkTimer || 0) / 180);
          v.blinkTimer = (v.blinkTimer || 0) + delta;
          const currPhase = Math.floor(v.blinkTimer / 180);
          const isBlink = currPhase % 2 === 0;
          if (currPhase > prevPhase) {
            soundManager.playGrenadeTick();
          }

          v.trail.clear();
          // Onda de pulso de peligro expansiva en el suelo
          const pulseR = 16 + Math.sin(v.blinkTimer / 60) * 6;
          v.trail.lineStyle(2, isBlink ? 0xef4444 : 0xfacc15, 0.9);
          v.trail.strokeCircle(v.g.x, v.g.y, pulseR);

          // Resplandor de titilado de la granada
          v.g.clear();
          v.g.fillStyle(isBlink ? 0xef4444 : 0x84cc16, 1);
          v.g.fillCircle(0, 0, 9);
          v.g.lineStyle(2, isBlink ? 0xffffff : 0x365314, 1);
          v.g.strokeCircle(0, 0, 9);
          v.g.fillStyle(isBlink ? 0xffffff : 0xfacc15, 1);
          v.g.fillCircle(0, 0, 4);
        }
      }
    });

    // 2.2 Simulación y Frustum Culling del Object Pool de Balas Locales (200 máx)
    const dtSecBullet = Math.min(0.04, delta / 1000);
    const pooledBullets = this.bulletPool.getChildren() as VisualBullet[];
    for (let i = 0; i < pooledBullets.length; i++) {
      const b = pooledBullets[i];
      if (!b.active) continue;

      b.life -= dtSecBullet;
      if (b.life <= 0) {
        b.deactivate();
        continue;
      }

      const prevX = b.x;
      const prevY = b.y;
      b.x += b.vx * dtSecBullet;
      b.y += b.vy * dtSecBullet;

      const inCam = this.isInCameraView(b.x, b.y, 80);
      if (!inCam) {
        if (b.visible) b.setVisible(false);
        if (b.trailGfx.visible) {
          b.trailGfx.clear();
          b.trailGfx.setVisible(false);
        }
      } else {
        if (!b.visible) b.setVisible(true);
        if (!b.trailGfx.visible) b.trailGfx.setVisible(true);

        b.trailGfx.clear();
        b.trailGfx.lineStyle(b.radius * 1.4, b.color, 0.45);
        b.trailGfx.lineBetween(prevX - b.vx * 0.025, prevY - b.vy * 0.025, b.x, b.y);
      }
    }


    // Zona de Tinta Circular Perfecta
    this.drawZone();

    // Minimapa fluido con orografía Suroi
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

  /* ── Detección de Proximidad y Prompt de Loot Estilo Suroi ─────── */
  private updateLootInteraction(me: VPlayer, time: number) {
    if (me.isGhost) {
      this.interactPromptGfx.setVisible(false);
      this.lootBeaconGfx.clear();
      this.nearestItem = null;
      return;
    }

    let closest: VItem | null = null;
    let closestDist = 65;

    this.items.forEach((item) => {
      if (!item.active) return;
      const d = Math.hypot(me.container.x - item.x, me.container.y - item.y);
      if (d < closestDist) {
        closestDist = d;
        closest = item;
      }
    });

    this.nearestItem = closest;

    if (closest) {
      const it: VItem = closest;
      const isGun = ["SHOTGUN", "SNIPER", "GRENADE", "LASER"].includes(it.itemType);
      const isSameGun = isGun && me.equippedWeapon === it.itemType;

      let title = `RECOGER ${it.itemType}`;
      let stats = "Toca [F] para interactuar";

      if (isGun) {
        if (isSameGun) {
          title = `[F] YA EQUIPADO`;
          stats = `${it.itemType} (Munición Máxima)`;
        } else {
          title = `[F] CAMBIAR POR ${it.itemType}`;
          if (it.itemType === "SHOTGUN") stats = "Daño: 15x5 (75) | 2/8 Balas | Cadencia: 1.0s | Recarga: 2.5s";
          else if (it.itemType === "SNIPER") stats = "Daño: 50 | 5/5 Balas | Cadencia: 0.5s | Recarga: 3.0s";
          else if (it.itemType === "GRENADE") stats = "Daño: 100/70 | x3 Granadas | Retardo: 2.0s | Área x2";
          else stats = "Daño: 20 | 12/24 Balas | Cadencia: 0.3s | Recarga: 2.0s";
        }
      } else {
        if (it.itemType === "MEDKIT") { title = "[F] BOTIQUÍN MÉDICO"; stats = "+40 Salud Instantánea"; }
        else if (it.itemType === "SHIELD") { title = "[F] ESCUDO TÁCTICO"; stats = "+50 Escudo Protector"; }
        else if (it.itemType === "SPEED") { title = "[F] POCIÓN DE VELOCIDAD"; stats = "+40% Velocidad x 7s"; }
        else if (it.itemType === "TRIPLE") { title = "[F] DISPARO TRIPLE"; stats = "Disparo en Abanico x 9s"; }
      }

      this.interactTitleText.setText(title);
      this.interactStatsText.setText(stats);
      this.interactPromptGfx.setPosition(it.x, it.y - 42);
      this.interactPromptGfx.setVisible(true);

      // Resplandor de baliza pulsante sobre el arma en el suelo
      this.lootBeaconGfx.clear();
      const beaconRadius = 24 + Math.sin(time / 140) * 5;
      const beaconColor = isGun ? 0xef4444 : 0x10b981;
      this.lootBeaconGfx.lineStyle(2.5, beaconColor, 0.85);
      this.lootBeaconGfx.strokeCircle(it.x, it.y, beaconRadius);
    } else {
      this.interactPromptGfx.setVisible(false);
      this.lootBeaconGfx.clear();
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

    // Arco o abanico de disparo según arma equipada (El alcance coincide exactamente con el límite de las balas)
    const weapon = me.equippedWeapon;
    const px = me.container.x;
    const py = me.container.y;
    const rot = me.tr;

    if (weapon === "SHOTGUN") {
      // Escopeta: Alcance exacto de 310px
      const range = 310;
      const angleHalf = 0.28;
      ag.fillStyle(0xef4444, 0.16);
      ag.lineStyle(2, 0xef4444, 0.7);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();

      // Perdigones proyectados en el arco
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * (0.28 / 2);
        const ex = px + Math.cos(rot + off) * range;
        const ey = py + Math.sin(rot + off) * range;
        ag.lineStyle(1.5, 0xfca5a5, 0.4);
        ag.lineBetween(px, py, ex, ey);
        ag.fillStyle(0xef4444, 0.8);
        ag.fillCircle(ex, ey, 2.5);
      }
    } else if (weapon === "SNIPER") {
      // Sniper: Alcance exacto de 980px con retícula láser de precisión
      const range = 980;
      const endX = px + Math.cos(rot) * range;
      const endY = py + Math.sin(rot) * range;
      ag.lineStyle(2, 0x06b6d4, 0.6);
      ag.lineBetween(px, py, endX, endY);
      ag.fillStyle(0x06b6d4, 0.85);
      ag.fillCircle(endX, endY, 5);
      ag.lineStyle(1.5, 0xffffff, 0.9);
      ag.strokeCircle(endX, endY, 9);
    } else if (weapon === "GRENADE") {
      // Granada: Se dirige y se queda justo donde se apunta con el cursor (clamped a 400px máx)
      const dist = Math.min(400, Math.hypot(wx - px, wy - py));
      const targetX = px + Math.cos(rot) * dist;
      const targetY = py + Math.sin(rot) * dist;

      // Línea de trayectoria
      ag.lineStyle(2, 0x84cc16, 0.55);
      ag.lineBetween(px, py, targetX, targetY);

      // Zona interna de explosión (140px radio - 100 de daño)
      ag.fillStyle(0xef4444, 0.14);
      ag.fillCircle(targetX, targetY, 140);
      ag.lineStyle(2, 0xef4444, 0.7);
      ag.strokeCircle(targetX, targetY, 140);

      // Zona externa de explosión (280px radio - 70 de daño, doble de grande)
      ag.fillStyle(0xf59e0b, 0.07);
      ag.fillCircle(targetX, targetY, 280);
      ag.lineStyle(1.5, 0xf59e0b, 0.45);
      ag.strokeCircle(targetX, targetY, 280);

      // Marcador del punto de caída
      ag.fillStyle(0x84cc16, 0.95);
      ag.fillCircle(targetX, targetY, 6);
    } else if (weapon === "MELEE") {
      // Garras: Alcance exacto de 75px
      const range = 75;
      const angleHalf = 0.55;
      ag.fillStyle(0xfbbf24, 0.22);
      ag.lineStyle(2.5, 0xfbbf24, 0.8);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();
    } else {
      // Pistola Láser: Alcance exacto de 480px
      const range = 480;
      const angleHalf = 0.12;
      ag.fillStyle(0x10b981, 0.15);
      ag.lineStyle(1.5, 0x10b981, 0.6);
      ag.slice(px, py, range, rot - angleHalf, rot + angleHalf, false);
      ag.fillPath();
      ag.strokePath();

      const endX = px + Math.cos(rot) * range;
      const endY = py + Math.sin(rot) * range;
      ag.lineStyle(2, 0x34d399, 0.75);
      ag.lineBetween(px, py, endX, endY);
      ag.fillStyle(0x10b981, 0.9);
      ag.fillCircle(endX, endY, 4);
    }
  }

  /* ── Zona de Tinta Circular Perfecta (Sin esquinas abiertas) ─ */
  private drawZone() {
    if (!this.zoneDirty && Math.abs(this.zone.r - this.lastZoneR) < 0.5) return;
    this.zoneDirty = false;
    this.lastZoneR = this.zone.r;

    const g = this.zoneGfx;
    const { x, y, r } = this.zone;
    g.clear();

    // Suroi-style niebla roja de tormenta tóxica optimizada para 60 FPS
    g.fillStyle(0x881337, 0.45);
    if (y - r > 0) g.fillRect(0, 0, 4800, y - r);
    if (y + r < 4800) g.fillRect(0, y + r, 4800, 4800 - (y + r));
    if (x - r > 0) g.fillRect(0, Math.max(0, y - r), x - r, Math.min(4800, 2 * r));
    if (x + r < 4800) g.fillRect(x + r, Math.max(0, y - r), 4800 - (x + r), Math.min(4800, 2 * r));

    // Anillo suave para cubrir esquinas de la cámara sin sobrecarga de GPU
    const ringThickness = Math.min(600, Math.max(60, 4800 - r));
    g.lineStyle(ringThickness, 0x881337, 0.45);
    g.strokeCircle(x, y, r + ringThickness / 2);

    // Borde de peligro neón
    g.lineStyle(6, 0xef4444, 0.95);
    g.strokeCircle(x, y, r);
    g.lineStyle(2, 0xfca5a5, 0.85);
    g.strokeCircle(x, y, r - 3);
  }

  /* ── Minimapa con Orografía de Isla Suroi.io ───────────────── */
  private drawMinimap() {
    const g = this.minimapGfx;
    g.clear();

    const SIZE = 136;
    const PAD = 20;
    const mx = this.scale.width - SIZE - PAD;
    const my = this.scale.height - SIZE - PAD;
    const sc = SIZE / 4800;

    // 1. Océano del minimapa
    g.fillStyle(0x1a4a7a, 0.9);
    g.fillRoundedRect(mx, my, SIZE, SIZE, 12);
    g.lineStyle(2, 0x10b981, 0.7);
    g.strokeRoundedRect(mx, my, SIZE, SIZE, 12);

    // 2. Playa de arena del minimapa
    g.fillStyle(0xc4a96b, 0.85);
    g.fillRoundedRect(mx + 200 * sc, my + 200 * sc, 4400 * sc, 4400 * sc, 6);

    // 3. Hierba central del minimapa
    g.fillStyle(0x56893b, 0.9);
    g.fillRoundedRect(mx + 360 * sc, my + 360 * sc, 4080 * sc, 4080 * sc, 4);

    // 4. Río del minimapa
    g.lineStyle(4, 0x2869ad, 0.85);
    const riverPts = [
      { x: 2400, y: 0 },
      { x: 2520, y: 900 },
      { x: 2360, y: 1900 },
      { x: 2260, y: 2900 },
      { x: 2580, y: 3900 },
      { x: 2480, y: 4800 },
    ];
    g.beginPath();
    g.moveTo(mx + riverPts[0].x * sc, my + riverPts[0].y * sc);
    for (let i = 1; i < riverPts.length; i++) {
      g.lineTo(mx + riverPts[i].x * sc, my + riverPts[i].y * sc);
    }
    g.strokePath();

    // 5. Círculo de la Zona Segura y Tormenta
    const zx = mx + this.zone.x * sc;
    const zy = my + this.zone.y * sc;
    const zr = Math.max(2, this.zone.r * sc);
    g.lineStyle(2, 0xef4444, 0.9);
    g.strokeCircle(zx, zy, zr);

    // 6. Jugadores en el Minimapa
    this.players.forEach(p => {
      if (p.isGhost) return;
      if (p.isHidden && !p.isMe) return;

      const px = mx + p.container.x * sc;
      const py = my + p.container.y * sc;

      if (p.isMe) {
        // Marcador del jugador local con flecha de orientación
        g.fillStyle(0x10b981, 1);
        g.fillCircle(px, py, 4);
        g.lineStyle(1.5, 0xffffff, 1);
        g.strokeCircle(px, py, 4);

        // Pequeño puntero de dirección
        const rot = p.tr;
        g.lineStyle(2, 0xffffff, 1);
        g.lineBetween(px, py, px + Math.cos(rot) * 7, py + Math.sin(rot) * 7);
      } else {
        g.fillStyle(0xef4444, 0.95);
        g.fillCircle(px, py, 2.5);
      }
    });
  }
}

function emit(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(`${name}-update`, { detail }));
}
