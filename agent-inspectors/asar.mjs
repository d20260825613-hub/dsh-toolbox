import fs from 'node:fs';
import path from 'node:path';

const asarPath = process.argv[2];
if (!asarPath) {
  console.error('usage: node asar.mjs <app.asar> [needle ...]');
  process.exit(2);
}
let buf;
try {
  const st = fs.statSync(asarPath);
  if (!st.isFile()) {
    console.error(`error: not a file: ${asarPath}`);
    process.exit(2);
  }
  buf = fs.readFileSync(asarPath);
} catch (e) {
  console.error(`error: cannot read ${asarPath}: ${e.message}`);
  process.exit(2);
}
if (buf.length < 16) {
  console.error(`error: ${asarPath} is too small to be an asar archive (${buf.length} bytes)`);
  process.exit(2);
}
const needles = process.argv.slice(3);

let header;
let baseOffset;
try {
  const size = buf.readUInt32LE(4);
  if (size + 8 > buf.length) throw new Error(`header size ${size} exceeds the file (${buf.length} bytes)`);
  const headerBuf = buf.subarray(8, 8 + size);
  const jsonLen = headerBuf.readUInt32LE(4);
  const headerJson = headerBuf.subarray(8, 8 + jsonLen).toString('utf8');
  header = JSON.parse(headerJson);
  baseOffset = 8 + size;
} catch (e) {
  console.error(`error: not a readable asar archive: ${e.message}`);
  process.exit(2);
}

// Keep the unpacked flag: an unpacked entry's bytes live in
// app.asar.unpacked/<path> and the slot inside the archive is empty, so reading
// it from the blob would report another file's content as a hit.
const files = [];
(function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name;
    if (v.files) walk(v, p);
    else if (v.link) files.push({ path: p, link: v.link, size: 0, offset: 0, unpacked: false });
    else files.push({ path: p, size: v.size, offset: Number(v.offset), unpacked: v.unpacked === true });
  }
})(header, '');

console.log('files in asar:', files.length);
const unpackedDir = `${asarPath}.unpacked`;
files.sort((a, b) => b.size - a.size);
console.log('largest:');
for (const f of files.slice(0, 15)) console.log(' ', f.path, f.size, f.unpacked ? '(unpacked)' : '');

if (needles.length) {
  let hits = 0;
  let skippedBig = 0;
  let skippedBigPaths = [];
  let skippedUnpacked = 0;
  let skippedLinks = 0;
  const MAX = Number(process.env.MAXHITS || 6);
  const CTX = Number(process.env.CTX || 250);
  for (const f of files) {
    if (f.link) {
      skippedLinks += 1;
      continue;
    }
    if (!/\.(js|mjs|cjs|ts|json|html|css)$/i.test(f.path)) continue;
    if (f.size > 40_000_000) {
      // Silently skipping these made "total hits" look like a complete answer.
      skippedBig += 1;
      if (skippedBigPaths.length < 10) skippedBigPaths.push(f.path);
      continue;
    }
    let content;
    if (f.unpacked) {
      const real = path.join(unpackedDir, f.path);
      try {
        content = fs.readFileSync(real).toString('utf8');
      } catch {
        skippedUnpacked += 1;
        continue;
      }
    } else {
      content = buf.subarray(baseOffset + f.offset, baseOffset + f.offset + f.size).toString('utf8');
    }
    const low = content.toLowerCase();
    for (const n of needles) {
      let i = 0;
      let nHits = 0;
      while (nHits < MAX) {
        i = low.indexOf(n.toLowerCase(), i);
        if (i < 0) break;
        console.log('=== ' + f.path + ' @' + i + ' [' + n + ']' + (f.unpacked ? ' (unpacked)' : ''));
        console.log(content.slice(Math.max(0, i - CTX), i + CTX).replace(/\n/g, ' '));
        hits++;
        nHits++;
        i += n.length;
      }
    }
  }
  console.log('total hits', hits);
  if (skippedBig) {
    console.log(`skipped ${skippedBig} file(s) larger than 40 MB (MAXHITS/CTX do not apply to them):`);
    for (const p of skippedBigPaths) console.log('    ' + p);
    if (skippedBig > skippedBigPaths.length) console.log(`    ... and ${skippedBig - skippedBigPaths.length} more`);
  }
  if (skippedUnpacked) console.log(`skipped ${skippedUnpacked} unpacked file(s) missing from ${unpackedDir}`);
  if (skippedLinks) console.log(`skipped ${skippedLinks} symlink/link entr(ies)`);
}
