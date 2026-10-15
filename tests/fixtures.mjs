// Shared fixtures for the zstd tests: multi-frame files built with node:zlib.
import zlib from 'node:zlib';
import path from 'node:path';
import { write } from './harness.mjs';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const c = (s) => zlib.zstdCompressSync(Buffer.from(s, 'utf8'));

/**
 * Four frames: metadata, a long middle (the part that used to be lost), a tail.
 * Three lines total, so `total 3 selected N` assertions stay readable.
 */
export function threeFrameFile(dir, name = 'frames.zstd') {
  const parts = [
    '{"type":"meta","session":"abc","v":4}\n',
    JSON.stringify({ type: 'message', role: 'user', content: 'MIDDLE-FRAME-PAYLOAD '.repeat(20) }) + '\n',
    '{"type":"message","role":"assistant","content":"TAIL-FRAME-PAYLOAD"}\n',
  ];
  const all = Buffer.concat(parts.map(c));
  const file = write(path.join(dir, name), all);
  return { file, raw: all, text: parts.join(''), frames: parts.length };
}

/** A single frame holding `count` JSON lines, for tail/head tests. */
export function lineFile(dir, count = 100, name = 'lines.zstd') {
  const lines = [];
  for (let i = 1; i <= count; i += 1) lines.push(JSON.stringify({ type: 'message', role: 'user', content: `line ${i}` }));
  const text = lines.join('\n') + '\n';
  const file = write(path.join(dir, name), c(text));
  return { file, text, lines };
}

/**
 * Frame 1, then a SKIPPABLE zstd frame (magic 0x184D2A5x) whose payload contains
 * the 0x28B52FFD sequence, then frame 2.
 *
 * The skippable frame is a frame like any other, but a scanner that looks for the
 * zstd magic never sees its start — it sees the fake magic inside its payload and
 * tries to decompress there, which aborts the walk and loses the real second
 * frame. Decoding by consumed-byte count is immune to this, and this fixture is
 * the shape of the bug the audit reproduced on a real file.
 */
export function falseMagicFile(dir, name = 'false-magic.zstd') {
  const first = c('FIRST-FRAME real content\n');
  const second = c('SECOND-FRAME-PAYLOAD\n');
  const payload = Buffer.concat([Buffer.alloc(8, 0x41), MAGIC, Buffer.alloc(8, 0x42)]);
  const skippable = Buffer.alloc(8 + payload.length);
  skippable.writeUInt32LE(0x184d2a50, 0);
  skippable.writeUInt32LE(payload.length, 4);
  payload.copy(skippable, 8);

  const raw = Buffer.concat([first, skippable, second]);
  const file = write(path.join(dir, name), raw);

  let magicCount = 0;
  let at = 0;
  while ((at = raw.indexOf(MAGIC, at)) !== -1) { magicCount += 1; at += 4; }

  return { file, raw, magicCount, firstLen: first.length, second };
}
