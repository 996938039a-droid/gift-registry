// Local preview: serves /public and runs Code.gs against a local JSON file instead of Google.
// Nothing here touches your real Sheet. Start with: npm run dev
const http = require('http'), fs = require('fs'), path = require('path');
const { createRuntime } = require('./mock-gas');
const PUB = path.join(__dirname, '..', 'public');
const rt = createRuntime({ file: process.env.DATA_FILE || path.join(__dirname, '..', '.data', 'db.json') });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT) || 8888;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/exec') {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const out = req.method === 'POST' ? rt.post(Buffer.concat(chunks).toString()) : (u.searchParams.get('r') ? rt.get(u.searchParams.get('r')) : JSON.parse(rt.sandbox.doGet().getContent()));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  if (u.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.GR_API_URL = "/exec";'); }
  if (u.pathname === '/__mail') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(rt.state.mail)); } // dev only: read the "emails" the app would send
  if (u.pathname === '/__set') { // dev only: edit a cell like the service team would in the Sheet
    const tab = rt.state.sheets[u.searchParams.get('tab')], head = tab[0], [mk, mv] = u.searchParams.get('match').split(':');
    tab.slice(1).forEach((row) => { if (row[head.indexOf(mk)] === mv) row[head.indexOf(u.searchParams.get('field'))] = u.searchParams.get('value'); });
    res.writeHead(200); return res.end('ok');
  }
  let f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('Local preview on http://localhost:' + port + '  (data in .data/db.json, password-reset emails at /__mail)'));
