import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const raw = fs.readFileSync(file);
let text;
try { text = zlib.zstdDecompressSync(raw).toString('utf8'); } catch (e) { console.log('ERR', e.message); process.exit(1); }
console.log('decompressed bytes:', text.length);
let data;
try { data = JSON.parse(text); } catch (e) { console.log('not single json:', e.message); console.log(text.slice(0, 500)); process.exit(0); }
console.log('top-level keys:', Object.keys(data));
for (const k of Object.keys(data)) {
  const v = data[k];
  console.log(k, Array.isArray(v) ? `array(${v.length})` : typeof v);
  if (Array.isArray(v) && v.length) console.log('  first item keys:', Object.keys(v[0] || {}).join(','));
}
