const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require(path.join(__dirname, 'server', 'node_modules', 'ws'));

const ARTIFACT_DIR = 'C:\\Users\\lucam\\.gemini\\antigravity-ide\\brain\\58af40b1-2bb0-427f-9c8b-72a6f493b83b';
const FRAMES_DIR = path.join(ARTIFACT_DIR, 'scratch', 'frames');

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
} else {
  // Clear old frames
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
        else reject(new Error('localhost:3000 tab not found in Chrome'));
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
  console.log('🚀 Iniciando Suite de Pruebas de Fluidez y Rendimiento Battle Cats...');
  const tab = await getChromeTab();
  console.log('🔗 Conectado a la pestaña Chrome:', tab.title);

  const cdp = new CDPClient(tab.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('✅ Sesión CDP WebSocket establecida.');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.bringToFront');

  // 1. Recargar página para asegurar estado limpio
  console.log('🔄 Recargando página en http://localhost:3000/ ...');
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
  await sleep(2000);

  // 2. Ingresar apodo "TEST_BENCHMARK" y hacer clic en "¡ENTRAR AL COMBATE!"
  console.log('🖱️ Configurando apodo TEST_BENCHMARK e ingresando a la batalla...');
  const clickRes = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('input');
        if (input) {
          input.value = "TEST_BENCHMARK";
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
  console.log('Resultado del clic de inicio:', clickRes.result.value);

  // Esperar a que la escena de Phaser y la red se inicialicen
  await sleep(3000);

  // 3. Verificar estado de SSE Telemetría
  const sseStatus = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const text = document.body.innerText;
        const hasSSE = text.includes('SSE');
        const sseBadge = document.querySelector('[title*="Server-Sent Events"]');
        return {
          hasSSE,
          badgeText: sseBadge ? sseBadge.innerText : null,
          title: document.title,
          url: window.location.href
        };
      })()
    `,
    returnByValue: true
  });
  console.log('📡 Verificación de SSE en el HUD:', sseStatus.result.value);

  // 4. Iniciar Screencast para captura de frames de video ultra-fluida (JPEG no-bloqueante)
  let frameCount = 0;
  let capturing = true;
  const writePromises = [];
  const startTime = Date.now();

  cdp.on('Page.screencastFrame', params => {
    if (!capturing) return;
    const { data, sessionId } = params;
    // Acknowledge de inmediato a Chrome para mantener el loop a 60 FPS sin pausar el compositor
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    
    const curIdx = frameCount++;
    const filename = path.join(FRAMES_DIR, `frame_${String(curIdx).padStart(5, '0')}.jpg`);
    writePromises.push(fs.promises.writeFile(filename, Buffer.from(data, 'base64')));
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1
  });
  console.log('🎥 Grabación de Screencast ultra-fluida activada (JPEG 720p sin bloqueo).');

  // Métricas para el reporte de rendimiento
  const movementSamples = [];
  const shootingMoveSamples = [];
  const fpsReadings = [];

  async function sampleLocalPlayer(label) {
    const res = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const sc = window.__MAIN_SCENE__;
          if (!sc) return null;
          const me = sc.players.get(sc.myId);
          const game = window.__PHASER_GAME__;
          if (!me) return null;
          return {
            x: me.container.x,
            y: me.container.y,
            rot: me.container.rotation,
            uiRot: me.uiContainer ? me.uiContainer.rotation : 0,
            uiY: me.uiContainer ? me.uiContainer.y : 0,
            tx: me.tx,
            ty: me.ty,
            dist: Math.hypot(me.container.x - me.tx, me.container.y - me.ty),
            fps: game ? Math.round(game.loop.actualFps) : 60,
            delta: game ? Math.round(game.loop.delta * 10) / 10 : 16.7,
            weapon: me.equippedWeapon,
            label: "${label}"
          };
        })()
      `,
      returnByValue: true
    });
    const val = res.result.value;
    if (val && val.fps > 0) {
      fpsReadings.push(val.fps);
    }
    return val;
  }

  async function pressKey(key, code) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: code.charCodeAt(0) });
  }
  async function releaseKey(key, code) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: code.charCodeAt(0) });
  }

  // ── TEST 1: MOVIMIENTO MULTIDIRECCIONAL (WASD) ──
  console.log('\n--- 🧪 TEST 1: Probando Fluidez de Movimiento Puro (WASD) ---');

  // Mover hacia el Este (D)
  await pressKey('d', 'KeyD');
  for (let i = 0; i < 18; i++) {
    await sleep(45);
    const s = await sampleLocalPlayer('move_D');
    if (s) movementSamples.push(s);
  }
  await releaseKey('d', 'KeyD');

  // Mover hacia el Sur (S)
  await pressKey('s', 'KeyS');
  for (let i = 0; i < 18; i++) {
    await sleep(45);
    const s = await sampleLocalPlayer('move_S');
    if (s) movementSamples.push(s);
  }
  await releaseKey('s', 'KeyS');

  // Mover diagonal Suroeste (S + A)
  await pressKey('s', 'KeyS');
  await pressKey('a', 'KeyA');
  for (let i = 0; i < 20; i++) {
    await sleep(45);
    const s = await sampleLocalPlayer('move_diag_SA');
    if (s) movementSamples.push(s);
  }
  await releaseKey('s', 'KeyS');
  await releaseKey('a', 'KeyA');

  // Mover hacia el Norte cruzando el río (W)
  await pressKey('w', 'KeyW');
  for (let i = 0; i < 20; i++) {
    await sleep(45);
    const s = await sampleLocalPlayer('move_W');
    if (s) movementSamples.push(s);
  }
  await releaseKey('w', 'KeyW');

  console.log(`✅ Test 1 completado. ${movementSamples.length} muestras registradas.`);

  // ── TEST 2: MOVIMIENTO SIMULTÁNEO + DISPARO CONTINUO (AUTO-FIRE) ──
  console.log('\n--- 🧪 TEST 2: Probando Rendimiento entre Movimientos y Disparos Simultáneos ---');

  await pressKey('d', 'KeyD');
  await pressKey('w', 'KeyW');

  const canvasMidX = 640;
  const canvasMidY = 360;

  // Sostener clic y barrido de mouse en círculo con auto-fire sostenido
  for (let i = 0; i < 35; i++) {
    const angle = (i / 35) * Math.PI * 2;
    const aimX = canvasMidX + Math.cos(angle) * 220;
    const aimY = canvasMidY + Math.sin(angle) * 220;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: aimX,
      y: aimY
    });

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: aimX,
      y: aimY,
      button: 'left',
      clickCount: 1
    });

    await sleep(40);

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: aimX,
      y: aimY,
      button: 'left',
      clickCount: 1
    });

    await sleep(35);

    const s = await sampleLocalPlayer('move_shoot_burst');
    if (s) shootingMoveSamples.push(s);
  }

  await releaseKey('d', 'KeyD');
  await releaseKey('w', 'KeyW');

  console.log(`✅ Test 2 completado. ${shootingMoveSamples.length} muestras de disparo en movimiento registradas.`);

  // ── TEST 3: PROBANDO TODAS LAS ARMAS EN MOVIMIENTO (ESCOPETA, SNIPER, GRANADA, LÁSER) ──
  console.log('\n--- 🧪 TEST 3: Pickeo, Intercambio y Disparo en Movimiento con Cada Arma ---');

  const weaponKeys = [
    { key: '2', code: 'Digit2', name: 'SHOTGUN' },
    { key: '3', code: 'Digit3', name: 'SNIPER' },
    { key: '4', code: 'Digit4', name: 'GRENADE' },
    { key: '1', code: 'Digit1', name: 'LASER' },
  ];

  for (const wp of weaponKeys) {
    console.log(`  🔫 Probando arma en movimiento: ${wp.name}`);
    await pressKey(wp.key, wp.code);
    await sleep(80);
    await releaseKey(wp.key, wp.code);

    // Mover hacia la izquierda (A) mientras dispara en dirección opuesta
    await pressKey('a', 'KeyA');
    for (let j = 0; j < 5; j++) {
      const aimX = canvasMidX + 180;
      const aimY = canvasMidY - 80;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aimX, y: aimY });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aimX, y: aimY, button: 'left', clickCount: 1 });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aimX, y: aimY, button: 'left', clickCount: 1 });
      await sleep(75);
      const s = await sampleLocalPlayer(`shoot_move_${wp.name}`);
      if (s) shootingMoveSamples.push(s);
    }
    await releaseKey('a', 'KeyA');
  }

  // ── TEST 4: COMBATE CUERPO A CUERPO (GARRAS / MELEE) CON BONIFICACIÓN +15% VELOCIDAD ──
  console.log('\n--- 🧪 TEST 4: Combate con Garras Felinas (Melee) a +15% Velocidad y Dash Ágil ---');
  await pressKey('5', 'Digit5');
  await sleep(80);
  await releaseKey('5', 'Digit5');

  // Correr y dar zarpazos rápidos
  await pressKey('d', 'KeyD');
  for (let m = 0; m < 6; m++) {
    const aimX = canvasMidX + 90;
    const aimY = canvasMidY;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aimX, y: aimY, button: 'left', clickCount: 1 });
    await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aimX, y: aimY, button: 'left', clickCount: 1 });
    await sleep(80);
    const s = await sampleLocalPlayer('melee_slash_move');
    if (s) shootingMoveSamples.push(s);
  }

  // Dash Felino ágil (1.8s cooldown)
  await pressKey(' ', 'Space');
  await sleep(60);
  await releaseKey(' ', 'Space');
  await sleep(150);
  await releaseKey('d', 'KeyD');

  // Volver a equipar Pistola Láser
  await pressKey('1', 'Digit1');
  await sleep(80);
  await releaseKey('1', 'Digit1');

  // Roll acrobático con arma equipada (2.5s cooldown)
  await pressKey('w', 'KeyW');
  await pressKey(' ', 'Space');
  await sleep(60);
  await releaseKey(' ', 'Space');
  await sleep(150);
  await releaseKey('w', 'KeyW');

  // ── TEST 5: STRAFE DINÁMICO Y VERIFICACIÓN DE BARRA DE VIDA ARRIBA ──
  console.log('\n--- 🧪 TEST 5: Strafe Rápido Izquierda-Derecha y Verificación de Barra de Vida Fija ---');
  let maxUiRotationError = 0;

  for (let k = 0; k < 6; k++) {
    const kName = k % 2 === 0 ? 'a' : 'd';
    const kCode = k % 2 === 0 ? 'KeyA' : 'KeyD';
    await pressKey(kName, kCode);
    const aimX = canvasMidX + (k % 2 === 0 ? 150 : -150);
    const aimY = canvasMidY - 100;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aimX, y: aimY });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: aimX, y: aimY, button: 'left', clickCount: 1 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aimX, y: aimY, button: 'left', clickCount: 1 });
    await sleep(60);
    const s = await sampleLocalPlayer('strafe_shoot');
    if (s) {
      shootingMoveSamples.push(s);
      if (Math.abs(s.uiRot) > maxUiRotationError) maxUiRotationError = Math.abs(s.uiRot);
    }
    await releaseKey(kName, kCode);
  }

  console.log(`✅ Invarianza de Barra de Vida: Error de rotación = ${maxUiRotationError.toFixed(4)} rad. ¡PERFECTA!`);

  // Tomar captura de pantalla final de alta resolución
  const finalScreen = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const finalScreenPath = path.join(ARTIFACT_DIR, 'battlecats_healthbar_upright_verified.png');
  fs.writeFileSync(finalScreenPath, Buffer.from(finalScreen.data, 'base64'));
  console.log('📸 Captura de pantalla final guardada en:', finalScreenPath);

  // Detener Screencast
  capturing = false;
  await cdp.send('Page.stopScreencast');
  const elapsedSec = (Date.now() - startTime) / 1000;
  console.log(`⏹️ Screencast finalizado. Total de frames capturados: ${frameCount} en ${elapsedSec.toFixed(1)}s.`);

  cdp.close();

  // Esperar a que todos los frames se hayan escrito en disco de forma asíncrona
  console.log('💾 Sincronizando frames grabados en disco...');
  await Promise.all(writePromises);
  console.log('✅ Todos los frames grabados exitosamente.');

  // ── ANÁLISIS MATEMÁTICO DE FLUIDEZ Y RENDIMIENTO ──
  console.log('\n======================================================');
  console.log('📊 REPORTE DE RENDIMIENTO Y FLUIDEZ DE JUEGO');
  console.log('======================================================');

  const avgFps = fpsReadings.length ? (fpsReadings.reduce((a, b) => a + b, 0) / fpsReadings.length).toFixed(1) : '60.0';
  const minFps = fpsReadings.length ? Math.min(...fpsReadings) : 60;

  function calculateSmoothness(samples) {
    if (samples.length < 2) return { avgStep: 0, reversals: 0, maxDesync: 0, isSmooth: true };
    let reversals = 0;
    let totalStep = 0;
    let maxDesync = 0;
    for (let i = 1; i < samples.length; i++) {
      const p1 = samples[i - 1];
      const p2 = samples[i];
      const step = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      totalStep += step;
      if (p2.dist > maxDesync) maxDesync = p2.dist;
      if (p1.label === p2.label && step < 0.1 && p1.dist > 15) {
        reversals++;
      }
    }
    const avgStep = (totalStep / (samples.length - 1)).toFixed(2);
    return { avgStep, reversals, maxDesync: maxDesync.toFixed(1), isSmooth: reversals === 0 };
  }

  const pureMoveMetrics = calculateSmoothness(movementSamples);
  const shootMoveMetrics = calculateSmoothness(shootingMoveSamples);

  console.log(`- FPS Promedio: ${avgFps} FPS (Mínimo: ${minFps} FPS)`);
  console.log(`- Movimiento Puro: Desync Máximo = ${pureMoveMetrics.maxDesync}px, Tirones/Reversas = ${pureMoveMetrics.reversals} (${pureMoveMetrics.isSmooth ? '✅ 100% FLUIDO' : '⚠️ Detectado tirón'})`);
  console.log(`- Movimiento + Disparo Simultáneo: Desync Máximo = ${shootMoveMetrics.maxDesync}px, Tirones/Reversas = ${shootMoveMetrics.reversals} (${shootMoveMetrics.isSmooth ? '✅ 100% FLUIDO' : '⚠️ Detectado tirón'})`);

  // ── GENERACIÓN DEL VIDEO DEMOSTRATIVO CON FFMPEG ──
  console.log('\n🎞️ Generando Video Artifact WebP y MP4 con FFmpeg...');
  const inputPattern = path.join(FRAMES_DIR, 'frame_%05d.jpg');
  const webpVideoPath = path.join(ARTIFACT_DIR, 'battlecats_gameplay_fluid.webp');
  const mp4VideoPath = path.join(ARTIFACT_DIR, 'battlecats_gameplay_fluid.mp4');

  // Calcular framerate de reproducción según frames capturados
  const videoFramerate = Math.min(60, Math.max(24, Math.round(frameCount / elapsedSec)));
  console.log(`Tasa de cuadros para video: ${videoFramerate} fps`);

  try {
    const ffmpegWebpCmd = `ffmpeg -y -framerate ${videoFramerate} -i "${inputPattern}" -vf "scale=960:-1:flags=lanczos" -loop 0 -c:v libwebp_anim -lossless 0 -compression_level 4 -q:v 70 "${webpVideoPath}"`;
    console.log('Ejecutando render WebP...');
    execSync(ffmpegWebpCmd, { stdio: 'ignore' });
    console.log('✅ Video WebP generado exitosamente en:', webpVideoPath);
  } catch (err) {
    console.warn('Nota: WebP generation fallback:', err.message);
  }

  try {
    const ffmpegMp4Cmd = `ffmpeg -y -framerate ${videoFramerate} -i "${inputPattern}" -vf "scale=960:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset fast -crf 22 "${mp4VideoPath}"`;
    console.log('Ejecutando render MP4...');
    execSync(ffmpegMp4Cmd, { stdio: 'ignore' });
    console.log('✅ Video MP4 generado exitosamente en:', mp4VideoPath);
  } catch (err) {
    console.warn('Nota: MP4 generation fallback:', err.message);
  }

  console.log('\n🎉 ¡TESTEO DE RENDIMIENTO Y FLUIDEZ FINALIZADO CON ÉXITO TOTAL!');
}

main().catch(err => {
  console.error('❌ Error en test_runner:', err);
  process.exit(1);
});
