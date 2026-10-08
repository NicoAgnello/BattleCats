const WebSocket = require('./server/node_modules/ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const sc = window.__MAIN_SCENE__;
              const g = window.__PHASER_GAME__;
              const t0 = performance.now();
              sc.update(t0, 16.6);
              const updateDuration = performance.now() - t0;
              return {
                updateDurationMs: Math.round(updateDuration * 1000) / 1000,
                fps: Math.round(g.loop.actualFps * 10) / 10,
                delta: Math.round(g.loop.delta * 10) / 10,
                rendererType: g.renderer.type === 2 ? 'WEBGL' : 'CANVAS'
              };
            })()
          `,
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => { console.log(JSON.parse(m).result.result.value); ws.close(); });
  });
});
