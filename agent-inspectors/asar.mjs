import fs from 'node:fs';

const asarPath = process.argv[2];
const needles = process.argv.slice(3);
const buf = fs.readFileSync(asarPath);
const size = buf.readUInt32LE(4);
const headerBuf = buf.subarray(8, 8 + size);
const jsonLen = headerBuf.readUInt32LE(4);
const headerJson = headerBuf.subarray(8, 8 + jsonLen).toString('utf8');
const header = JSON.parse(headerJson);
const baseOffset = 8 + size;

const files = [];
(function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name;
    if (v.files) walk(v, p);
    else files.push({ path: p, size: v.size, offset: Number(v.offset) });
  }
})(header, '');

console.log('files in asar:', files.length);
files.sort((a, b) => b.size - a.size);
console.log('largest:');
for (const f of files.slice(0, 15)) console.log(' ', f.path, f.size);

if (needles.length) {
  let hits = 0;
  const MAX = Number(process.env.MAXHITS || 6);
  const CTX = Number(process.env.CTX || 250);
  for (const f of files) {
    if (f.size > 40_000_000) continue;
    if (!/\.(js|mjs|cjs|ts|json|html|css)$/i.test(f.path)) continue;
    const content = buf.subarray(baseOffset + f.offset, baseOffset + f.offset + f.size).toString('utf8');
    const low = content.toLowerCase();
    for (const n of needles) {
      let i = 0;
      let nHits = 0;
      while (nHits < MAX) {
        i = low.indexOf(n.toLowerCase(), i);
        if (i < 0) break;
        console.log('=== ' + f.path + ' @' + i + ' [' + n + ']');
        console.log(content.slice(Math.max(0, i - CTX), i + CTX).replace(/\n/g, ' '));
        hits++;
        nHits++;
        i += n.length;
      }
    }
  }
  console.log('total hits', hits);
}
