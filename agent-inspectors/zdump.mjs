// Dump a multi-frame zstd file (line count, optionally only matching lines).
//
// Usage:
//   node zdump.mjs <file.zstd> [needle ...] [-o outFile]
//
// Every frame is decoded, not just the first one. ZOUT is still honoured as the
// output path for callers that already set it (that used to require passing a
// keyword as well, which silently ignored it).
import fs from 'node:fs';
import path from 'node:path';
import { decodeZstdFrames, requireFileBuffer, takeOutOption, UsageError, ZstdFrameError } from './zstd-frames.mjs';

function usage(message) {
  console.error(message ? `error: ${message}` : '');
  console.error('usage: node zdump.mjs <file.zstd> [needle ...] [-o outFile]   (ZOUT also works)');
  process.exit(2);
}

try {
  const { rest, out } = takeOutOption(process.argv.slice(2));
  const [file, ...needles] = rest;
  if (!file) usage('missing input file');

  const raw = requireFileBuffer(file);
  const decoded = decodeZstdFrames(raw);
  const text = decoded.text;
  const lines = text.split('\n').filter(Boolean);

  const outLines = [];
  // Keep `lines: N` as the first line: callers (and the test suite) parse it.
  outLines.push('lines: ' + lines.length);
  outLines.push('frames: ' + decoded.frames + '  bytes: ' + decoded.consumed + '/' + raw.length);
  if (needles.length === 0) {
    outLines.push(lines.join('\n'));
  } else {
    for (const line of lines) {
      const low = line.toLowerCase();
      if (needles.some((n) => low.includes(n.toLowerCase()))) {
        outLines.push('---');
        outLines.push(line.length > 6000 ? line.slice(0, 6000) + '...[trunc]' : line);
      }
    }
  }

  const outFile = out || process.env.ZOUT || path.join(path.dirname(file), 'zdump.out.txt');
  fs.writeFileSync(outFile, outLines.join('\n'), 'utf8');
  console.log(`wrote ${outLines.length} chunks, ${lines.length} lines from ${decoded.frames} frame(s) -> ${outFile}`);
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
