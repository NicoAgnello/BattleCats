import Phaser from "phaser";

/* ─── Sprites Pixel Art de los Gatos ─────────────────────────────
 * Generados fuera del juego con /sprites (python sprites/build.py), que copia
 * a public/sprites/ cada sheet (PNG + JSON formato Aseprite) y un manifest.json
 * con las skins en orden: el índice de la lista es el catColor del jugador.
 * Los sprites miran a +X igual que el contenedor del personaje.
 */

const BASE_URL = "sprites/";

/** 1 pixel del sprite = 3 px del mundo (la cabeza queda con radio ≈ 16px). */
export const CAT_SPRITE_SCALE = 3;

interface AsepriteTag { name: string; from: number; to: number; direction: string }
interface AsepriteMeta { sprite: string; frameTags: AsepriteTag[]; size: { w: number; h: number } }
interface AsepriteFrameData {
  duration?: number;
  sourceSize?: { w: number; h: number };
  anchors?: Record<string, { x: number; y: number }>;
}

let catKeys: string[] = [];
let handKeys: string[] = [];
let ghostKeys: string[] = [];                   // fantasma de cada personaje (al morir), por catColor
let effectKeys: Record<string, string> = {};   // effect_id -> sheet (p.ej. explosion)

/** Cómo se empuña un arma, en pixels del sprite relativos al centro del gato. */
export interface WeaponHold {
  sprite: string | null;           // null = sin arma visible (garras)
  w: number; h: number;
  mount: [number, number] | null;  // dónde cae el pixel (0,0) del arma
  rear: [number, number];          // centro de la mano de atrás (gatillo)
  front: [number, number];         // centro de la mano de adelante (apoyo)
  muzzle: [number, number] | null; // boca del cañón
}
let weaponHolds: Record<string, WeaponHold> = {};
let bulletKeys: Record<string, string> = {};   // weapon_id -> sheet de la bala

interface SpriteManifest {
  cats?: string[];
  hands?: string[];
  weapons?: Record<string, WeaponHold>;
  bullets?: Record<string, string>;
  ghosts?: string[];
  effects?: Record<string, string>;
}

/** Encola el manifest y, cuando llega, las sheets de cada skin. Llamar en preload(). */
export function preloadCatSprites(scene: Phaser.Scene) {
  scene.load.json("cat_manifest", BASE_URL + "manifest.json");
  scene.load.once(
    "filecomplete-json-cat_manifest",
    (_key: string, _type: string, data: SpriteManifest) => {
      catKeys = data?.cats ?? [];
      handKeys = data?.hands ?? [];
      weaponHolds = data?.weapons ?? {};
      bulletKeys = data?.bullets ?? {};
      ghostKeys = data?.ghosts ?? [];
      effectKeys = data?.effects ?? {};
      const weaponKeys = Object.values(weaponHolds).map(h => h.sprite).filter((k): k is string => !!k);
      for (const k of [...catKeys, ...ghostKeys, ...handKeys, ...weaponKeys, ...Object.values(bulletKeys), ...Object.values(effectKeys)]) {
        scene.load.atlas(k, BASE_URL + k + ".png", BASE_URL + k + ".json");
      }
    },
  );
}

/** Animaciones "<sheet>:<tag>" desde los frameTags del JSON Aseprite. */
function createAsepriteAnims(scene: Phaser.Scene, key: string) {
  const tex = scene.textures.get(key);
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  const meta = (tex.customData as { meta: AsepriteMeta }).meta;
  for (const tag of meta.frameTags) {
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = tag.from; i <= tag.to; i++) {
      const name = `${meta.sprite} ${i}.ase`;
      const data = tex.get(name).customData as AsepriteFrameData;
      frames.push({ key, frame: name, duration: data.duration ?? 100 });
    }
    if (tag.direction === "reverse") frames.reverse();
    scene.anims.create({
      key: `${key}:${tag.name}`,
      frames,
      repeat: -1,
      yoyo: tag.direction === "pingpong",
    });
  }
}

/** Filtro nearest (pixel art nítido) + animaciones. Llamar en create(). */
export function createCatAnims(scene: Phaser.Scene) {
  catKeys = catKeys.filter(k => scene.textures.exists(k));
  handKeys = handKeys.filter(k => scene.textures.exists(k));
  ghostKeys = ghostKeys.filter(k => scene.textures.exists(k));
  for (const [id, k] of Object.entries(effectKeys)) {
    if (!scene.textures.exists(k)) delete effectKeys[id];
  }
  for (const [id, h] of Object.entries(weaponHolds)) {
    if (h.sprite && !scene.textures.exists(h.sprite)) delete weaponHolds[id];
  }
  for (const [id, k] of Object.entries(bulletKeys)) {
    if (!scene.textures.exists(k)) delete bulletKeys[id];
  }
  // manos y armas: solo filtro nearest (no tienen animaciones por ahora)
  for (const k of [...handKeys, ...Object.values(weaponHolds).map(h => h.sprite)]) {
    if (k) scene.textures.get(k).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  for (const key of [...catKeys, ...ghostKeys, ...Object.values(bulletKeys), ...Object.values(effectKeys)]) {
    createAsepriteAnims(scene, key);
  }
}

export function hasCatSprites() {
  return catKeys.length > 0;
}

/** Clave de textura para un catColor (o null si no hay sprites cargados). */
export function catSpriteKey(catColor: number): string | null {
  if (!catKeys.length) return null;
  return catKeys[((catColor % catKeys.length) + catKeys.length) % catKeys.length];
}

/** Aplica la skin al sprite: textura, origen en el centro de la cabeza y escala. */
export function applyCatSkin(sprite: Phaser.GameObjects.Sprite, catColor: number) {
  applySkinKey(sprite, catSpriteKey(catColor));
}

export function hasGhostSprites() {
  return ghostKeys.length > 0;
}

/** Fantasma pixel art del personaje (mismo dibujo, en celeste espectral). */
export function applyGhostSkin(sprite: Phaser.GameObjects.Sprite, catColor: number) {
  if (!ghostKeys.length) return;
  applySkinKey(sprite, ghostKeys[((catColor % ghostKeys.length) + ghostKeys.length) % ghostKeys.length]);
}

function applySkinKey(sprite: Phaser.GameObjects.Sprite, key: string | null) {
  if (!key) return;
  if (sprite.texture.key !== key) {
    sprite.setTexture(key, `${key} 0.ase`);
    const first = sprite.frame.customData as AsepriteFrameData;
    const center = first.anchors?.center;
    const size = first.sourceSize ?? { w: sprite.frame.width, h: sprite.frame.height };
    if (center) sprite.setOrigin((center.x + 0.5) / size.w, (center.y + 0.5) / size.h);
    sprite.setScale(CAT_SPRITE_SCALE);
    sprite.anims.stop();
  }
}

/** Reproduce idle o walk según si el gato se está moviendo. */
export function updateCatAnim(sprite: Phaser.GameObjects.Sprite, moving: boolean) {
  const key = sprite.texture.key;
  if (!catKeys.includes(key) && !ghostKeys.includes(key)) return;
  let anim = `${key}:${moving ? "walk" : "idle"}`;
  if (!sprite.scene.anims.exists(anim)) anim = `${key}:idle`;   // el fantasma solo tiene idle
  if (sprite.anims.currentAnim?.key !== anim) sprite.play(anim);
}

/* ─── Armas y manos ────────────────────────────────────────────── */

export function hasWeaponSprites() {
  return handKeys.length > 0 && Object.keys(weaponHolds).length > 0;
}

export function getWeaponHold(weapon: string): WeaponHold | null {
  return weaponHolds[weapon] ?? weaponHolds["LASER"] ?? null;
}

/** Arma: textura + origen tal que en reposo (posición 0,0 del objeto) el arma
 *  quede montada donde corresponde. Así el retroceso (x: -kick → 0) sigue igual. */
export function applyWeaponSprite(img: Phaser.GameObjects.Image, hold: WeaponHold) {
  if (!hold.sprite || !hold.mount) {
    img.setVisible(false);
    return;
  }
  img.setTexture(hold.sprite, `${hold.sprite} 0.ase`);
  // el centro del gato es el CENTRO de su pixel central: la esquina del pixel
  // (mount) queda medio pixel antes
  img.setOrigin((0.5 - hold.mount[0]) / hold.w, (0.5 - hold.mount[1]) / hold.h);
  img.setScale(CAT_SPRITE_SCALE);
  img.setVisible(true);
}

/** Mano: pata (frame 0) o pata con uñas (frame 1, garras), con el pelaje de la skin. */
export function applyHandSprite(img: Phaser.GameObjects.Image, catColor: number, claws: boolean) {
  if (!handKeys.length) return;
  const key = handKeys[((catColor % handKeys.length) + handKeys.length) % handKeys.length];
  img.setTexture(key, `${key} ${claws ? 1 : 0}.ase`);
  const data = img.frame.customData as AsepriteFrameData;
  const c = data.anchors?.center ?? { x: 2, y: 2 };
  const size = data.sourceSize ?? { w: img.frame.width, h: img.frame.height };
  img.setOrigin((c.x + 0.5) / size.w, (c.y + 0.5) / size.h);
  img.setScale(CAT_SPRITE_SCALE);
  img.setVisible(true);
}

/** Posición (centro) de una mano en coordenadas del contenedor del gato. */
export function handPosition(p: [number, number]): [number, number] {
  return [p[0] * CAT_SPRITE_SCALE, p[1] * CAT_SPRITE_SCALE];
}

/** Boca del cañón en coordenadas del contenedor del gato (sin rotar), o null. */
export function muzzleOffset(weapon: string): [number, number] | null {
  const m = weaponHolds[weapon]?.muzzle;
  return m ? [m[0] * CAT_SPRITE_SCALE, m[1] * CAT_SPRITE_SCALE] : null;
}

/* ─── Balas y proyectiles ──────────────────────────────────────── */

/** Sheet de la bala de un arma (LASER / SHOTGUN / SNIPER), o null. */
export function bulletKey(weapon: string): string | null {
  return bulletKeys[weapon] ?? null;
}

/** Sprite de la granada (el mismo del arma) para mostrarla en vuelo. */
export function grenadeKey(): string | null {
  return weaponHolds["GRENADE"]?.sprite ?? null;
}

/** Bala/proyectil pixel art: textura, centrada, escalada y orientada a su dirección. */
export function applyProjectileSprite(sprite: Phaser.GameObjects.Sprite, key: string, angle: number) {
  sprite.setTexture(key, `${key} 0.ase`);
  sprite.setOrigin(0.5, 0.5);
  sprite.setScale(CAT_SPRITE_SCALE);
  sprite.setRotation(angle);
  sprite.clearTint();
  const anim = `${key}:fly`;
  if (sprite.scene.anims.exists(anim)) sprite.play(anim);
  else sprite.anims.stop();
}

/* ─── Efectos ──────────────────────────────────────────────────── */

/** Reproduce un efecto pixel art una sola vez y lo destruye al terminar.
 *  Devuelve el sprite, o null si el efecto no está cargado (para usar el respaldo vectorial). */
export function playEffect(scene: Phaser.Scene, id: string, x: number, y: number, scale: number,
                           depth = 92, randomRotation = true): Phaser.GameObjects.Sprite | null {
  const key = effectKeys[id];
  if (!key) return null;
  const tex = scene.textures.get(key);
  const meta = (tex.customData as { meta: AsepriteMeta }).meta;
  const tag = meta.frameTags[0]?.name;
  if (!tag) return null;
  const fx = scene.add.sprite(x, y, key, `${key} 0.ase`).setOrigin(0.5).setScale(scale).setDepth(depth);
  if (randomRotation) fx.setRotation(Math.floor(Math.random() * 4) * (Math.PI / 2)); // variedad sin deformar pixels
  fx.play({ key: `${key}:${tag}`, repeat: 0 });
  fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
  return fx;
}

/** Efecto pixel art en loop (p.ej. la trampa espectral). null si no está cargado. */
export function makeLoopingEffect(scene: Phaser.Scene, id: string, x: number, y: number, scale: number): Phaser.GameObjects.Sprite | null {
  const key = effectKeys[id];
  if (!key) return null;
  const meta = (scene.textures.get(key).customData as { meta: AsepriteMeta }).meta;
  const tag = meta.frameTags[0]?.name;
  const fx = scene.add.sprite(x, y, key, `${key} 0.ase`).setOrigin(0.5).setScale(scale);
  if (tag) fx.play(`${key}:${tag}`);
  return fx;
}

/** Clave de animación "<sheet>:<tag>" de un efecto (null si no está cargado). */
export function effectAnimKey(scene: Phaser.Scene, id: string): string | null {
  const key = effectKeys[id];
  if (!key) return null;
  const tag = (scene.textures.get(key).customData as { meta: AsepriteMeta }).meta.frameTags[0]?.name;
  return tag ? `${key}:${tag}` : null;
}

/** Reproduce una vez la animación de dash del gato (si la tiene). Devuelve su duración en ms. */
export function playCatDash(sprite: Phaser.GameObjects.Sprite): number {
  const anim = `${sprite.texture.key}:dash`;
  if (!catKeys.includes(sprite.texture.key) || !sprite.scene.anims.exists(anim)) return 0;
  sprite.play({ key: anim, repeat: 0 });
  return sprite.anims.currentAnim?.duration ?? 220;
}
