const WebSocket = require('./server/node_modules/ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\lucam\\.gemini\\antigravity-ide\\brain\\58af40b1-2bb0-427f-9c8b-72a6f493b83b';

function getSuroiTab() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const tabs = JSON.parse(d);
        const tab = tabs.find(t => t.url.includes('suroi.io'));
        if (tab) resolve(tab);
        else reject(new Error('Suroi tab not found'));
      });
    }).on('error', reject);
  });
}

async function main() {
  const tab = await getSuroiTab();
  console.log('🔗 Conectando a pestaña Suroi.io:', tab.url);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);

  let id = 1;
  const callbacks = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const curId = id++;
      callbacks.set(curId, msg => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  await new Promise(r => ws.on('open', r));
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  });

  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  console.log('⏳ Esperando 4 segundos a que cargue Suroi.io...');
  await new Promise(r => setTimeout(r, 4000));

  // Capturar pantalla de inicio
  const menuScreen = await send('Page.captureScreenshot', { format: 'png' });
  const menuPath = path.join(ARTIFACT_DIR, 'suroi_menu_screen.png');
  fs.writeFileSync(menuPath, Buffer.from(menuScreen.data, 'base64'));
  console.log('📸 Menú de Suroi capturado en:', menuPath);

  // Inspeccionar botones en pantalla
  const pageInfo = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.innerText,
          id: b.id,
          className: b.className
        }));
        const canvas = document.querySelector('canvas');
        return {
          title: document.title,
          buttons,
          hasCanvas: !!canvas,
          canvasW: canvas ? canvas.width : null,
          canvasH: canvas ? canvas.height : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('📋 Elementos de la página de Suroi:', pageInfo.result.value);

  // Intentar hacer clic en el botón de juego
  console.log('🖱️ Intentando ingresar a partida en Suroi.io...');
  const joinRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const btn = document.querySelector('#play-btn') ||
                    document.querySelector('#btn--play') ||
                    Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.toLowerCase().includes('play') || b.innerText.toLowerCase().includes('jugar')));
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.innerText };
        }
        return { clicked: false };
      })()
    `,
    returnByValue: true
  });
  console.log('Resultado de clic en Play:', joinRes.result.value);

  // Esperar a entrar a partida y cargar mapa
  await new Promise(r => setTimeout(r, 4500));

  // Moverse un poco con WASD para ver físicas y terreno
  console.log('🎮 Probando movimiento en Suroi.io...');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await new Promise(r => setTimeout(r, 1500));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });

  // Disparar o golpear con puños
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 400, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 100));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 400, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 600));

  // Capturar gameplay en partida
  const gameScreen = await send('Page.captureScreenshot', { format: 'png' });
  const gamePath = path.join(ARTIFACT_DIR, 'suroi_gameplay_screen.png');
  fs.writeFileSync(gamePath, Buffer.from(gameScreen.data, 'base64'));
  console.log('📸 Gameplay de Suroi capturado en:', gamePath);

  ws.close();
  console.log('✅ Prueba de Suroi.io finalizada con éxito.');
}

main().catch(console.error);
