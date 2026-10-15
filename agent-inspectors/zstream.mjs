import fs from 'node:fs';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const file = process.argv[2];
const outFile = process.argv[3] || 'zdump.raw.txt';
await pipeline(
  fs.createReadStream(file),
  zlib.createZstdDecompress(),
  fs.createWriteStream(outFile),
);
const st = fs.statSync(outFile);
console.log('wrote', st.size, 'bytes ->', outFile);
