const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, 'server', 'node_modules', 'ws'));

http.get('http://127.0.0.1:9222/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', async () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      // Click start button if on start screen
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const btn = document.querySelector('button[type="submit"]') ||
                          Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('COMBATE') || b.textContent.includes('BATALLA')));
              if (btn) btn.click();
              return true;
            })()
          `,
          returnByValue: true
        }
      }));
    });

    let step = 0;
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        // Wait 2 seconds and measure FPS
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
                    actualFps: g.loop.actualFps,
                    delta: g.loop.delta,
                    running: g.loop.running
                  };
                })()
              `,
              returnByValue: true
            }
          }));
        }, 2500);
      } else if (msg.id === 2) {
        console.log('Real Game FPS (without screencast throttling):', msg.result.value);
        ws.close();
      }
    });
  });
});
