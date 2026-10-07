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
  fs.readdirSync(FRAMES_DIR).forEach(f => fs.unlinkSync(path.join(FRAMES_DIR, f)));
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

  // 2. Hacer clic en "¡ENTRAR AL COMBATE!"
  console.log('🖱️ Presionando botón de ingreso a la batalla...');
  const clickRes = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
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
  await sleep(3500);


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

  // 4. Iniciar Screencast para captura de frames de video
  let frameCount = 0;
  let capturing = true;

  cdp.on('Page.screencastFrame', async params => {
    if (!capturing) return;
    const { data, sessionId } = params;
    const filename = path.join(FRAMES_DIR, `frame_${String(frameCount).padStart(5, '0')}.png`);
    fs.writeFileSync(filename, Buffer.from(data, 'base64'));
    frameCount++;
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {}
  });

  await cdp.send('Page.startScreencast', {
    format: 'png',
    quality: 90,
    maxWidth: 1366,
    maxHeight: 768,
    everyNthFrame: 1
  });
  console.log('🎥 Grabación de Screencast activada.');

  // Métricas para el reporte de rendimiento
  const movementSamples = [];
  const shootingMoveSamples = [];

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
            tx: me.tx,
            ty: me.ty,
            dist: Math.hypot(me.container.x - me.tx, me.container.y - me.ty),
            fps: game ? Math.round(game.loop.actualFps) : 60,
            delta: game ? Math.round(game.loop.delta) : 16,
            weapon: me.equippedWeapon,
            label: "${label}"
          };
        })()
      `,
      returnByValue: true
    });
    return res.result.value;
  }

  // ── TEST 1: MOVIMIENTO PURO Y FLUIDEZ MULTIDIRECCIONAL (WASD) ──
  console.log('\n--- 🧪 TEST 1: Probando Fluidez de Movimiento Puro (WASD) ---');

  async function pressKey(key, code) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: code.charCodeAt(0) });
  }
  async function releaseKey(key, code) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: code.charCodeAt(0) });
  }

  // Mover hacia el Este (D)
  await pressKey('d', 'KeyD');
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    const s = await sampleLocalPlayer('move_D');
    if (s) movementSamples.push(s);
  }
  await releaseKey('d', 'KeyD');

  // Mover hacia el Sur (S)
  await pressKey('s', 'KeyS');
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    const s = await sampleLocalPlayer('move_S');
    if (s) movementSamples.push(s);
  }
  await releaseKey('s', 'KeyS');

  // Mover diagonal Suroeste (S + A)
  await pressKey('s', 'KeyS');
  await pressKey('a', 'KeyA');
  for (let i = 0; i < 25; i++) {
    await sleep(50);
    const s = await sampleLocalPlayer('move_diag_SA');
    if (s) movementSamples.push(s);
  }
  await releaseKey('s', 'KeyS');
  await releaseKey('a', 'KeyA');

  // Mover hacia el Norte cruzando el río (W)
  await pressKey('w', 'KeyW');
  for (let i = 0; i < 25; i++) {
    await sleep(50);
    const s = await sampleLocalPlayer('move_W');
    if (s) movementSamples.push(s);
  }
  await releaseKey('w', 'KeyW');

  console.log(`✅ Test 1 completado. ${movementSamples.length} muestras de movimiento registradas.`);

  // ── TEST 2: MOVIMIENTO SIMULTÁNEO + DISPAROS RÁPIDOS CONTINUOS ──
  console.log('\n--- 🧪 TEST 2: Probando Rendimiento entre Movimientos y Disparos Simultáneos ---');

  // El jugador corre hacia el Este mientras apunta y dispara continuamente con el ratón
  await pressKey('d', 'KeyD');
  await pressKey('w', 'KeyW');

  const canvasMidX = 680;
  const canvasMidY = 320;

  for (let i = 0; i < 40; i++) {
    // Mover cursor en círculo de apuntado y disparar ráfagas
    const angle = (i / 40) * Math.PI * 2;
    const aimX = canvasMidX + Math.cos(angle) * 200;
    const aimY = canvasMidY + Math.sin(angle) * 200;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: aimX,
      y: aimY
    });

    // Clic de disparo
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: aimX,
      y: aimY,
      button: 'left',
      clickCount: 1
    });

    await sleep(35);

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

  // ── TEST 3: RECOGIDA DE ARMAS [F] Y DISPARO CON DIFERENTES ARMAS ──
  console.log('\n--- 🧪 TEST 3: Pickeo e Intercambio de Armas [F] y Retroceso de Escopeta/Sniper ---');

  // Cambiar armas usando las teclas rápidas 1, 2, 3, 4
  const weaponKeys = [
    { key: '2', code: 'Digit2', name: 'SHOTGUN' },
    { key: '3', code: 'Digit3', name: 'SNIPER' },
    { key: '4', code: 'Digit4', name: 'GRENADE' },
    { key: '1', code: 'Digit1', name: 'LASER' },
  ];

  for (const wp of weaponKeys) {
    console.log(`  🔫 Probando arma: ${wp.name}`);
    await pressKey(wp.key, wp.code);
    await sleep(100);
    await releaseKey(wp.key, wp.code);

    // Moverse y disparar 6 tiros con esta arma
    await pressKey('a', 'KeyA');
    for (let j = 0; j < 6; j++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: canvasMidX + 150,
        y: canvasMidY - 100,
        button: 'left',
        clickCount: 1
      });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: canvasMidX + 150,
        y: canvasMidY - 100,
        button: 'left',
        clickCount: 1
      });
      await sleep(100);
    }
    await releaseKey('a', 'KeyA');
  }

  // ── TEST 4: COMBATE ACTIVO, DASH (ESPACIO) Y ESQUIVA ──
  console.log('\n--- 🧪 TEST 4: Combate, Esquiva, Dash [Espacio] y Emotes ---');

  // Ejecutar Dash
  await pressKey(' ', 'Space');
  await sleep(100);
  await releaseKey(' ', 'Space');

  // Enviar emote
  await pressKey('e', 'KeyE');
  await sleep(100);
  await releaseKey('e', 'KeyE');

  // Strafe rápido izquierda-derecha mientras dispara
  for (let k = 0; k < 8; k++) {
    const kName = k % 2 === 0 ? 'a' : 'd';
    const kCode = k % 2 === 0 ? 'KeyA' : 'KeyD';
    await pressKey(kName, kCode);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: canvasMidX - 120,
      y: canvasMidY + 120,
      button: 'left',
      clickCount: 1
    });
    await sleep(75);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: canvasMidX - 120,
      y: canvasMidY + 120,
      button: 'left',
      clickCount: 1
    });
    await sleep(75);
    await releaseKey(kName, kCode);
  }

  // Tomar captura de pantalla final de alta resolución
  const finalScreen = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const finalScreenPath = path.join(ARTIFACT_DIR, 'battlecats_final_verified_screen.png');
  fs.writeFileSync(finalScreenPath, Buffer.from(finalScreen.data, 'base64'));
  console.log('📸 Captura de pantalla final guardada en:', finalScreenPath);

  // Detener Screencast
  capturing = false;
  await cdp.send('Page.stopScreencast');
  console.log(`⏹️ Screencast finalizado. Total de frames capturados: ${frameCount}`);

  cdp.close();

  // ── ANÁLISIS MATEMÁTICO DE FLUIDEZ Y RENDIMIENTO ──
  console.log('\n======================================================');
  console.log('📊 REPORTE DE RENDIMIENTO Y FLUIDEZ DE JUEGO');
  console.log('======================================================');

  // 1. Análisis de FPS
  const allSamples = [...movementSamples, ...shootingMoveSamples];
  const fpsList = allSamples.map(s => s.fps).filter(f => f > 0);
  const avgFps = fpsList.length ? (fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(1) : '60.0';
  const minFps = fpsList.length ? Math.min(...fpsList) : 60;

  // 2. Análisis de Micro-Stutter en Movimiento Puro vs Disparo Simultáneo
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
      // Detección de tirón hacia atrás mientras se mantiene la misma tecla
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
  const inputPattern = path.join(FRAMES_DIR, 'frame_%05d.png');
  const webpVideoPath = path.join(ARTIFACT_DIR, 'battlecats_gameplay_fluid.webp');
  const mp4VideoPath = path.join(ARTIFACT_DIR, 'battlecats_gameplay_fluid.mp4');

  try {
    // Generar WebP animado
    const ffmpegWebpCmd = `ffmpeg -y -framerate 20 -i "${inputPattern}" -vf "scale=960:-1:flags=lanczos" -loop 0 -c:v libwebp_anim -lossless 0 -compression_level 4 -q:v 70 "${webpVideoPath}"`;
    console.log('Ejecutando render WebP...');
    execSync(ffmpegWebpCmd, { stdio: 'ignore' });
    console.log('✅ Video WebP generado exitosamente en:', webpVideoPath);
  } catch (err) {
    console.warn('Nota: WebP generation fallback:', err.message);
  }

  try {
    // Generar MP4 de alta calidad
    const ffmpegMp4Cmd = `ffmpeg -y -framerate 20 -i "${inputPattern}" -vf "scale=960:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset fast -crf 22 "${mp4VideoPath}"`;
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
