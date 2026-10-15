import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
let idx = [];
let i = 0;
while (true) {
  i = buf.indexOf(magic, i);
  if (i < 0) break;
  idx.push(i);
  i += 4;
}
console.log('file size', buf.length, 'magic count', idx.length, 'first offsets', idx.slice(0, 10));

// try decompressing frame by frame sequentially using zstdDecompressSync on slices
let offset = 0;
let frames = 0;
let total = 0;
const chunks = [];
while (offset < buf.length) {
  try {
    const out = zlib.zstdDecompressSync(buf.subarray(offset));
    chunks.push(out);
    total += out.length;
    frames++;
    // find the offset of the next magic after this frame start
    const next = idx.find((p) => p > offset);
    if (next === undefined) break;
    offset = next;
    if (frames > 5000) break;
  } catch (e) {
    console.log('stopped at offset', offset, e.message);
    break;
  }
}
console.log('frames', frames, 'total bytes', total);
if (chunks.length) {
  const all = Buffer.concat(chunks).toString('utf8');
  fs.writeFileSync(process.argv[3] || 'zdump.raw.txt', all, 'utf8');
  console.log('sample:', all.slice(0, 300));
}
