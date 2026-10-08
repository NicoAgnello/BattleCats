const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, 'server', 'node_modules', 'ws'));

http.get('http://127.0.0.1:9222/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const form = document.querySelector('form');
              if (form) {
                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                return { action: 'submitted_form' };
              }
              const btn = document.querySelector('button[type="submit"]');
              if (btn) {
                btn.click();
                return { action: 'clicked_button' };
              }
              return { action: 'already_in_game', hasPhaser: !!window.__PHASER_GAME__ };
            })()
          `,
          returnByValue: true
        }
      }));
    });

    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        console.log('Start result:', msg.result.result.value);
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
              expression: `
                (() => {
                  const g = window.__PHASER_GAME__;
                  if (!g) return { status: 'no_game' };
                  return {
                    actualFps: Math.round(g.loop.actualFps * 10) / 10,
                    delta: Math.round(g.loop.delta * 10) / 10,
                    renderer: g.renderer.type === 2 ? 'WEBGL' : 'CANVAS',
                    running: g.loop.running,
                  };
                })()
              `,
              returnByValue: true
            }
          }));
        }, 1500);
      } else if (msg.id === 2) {
        console.log('Unthrottled Game FPS:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
