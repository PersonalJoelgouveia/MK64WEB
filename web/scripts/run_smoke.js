const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2], page_name = process.argv[3];
const types = { '.html':'text/html', '.js':'text/javascript', '.wasm':'application/wasm', '.json':'application/json' };
const srv = http.createServer((q, r) => {
  const f = path.join(dir, q.url.split('?')[0] === '/' ? page_name : q.url.split('?')[0]);
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    r.end(d);
  });
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const p = await b.newPage();
  const logs = [];
  p.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
  p.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await p.goto('http://localhost:' + port + '/' + (process.argv[4] || ''));
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && !logs.some(l => /FIM_OK|abort|Aborted|pageerror/.test(l))) await new Promise(r => setTimeout(r, 500));
  await new Promise(r => setTimeout(r, 1500));
  console.log(logs.slice(0, 60).join('\n'));
  await p.screenshot({ path: path.join(dir, 'smoke.png') });
  await b.close(); srv.close();
});
