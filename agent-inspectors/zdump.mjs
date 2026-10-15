import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const needles = process.argv.slice(3);
const raw = fs.readFileSync(file);
let text;
try {
  text = zlib.zstdDecompressSync(raw).toString('utf8');
} catch (e) {
  console.error('decompress failed', e.message);
  process.exit(1);
}
const lines = text.split('\n').filter(Boolean);
const out = [];
out.push('lines: ' + lines.length);
if (needles.length === 0) {
  out.push(lines.join('\n'));
} else {
  for (const line of lines) {
    const low = line.toLowerCase();
    if (needles.some((n) => low.includes(n.toLowerCase()))) {
      out.push('---');
      out.push(line.length > 6000 ? line.slice(0, 6000) + '...[trunc]' : line);
    }
  }
}
fs.writeFileSync(process.argv[3 + 0] && process.env.ZOUT ? process.env.ZOUT : 'zdump.out.txt', out.join('\n'), 'utf8');
console.log('wrote', out.length, 'chunks');
