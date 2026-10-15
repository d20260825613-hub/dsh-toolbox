// Isolates the suspected cause of the GUI's empty {"exit":1}: the handler kills
// the child from `req.on('close')`, which in modern Node fires as soon as the
// request body has been consumed, not when the client disconnects.
import http from 'node:http';

const log = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    log.push('end: body consumed');

    // Stand-in for the spawned scan: it needs time to produce its first byte.
    let alive = true;
    const timer = setTimeout(() => {
      if (!alive) {
        log.push('child would have written output, but it was killed first');
        return;
      }
      res.write(`${JSON.stringify({ chunk: 'real output\n' })}\n`);
      res.write(`${JSON.stringify({ exit: 0 })}\n`);
      res.end();
    }, 300);

    req.on('close', () => {
      log.push("req 'close' fired");
      if (alive) {
        alive = false;
        clearTimeout(timer);
        log.push('child killed by the req-close handler');
        res.write(`${JSON.stringify({ exit: 1 })}\n`);
        res.end();
      }
    });
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ args: ['.'] }),
});
console.log('HTTP status:', res.status);
console.log('body:', await res.text());
console.log('event order:');
for (const line of log) console.log('  -', line);

server.close();
process.exit(0);
