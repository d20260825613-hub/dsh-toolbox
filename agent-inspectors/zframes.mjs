// Frame-by-frame diagnostic for a multi-frame zstd file.
//
// Usage:
//   node zframes.mjs <file.zstd> [outFile] [-o outFile]
//
// Frame boundaries come from the decoder's own consumed-byte count, NOT from
// scanning for the 0x28B52FFD magic: the same four bytes also occur inside
// compressed blocks, and treating one of those as the next frame start cut the
// output short while still exiting 0. The magic count is still printed, because
// a mismatch between it and the real frame count is worth knowing about.
import fs from 'node:fs';
import { ZSTD_MAGIC, decodeZstdFrames, requireFileBuffer, takeOutOption, UsageError, ZstdFrameError } from './zstd-frames.mjs';

function usage(message) {
  console.error(message ? `error: ${message}` : '');
  console.error('usage: node zframes.mjs <file.zstd> [outFile] [-o outFile] [--allow-partial]');
  process.exit(2);
}

try {
  const argv = process.argv.slice(2);
  const allowPartial = argv.includes('--allow-partial');
  const { rest, out: outOpt } = takeOutOption(argv.filter((a) => a !== '--allow-partial'));
  const [file, outArg] = rest;
  if (!file) usage('missing input file');

  const buf = requireFileBuffer(file);

  let magics = 0;
  let at = 0;
  while (true) {
    at = buf.indexOf(ZSTD_MAGIC, at);
    if (at < 0) break;
    magics += 1;
    at += 4;
  }
  console.log('file size', buf.length, 'magic count', magics);

  const decoded = decodeZstdFrames(buf, { allowPartial });
  console.log(
    'frames', decoded.frames,
    'total bytes', decoded.text.length,
    'consumed', `${decoded.consumed}/${buf.length}`,
    'offsets', decoded.frameOffsets.slice(0, 10),
  );
  if (magics > decoded.frameOffsets.length) {
    console.log(
      `note: ${magics - decoded.frameOffsets.length} magic byte sequence(s) are not frame starts ` +
        '(they sit inside compressed blocks)',
    );
  }

  if (decoded.chunks.length) {
    const outFile = outOpt || outArg || 'zdump.raw.txt';
    fs.writeFileSync(outFile, decoded.text, 'utf8');
    console.log('sample:', decoded.text.slice(0, 300));
    console.log('wrote', outFile);
  }
  if (!decoded.complete) {
    console.error(
      `warning: stopped at offset ${decoded.stoppedAt} (${decoded.cause}); ` +
        `${buf.length - decoded.consumed} byte(s) undecoded`,
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
