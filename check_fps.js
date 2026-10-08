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
          expression: 'window.__PHASER_GAME__ ? Object.keys(window.__PHASER_GAME__) : "no_game"',
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => {
      console.log('Phaser keys:', JSON.parse(m));
      ws.close();
    });
  });
});
