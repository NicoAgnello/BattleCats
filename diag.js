const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, 'server', 'node_modules', 'ws'));

http.get('http://127.0.0.1:9222/json', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.url.includes('localhost:3000'));
    if (!tab) {
      console.log('No localhost:3000 tab found');
      return;
    }
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const g = window.__PHASER_GAME__;
              const sc = window.__MAIN_SCENE__;
              if (!g) return { status: 'no_game' };
              return {
                actualFps: Math.round(g.loop.actualFps),
                delta: Math.round(g.loop.delta),
                running: g.loop.running,
                type: g.renderer.type === 2 ? 'WEBGL' : 'CANVAS',
                sceneActive: sc ? sc.scene.isActive() : false,
                playersCount: sc ? sc.players.size : 0,
                projsCount: sc ? sc.projs.size : 0,
                obstaclesCount: sc ? sc.obstacles.size : 0,
              };
            })()
          `,
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        console.log('Phaser Diagnostics:', msg.result.value);
        ws.close();
      }
    });
  });
});
