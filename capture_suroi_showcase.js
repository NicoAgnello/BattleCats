const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require(path.join(__dirname, 'server', 'node_modules', 'ws'));

const ARTIFACT_DIR = 'C:\\Users\\lucam\\.gemini\\antigravity-ide\\brain\\58af40b1-2bb0-427f-9c8b-72a6f493b83b';
const FRAMES_DIR = path.join(ARTIFACT_DIR, 'scratch', 'showcase_frames');

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
} else {
  fs.readdirSync(FRAMES_DIR).forEach(f => {
    try { fs.unlinkSync(path.join(FRAMES_DIR, f)); } catch {}
  });
}

function getChromeTab() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const tabs = JSON.parse(data);
        const tab = tabs.find(t => t.url.includes('localhost:3000'));
        if (tab) resolve(tab);
        else reject(new Error('localhost:3000 tab not found'));
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          cb(msg);
        } else if (msg.method && this.eventHandlers.has(msg.method)) {
          this.eventHandlers.get(msg.method)(msg.params);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, res => {
        if (res.error) reject(new Error(res.error.message));
        else resolve(res.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🎮 Grabando sesión de showcase de estética Suroi.io en Battle Cats...');
  const tab = await getChromeTab();
  const cdp = new CDPClient(tab.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.bringToFront');

  // Recargar y entrar limpios
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
  await sleep(1500);

  // Iniciar partida
  const clickRes = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('input');
        if (input) {
          input.value = "SUROI_CAT";
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const btn = document.querySelector('button[type="submit"]') ||
                    Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('COMBATE') || b.textContent.includes('BATALLA')));
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.textContent.trim() };
        }
        return { clicked: false };
      })()
    `,
    returnByValue: true
  });
  console.log('Botón presionado:', clickRes.result.value);
  await sleep(3000);

  // Screencast recording
  let frameCount = 0;
  const writePromises = [];
  let capturing = true;

  cdp.on('Page.screencastFrame', async params => {
    if (!capturing) return;
    const currentFrame = frameCount++;
    const frameBuffer = Buffer.from(params.data, 'base64');
    const framePath = path.join(FRAMES_DIR, `frame_${String(currentFrame).padStart(5, '0')}.jpg`);

    writePromises.push(fs.promises.writeFile(framePath, frameBuffer));
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1
  });

  const startTime = Date.now();

  const pressKey = (key, code) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: key, unmodifiedText: key, code, key });
  const releaseKey = (key, code) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  const mouseMove = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const mouseClick = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const midX = 640;
  const midY = 360;

  const switchWeaponUI = async (weaponName) => {
    await cdp.send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new CustomEvent('switch-weapon', { detail: { weapon: '${weaponName}' } }))`
    });
    await sleep(250);
  };

  // 1. Mostrar LASER con dos patas empuñando y apuntando
  console.log('🔫 Demostrando Pistola Láser y manos Suroi...');
  await switchWeaponUI('LASER');

  // Caminar hacia la derecha bordeando el río
  await pressKey('d', 'KeyD');
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI;
    await mouseMove(midX + Math.cos(angle) * 200, midY + Math.sin(angle) * 150);
    if (i % 5 === 0) await mouseClick(midX + Math.cos(angle) * 200, midY + Math.sin(angle) * 150);
    await sleep(60);
  }
  await releaseKey('d', 'KeyD');

  // Captura 1: Vista de Pistola Láser con patas y orilla del río
  const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'suroi_aesthetic_laser_hands.png'), Buffer.from(shot1.data, 'base64'));
  console.log('📸 Captura 1 guardada: suroi_aesthetic_laser_hands.png');

  // 2. Cambiar a ESCOPETA (Shotgun)
  console.log('💥 Demostrando Escopeta Pump-Action y retroceso de manos...');
  await switchWeaponUI('SHOTGUN');

  await pressKey('w', 'KeyW');
  for (let i = 0; i < 15; i++) {
    const aimX = midX + 220;
    const aimY = midY - 60;
    await mouseMove(aimX, aimY);
    if (i % 6 === 0) await mouseClick(aimX, aimY);
    await sleep(70);
  }
  await releaseKey('w', 'KeyW');

  // Captura 2: Escopeta
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'suroi_aesthetic_shotgun_hands.png'), Buffer.from(shot2.data, 'base64'));
  console.log('📸 Captura 2 guardada: suroi_aesthetic_shotgun_hands.png');

  // 3. Cambiar a SNIPER (Francotirador con mira y cámara extendida)
  console.log('🎯 Demostrando Sniper y anticipación de cámara (Mouse Look-Ahead)...');
  await switchWeaponUI('SNIPER');

  // Apuntar lejos para mostrar el mouse look-ahead del Sniper
  for (let i = 0; i < 15; i++) {
    const aimX = midX + 350;
    const aimY = midY + 180;
    await mouseMove(aimX, aimY);
    if (i === 5 || i === 12) await mouseClick(aimX, aimY);
    await sleep(80);
  }

  // Captura 3: Sniper
  const shot3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'suroi_aesthetic_sniper_scope.png'), Buffer.from(shot3.data, 'base64'));
  console.log('📸 Captura 3 guardada: suroi_aesthetic_sniper_scope.png');

  // 4. Cambiar a GARRAS FELINAS (Melee) con +15% velocidad y zarpazos alternados
  console.log('🐾 Demostrando Garras Melee, zarpazos alternados y dash ágil...');
  await switchWeaponUI('MELEE');

  // Correr y golpear con zarpazos
  await pressKey('a', 'KeyA');
  for (let i = 0; i < 12; i++) {
    const aimX = midX - 120;
    const aimY = midY + (i % 2 === 0 ? -40 : 40);
    await mouseMove(aimX, aimY);
    await mouseClick(aimX, aimY);
    await sleep(90);
  }
  await releaseKey('a', 'KeyA');

  // Dash ágil
  await pressKey(' ', 'Space');
  await sleep(50);
  await releaseKey(' ', 'Space');
  await sleep(300);

  // Captura 4: Melee y Garras
  const shot4 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'suroi_aesthetic_melee_claws.png'), Buffer.from(shot4.data, 'base64'));
  console.log('📸 Captura 4 guardada: suroi_aesthetic_melee_claws.png');

  // Detener grabación
  capturing = false;
  await cdp.send('Page.stopScreencast');
  const elapsedSec = (Date.now() - startTime) / 1000;
  console.log(`⏹️ Screencast completado: ${frameCount} cuadros en ${elapsedSec.toFixed(1)}s.`);
  cdp.close();

  await Promise.all(writePromises);
  console.log('💾 Todos los cuadros sincronizados en disco.');

  // Generar WebP animado y MP4 de showcase
  const inputPattern = path.join(FRAMES_DIR, 'frame_%05d.jpg');
  const webpVideoPath = path.join(ARTIFACT_DIR, 'battlecats_suroi_showcase.webp');
  const mp4VideoPath = path.join(ARTIFACT_DIR, 'battlecats_suroi_showcase.mp4');
  const videoFramerate = Math.min(60, Math.max(20, Math.round(frameCount / elapsedSec)));

  try {
    const ffmpegWebpCmd = `ffmpeg -y -framerate ${videoFramerate} -i "${inputPattern}" -vf "scale=960:-1:flags=lanczos" -loop 0 -c:v libwebp_anim -lossless 0 -compression_level 4 -q:v 75 "${webpVideoPath}"`;
    execSync(ffmpegWebpCmd, { stdio: 'ignore' });
    console.log('✅ Video WebP generado:', webpVideoPath);
  } catch (e) {
    console.warn('WebP render warning:', e.message);
  }

  try {
    const ffmpegMp4Cmd = `ffmpeg -y -framerate ${videoFramerate} -i "${inputPattern}" -vf "scale=960:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset fast -crf 20 "${mp4VideoPath}"`;
    execSync(ffmpegMp4Cmd, { stdio: 'ignore' });
    console.log('✅ Video MP4 generado:', mp4VideoPath);
  } catch (e) {
    console.warn('MP4 render warning:', e.message);
  }

  console.log('🎉 ¡Showcase Suroi completado con éxito!');
}

main().catch(err => {
  console.error('Error en showcase:', err);
  process.exit(1);
});
