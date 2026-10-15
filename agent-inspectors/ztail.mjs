// Show the tail (or head) of a multi-frame zstd session dump, with a per-line
// summary when the lines are chat-shaped JSON.
//
// Usage:
//   node ztail.mjs <file.zstd> [tail|head|grep] [N|keyword] [-o outFile]
//
// Every frame is decoded. The count is validated: `tail abc` and `tail 0` used to
// fall through `slice(-NaN)` and dump the WHOLE session while reporting success.
import fs from 'node:fs';
import path from 'node:path';
import { decodeZstdFrames, requireFileBuffer, takeOutOption, UsageError, ZstdFrameError } from './zstd-frames.mjs';

function usage(message) {
  console.error(message ? `error: ${message}` : '');
  console.error('usage: node ztail.mjs <file.zstd> [tail|head|grep] [N|keyword] [-o outFile]   (ZOUT also works)');
  process.exit(2);
}

function summarize(line) {
  let o;
  try { o = JSON.parse(line); } catch { return line.slice(0, 300); }
  const t = o.type || o.role || o.kind || '?';
  let body = o.text || o.content || o.message || o.summary || '';
  if (typeof body !== 'string') body = JSON.stringify(body);
  return `[${t}] ${body.replace(/\s+/g, ' ').slice(0, 400)}`;
}

try {
  const { rest, out } = takeOutOption(process.argv.slice(2));
  const [file, modeArg, argArg] = rest;
  if (!file) usage('missing input file');

  const mode = modeArg || 'tail';
  if (!['tail', 'head', 'grep'].includes(mode)) {
    usage(`unknown mode "${mode}" (expected tail, head or grep)`);
  }

  let count = 40;
  if (mode !== 'grep') {
    if (argArg !== undefined) {
      count = Number(argArg);
      if (!Number.isInteger(count) || count <= 0) {
        usage(`"${argArg}" is not a positive whole number of lines`);
      }
    }
  } else if (argArg === undefined || argArg === '') {
    usage('grep needs a keyword');
  }

  const raw = requireFileBuffer(file);
  const decoded = decodeZstdFrames(raw);
  const lines = decoded.text.split('\n').filter(Boolean);

  let sel;
  if (mode === 'tail') sel = lines.slice(-count);
  else if (mode === 'head') sel = lines.slice(0, count);
  else sel = lines.filter((l) => l.toLowerCase().includes(String(argArg).toLowerCase()));

  const outFile = out || process.env.ZOUT || path.join(path.dirname(file), 'zdump.out.txt');
  const header =
    `total lines: ${lines.length}\n` +
    `frames: ${decoded.frames}  bytes: ${decoded.consumed}/${raw.length}\n` +
    `mode: ${mode}  selected: ${sel.length}\n`;
  fs.writeFileSync(outFile, header + sel.map((l, i) => `${i}| ${summarize(l)}`).join('\n'), 'utf8');
  console.log('total', lines.length, 'selected', sel.length, `(${decoded.frames} frame(s)) -> ${outFile}`);
  if (!decoded.complete) {
    console.error(`warning: only ${decoded.consumed}/${raw.length} bytes decoded (${decoded.cause})`);
  }
} catch (e) {
  if (e instanceof UsageError) usage(e.message);
  if (e instanceof ZstdFrameError) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
