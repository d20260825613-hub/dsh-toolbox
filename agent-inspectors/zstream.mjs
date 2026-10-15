// Fully decode a multi-frame zstd file (DSH session dumps are frame-concatenated).
//
// Usage:
//   node zstream.mjs <file.zstd> [outFile] [-o outFile]
//
// Unlike the previous one-liner around `createZstdDecompress()`, this decodes
// EVERY frame and fails loudly (exit 1) if the tail could not be decoded, so a
// truncated session can no longer be mistaken for a complete one.
// `--allow-partial` keeps the old "write whatever decoded" behaviour on purpose.
import fs from 'node:fs';
import { decodeZstdFrames, requireFileBuffer, takeOutOption, UsageError, ZstdFrameError } from './zstd-frames.mjs';

function usage(message) {
  console.error(message ? `error: ${message}` : '');
  console.error('usage: node zstream.mjs <file.zstd> [outFile] [-o outFile] [--allow-partial]');
  process.exit(2);
}

try {
  const argv = process.argv.slice(2);
  const allowPartial = argv.includes('--allow-partial');
  const { rest, out: outOpt } = takeOutOption(argv.filter((a) => a !== '--allow-partial'));
  const [file, outArg] = rest;
  if (!file) usage('missing input file');
  const outFile = outOpt || outArg || 'zdump.raw.txt';

  const raw = requireFileBuffer(file);
  const decoded = decodeZstdFrames(raw, { allowPartial });
  fs.writeFileSync(outFile, decoded.text, 'utf8');

  console.log(
    `frames ${decoded.frames}  decoded ${decoded.consumed}/${raw.length} bytes  ` +
      `wrote ${fs.statSync(outFile).size} bytes -> ${outFile}`,
  );
  if (!decoded.complete) {
    console.error(
      `warning: stopped at offset ${decoded.stoppedAt} (${decoded.cause}); ` +
        `output is truncated, ${raw.length - decoded.consumed} byte(s) undecoded`,
    );
  }
} catch (e) {
  if (e instanceof UsageError) usage(e.message);
  if (e instanceof ZstdFrameError) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
