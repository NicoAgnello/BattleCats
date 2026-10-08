const WebSocket = require('./server/node_modules/ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      // Click start if needed
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const btn = document.querySelector('button[type="submit"]');
              if (btn) btn.click();
              return { clicked: !!btn };
            })()
          `,
          returnByValue: true
        }
      }));
      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              (() => {
                const game = window.__PHASER_GAME__;
                const scene = window.__MAIN_SCENE__;
                return {
                  phaserActualFps: game ? game.loop.actualFps : null,
                  phaserDelta: game ? game.loop.delta : null,
                  fpsTarget: game ? game.loop.targetFps : null,
                  numPlayers: scene && scene.players ? scene.players.size : 0,
                  numObstacles: scene && scene.obstacles ? scene.obstacles.size : 0,
                  numItems: scene && scene.items ? scene.items.size : 0,
                  tweens: scene ? scene.tweens.getAllTweens().length : 0,
                  children: scene ? scene.children.list.length : 0
                };
              })()
            `,
            returnByValue: true
          }
        }));
      }, 1500);
    });
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 2) {
        console.log('Phaser Diagnostics:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
