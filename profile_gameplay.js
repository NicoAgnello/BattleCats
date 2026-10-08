const WebSocket = require('./server/node_modules/ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('localhost:3000'));
    if (!tab) {
      console.error('localhost:3000 not found');
      return;
    }
    const ws = new WebSocket(tab.webSocketDebuggerUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 10, method: 'Page.bringToFront' }));
      ws.send(JSON.stringify({ id: 11, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }));

      // Profile expression
      const expr = `
        (async () => {
          // If not in game, submit form
          const btn = document.querySelector('button[type="submit"]') ||
                      Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('COMBATE') || b.textContent.includes('BATALLA') || b.textContent.includes('Play')));
          if (btn && !window.__MAIN_SCENE__) {
            btn.click();
            await new Promise(r => setTimeout(r, 2000));
          }

          const sc = window.__MAIN_SCENE__;
          const g = window.__PHASER_GAME__;
          if (!sc || !g) return { error: 'Scene or Game not ready' };

          // Measure 180 consecutive frames during movement
          const frameTimes = [];
          const fpsSamples = [];
          const reconciliations = [];
          let lastT = performance.now();
          let frameCount = 0;

          return new Promise(resolve => {
            function onFrame(now) {
              const dt = now - lastT;
              lastT = now;
              frameTimes.push(dt);
              fpsSamples.push(g.loop.actualFps);

              const me = sc.players.get(sc.myId);
              if (me) {
                const dist = Math.hypot(me.container.x - me.tx, me.container.y - me.ty);
                reconciliations.push(dist);
              }

              frameCount++;
              if (frameCount < 120) {
                requestAnimationFrame(onFrame);
              } else {
                frameTimes.shift(); // remove first transition frame
                const avgDt = frameTimes.reduce((a,b)=>a+b,0) / frameTimes.length;
                const sortedDt = [...frameTimes].sort((a,b)=>a-b);
                const p95 = sortedDt[Math.floor(sortedDt.length * 0.95)];
                const p99 = sortedDt[Math.floor(sortedDt.length * 0.99)];
                const maxDt = sortedDt[sortedDt.length - 1];
                const minDt = sortedDt[0];
                const avgFps = fpsSamples.reduce((a,b)=>a+b,0) / fpsSamples.length;
                const minFps = Math.min(...fpsSamples);
                const avgReconcile = reconciliations.reduce((a,b)=>a+b,0) / reconciliations.length;
                const maxReconcile = Math.max(...reconciliations);

                // Check WebGL renderer stats
                const renderer = g.renderer;
                const gl = renderer.gl;
                
                resolve({
                  framesMeasured: frameTimes.length,
                  avgFps: Math.round(avgFps * 10) / 10,
                  minFps: Math.round(minFps * 10) / 10,
                  avgFrameTimeMs: Math.round(avgDt * 100) / 100,
                  minFrameTimeMs: Math.round(minDt * 100) / 100,
                  p95FrameTimeMs: Math.round(p95 * 100) / 100,
                  p99FrameTimeMs: Math.round(p99 * 100) / 100,
                  maxFrameTimeMs: Math.round(maxDt * 100) / 100,
                  avgReconciliationPx: Math.round(avgReconcile * 100) / 100,
                  maxReconciliationPx: Math.round(maxReconcile * 100) / 100,
                  obstaclesCount: sc.obstacles.size,
                  playersCount: sc.players.size,
                  itemsCount: sc.items.size,
                  bulletsPoolSize: sc.bulletPool.getChildren().length,
                  drawCalls: renderer.drawCount || 'N/A'
                });
              }
            }
            requestAnimationFrame(onFrame);
          });
        })()
      `;

      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: expr, awaitPromise: true, returnByValue: true }
        }));
      }, 500);
    });

    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        console.log('Gameplay Profiling Results:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
