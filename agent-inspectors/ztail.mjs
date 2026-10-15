import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const mode = process.argv[3] || 'tail';
const arg = process.argv[4] || '40';
const raw = fs.readFileSync(file);
const text = zlib.zstdDecompressSync(raw).toString('utf8');
const lines = text.split('\n').filter(Boolean);

function summarize(line) {
  let o;
  try { o = JSON.parse(line); } catch { return line.slice(0, 300); }
  const t = o.type || o.role || o.kind || '?';
  let body = o.text || o.content || o.message || o.summary || '';
  if (typeof body !== 'string') body = JSON.stringify(body);
  return `[${t}] ${body.replace(/\s+/g, ' ').slice(0, 400)}`;
}

let sel;
if (mode === 'tail') sel = lines.slice(-Number(arg));
else if (mode === 'head') sel = lines.slice(0, Number(arg));
else if (mode === 'grep') sel = lines.filter((l) => l.toLowerCase().includes(String(arg).toLowerCase()));
else sel = lines;

const outFile = process.env.ZOUT || 'zdump.out.txt';
fs.writeFileSync(outFile, `total lines: ${lines.length}\n` + sel.map((l, i) => `${i}| ${summarize(l)}`).join('\n'), 'utf8');
console.log('total', lines.length, 'selected', sel.length);
