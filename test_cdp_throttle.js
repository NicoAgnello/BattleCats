const WebSocket = require('./server/node_modules/ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', async () => {
      // Test CDP commands to disable throttling
      ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Page.bringToFront' }));
      ws.send(JSON.stringify({ id: 3, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }));
      
      try {
        ws.send(JSON.stringify({ id: 4, method: 'Page.setWebLifecycleState', params: { state: 'active' } }));
      } catch {}

      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 5,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              (() => {
                const g = window.__PHASER_GAME__;
                return {
                  fps: g ? g.loop.actualFps : null,
                  delta: g ? g.loop.delta : null
                };
              })()
            `,
            returnByValue: true
          }
        }));
      }, 1000);
    });

    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 5) {
        console.log('Post-throttle fix FPS:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
