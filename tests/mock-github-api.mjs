// A local stand-in for api.github.com, used by publish.test.mjs.
//
// It runs as its OWN process on purpose. The test process spawns the publish
// script with spawnSync, which blocks its event loop; a mock server living in
// that same process could never answer the child's request, so the child would
// hang. Running here means the listener stays responsive while the test blocks.
//
// Every request is appended to MOCK_LOG as JSON lines so the test can assert on
// exactly what the publish script sent. Nothing leaves the machine.
import fs from 'node:fs';
import http from 'node:http';

const logFile = process.env.MOCK_LOG;
const portFile = process.env.MOCK_PORT_FILE;

const remote = {
  tree: [
    { type: 'blob', path: 'README.md' },
    { type: 'blob', path: '.github/workflows/ci.yml' },
    { type: 'blob', path: 'docs/old.md' },
  ],
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { /* keep raw */ }
    if (logFile) {
      fs.appendFileSync(logFile, JSON.stringify({ method: req.method, url: req.url, body: parsed }) + '\n');
    }
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/user') return send({ login: 'tester', name: 'Tester' });
    if (req.url === '/repos/tester/demo') {
      return send({ full_name: 'tester/demo', html_url: 'https://example.invalid/tester/demo' });
    }
    if (req.url === '/repos/tester/demo/git/ref/heads/main') return send({ object: { sha: 'head1234' } });
    if (req.url.startsWith('/repos/tester/demo/git/trees/head1234')) return send({ tree: remote.tree });
    if (/\/git\/blobs$/.test(req.url)) return send({ sha: 'blob-deadbeef' });
    if (/\/git\/trees$/.test(req.url)) return send({ sha: 'tree1234' });
    if (/\/git\/commits$/.test(req.url)) return send({ sha: 'commit1234567890' });
    if (/\/git\/refs\/heads\/main$/.test(req.url)) return send({ ref: 'refs/heads/main' });
    if (/\/topics$/.test(req.url)) return send({ names: [] });
    return send({ message: 'not found' }, 404);
  });
});

server.listen(0, '127.0.0.1', () => {
  if (portFile) fs.writeFileSync(portFile, String(server.address().port));
});

process.on('SIGTERM', () => process.exit(0));
