const WebSocket = require('./server/node_modules/ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('localhost:3000'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', async () => {
      // Bring to front and emulate focus
      ws.send(JSON.stringify({ id: 10, method: 'Page.bringToFront' }));
      ws.send(JSON.stringify({ id: 11, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }));

      setTimeout(() => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              new Promise(resolve => {
                const deltas = [];
                let last = performance.now();
                let count = 0;
                function frame(now) {
                  deltas.push(now - last);
                  last = now;
                  count++;
                  if (count < 60) {
                    requestAnimationFrame(frame);
                  } else {
                    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
                    resolve({
                      count: deltas.length,
                      avgDeltaMs: Math.round(avg * 100) / 100,
                      fps: Math.round(1000 / avg),
                      visibilityState: document.visibilityState,
                      hasFocus: document.hasFocus(),
                      minDelta: Math.round(Math.min(...deltas) * 100) / 100,
                      maxDelta: Math.round(Math.max(...deltas) * 100) / 100
                    });
                  }
                }
                requestAnimationFrame(frame);
              })
            `,
            awaitPromise: true,
            returnByValue: true
          }
        }));
      }, 300);
    });

    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        console.log('Real-time Browser RAF Benchmark:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
