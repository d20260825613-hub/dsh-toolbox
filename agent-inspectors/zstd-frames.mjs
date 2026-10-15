// Shared decoder for zstd files that hold SEVERAL frames back to back.
//
// DSH's session.v4.jsonl.zstd is such a file. `zstdDecompressSync(buf)` (and
// `createZstdDecompress()`) stop after the first frame: they neither decode the
// rest nor complain about the bytes they ignored, so every caller silently got a
// truncated session. The stream engine does know where a frame ends — with
// `{ info: true }` it hands back the engine, whose `bytesWritten` is exactly the
// number of input bytes the frame occupied. That is the only trustworthy frame
// boundary; scanning for the 0x28B52FFD magic also finds those 4 bytes inside
// compressed blocks and would cut the file short.
import fs from 'node:fs';
import zlib from 'node:zlib';

export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const DEFAULT_MAX_FRAMES = 200_000;

/**
 * A skippable frame: magic 0x184D2A5x + 4-byte little-endian payload size.
 * node:zlib does not step over these on its own, so the walker must. Returns the
 * total frame length, or 0 when `buf` does not start with one.
 */
export function skippableFrameLength(buf, offset = 0) {
  if (offset + 8 > buf.length) return 0;
  const magic = buf.readUInt32LE(offset);
  if (magic < 0x184d2a50 || magic > 0x184d2a5f) return 0;
  const len = 8 + buf.readUInt32LE(offset + 4);
  return offset + len <= buf.length ? len : 0;
}

/** Argument / usage problems; the CLI turns this into `usage:` + exit 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Thrown when trailing bytes could not be decoded as a frame. */
export class ZstdFrameError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'ZstdFrameError';
    Object.assign(this, info);
  }
}

/** True when the four zstd magic bytes sit at `offset`. */
export function hasMagic(buf, offset = 0) {
  return (
    offset >= 0 &&
    offset + ZSTD_MAGIC.length <= buf.length &&
    buf.compare(ZSTD_MAGIC, 0, 4, offset, offset + 4) === 0
  );
}

/**
 * Decode every frame in `buf`.
 *
 * Returns { frames, chunks, text, consumed, complete, frameOffsets, stoppedAt,
 * cause }:
 *   frames       number of frames decoded
 *   chunks       one Buffer per frame, in file order
 *   text         all frames concatenated as UTF-8
 *   consumed     input bytes covered by the decoded frames
 *   complete     consumed === buf.length
 *   frameOffsets frame start offsets, for diagnostics
 *
 * Throws ZstdFrameError when the file is not empty and the tail could not be
 * decoded, because a silent partial decode is exactly what made the old
 * behaviour dangerous (exit code 0 over a truncated session).
 */
export function decodeZstdFrames(buf, { maxFrames = DEFAULT_MAX_FRAMES, allowPartial = false } = {}) {
  const chunks = [];
  const frameOffsets = [];
  let offset = 0;
  let stoppedAt = -1;
  let cause = null;

  while (offset < buf.length && frameOffsets.length < maxFrames) {
    // Skippable frames carry no content but are still part of the stream.
    const skip = skippableFrameLength(buf, offset);
    if (skip > 0) {
      frameOffsets.push(offset);
      chunks.push(Buffer.alloc(0));
      offset += skip;
      continue;
    }
    if (!hasMagic(buf, offset)) {
      stoppedAt = offset;
      cause = `no zstd frame at offset ${offset}`;
      break;
    }
    let decoded;
    try {
      decoded = zlib.zstdDecompressSync(buf.subarray(offset), { info: true });
    } catch (e) {
      stoppedAt = offset;
      cause = e.message;
      break;
    }
    const consumed = decoded.engine.bytesWritten;
    // A frame reporting zero consumed bytes would spin forever.
    if (!Number.isInteger(consumed) || consumed <= 0) {
      stoppedAt = offset;
      cause = `frame at offset ${offset} reported ${consumed} consumed bytes`;
      break;
    }
    frameOffsets.push(offset);
    chunks.push(decoded.buffer);
    offset += consumed;
  }

  const complete = offset === buf.length;
  if (!complete && !allowPartial) {
    throw new ZstdFrameError(
      `only ${offset}/${buf.length} bytes decoded as zstd frames ` +
        `(${chunks.length} frame(s), stopped at offset ${stoppedAt}: ${cause})`,
      { consumed: offset, total: buf.length, frames: chunks.length, frameOffsets, stoppedAt, cause },
    );
  }

  return {
    frames: chunks.length,
    chunks,
    text: Buffer.concat(chunks).toString('utf8'),
    consumed: offset,
    complete,
    frameOffsets,
    stoppedAt: complete ? -1 : stoppedAt,
    cause: complete ? null : cause,
  };
}

/** Read a path, with a usage-style error instead of a raw Node stack. */
export function requireFileBuffer(file) {
  if (!file) throw new UsageError('missing input file');
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new UsageError(`no such file: ${file}`);
  }
  if (!st.isFile()) throw new UsageError(`not a file: ${file}`);
  return fs.readFileSync(file);
}

/**
 * Parse `-o <path>` / `--out <path>` out of argv.
 * Returns { rest, out } where `rest` keeps argv order minus the option.
 */
export function takeOutOption(argv) {
  const rest = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`missing value for ${a}`);
      }
      out = value;
      i += 1;
    } else {
      rest.push(a);
    }
  }
  return { rest, out };
}
