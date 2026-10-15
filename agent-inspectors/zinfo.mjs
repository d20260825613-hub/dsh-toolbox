// Structural summary of a multi-frame zstd session dump.
//
// Usage:
//   node zinfo.mjs <file.zstd>
//
// Decodes every frame first. The old version decompressed only the leading
// metadata frame and reported that as the whole file.
import { decodeZstdFrames, requireFileBuffer, UsageError, ZstdFrameError } from './zstd-frames.mjs';

function usage(message) {
  console.error(message ? `error: ${message}` : '');
  console.error('usage: node zinfo.mjs <file.zstd>');
  process.exit(2);
}

try {
  const file = process.argv[2];
  if (!file) usage('missing input file');

  const raw = requireFileBuffer(file);
  const decoded = decodeZstdFrames(raw);
  const text = decoded.text;
  console.log('file bytes:', raw.length, ' frames:', decoded.frames, ' decompressed bytes:', text.length);
  if (decoded.frameOffsets.length > 1) {
    console.log('frame offsets:', decoded.frameOffsets.slice(0, 20).join(', ') + (decoded.frameOffsets.length > 20 ? ' …' : ''));
  }
  if (!decoded.complete) {
    console.error(`warning: only ${decoded.consumed}/${raw.length} bytes decoded (${decoded.cause})`);
  }

  // A single-frame metadata dump parses as one JSON object; a session dump is one
  // JSON object per line, so try the whole text first and then report the shape.
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* a session dump is jsonl, not one object */
  }
  if (data === null) {
    const lines = text.split('\n').filter(Boolean);
    const shapes = new Map();
    for (const line of lines) {
      let o;
      try { o = JSON.parse(line); } catch { shapes.set('(non-json line)', (shapes.get('(non-json line)') || 0) + 1); continue; }
      const t = o.type || o.role || o.kind || '(no type)';
      shapes.set(t, (shapes.get(t) || 0) + 1);
    }
    console.log('not a single JSON object: jsonl with', lines.length, 'line(s)');
    console.log('line kinds:', JSON.stringify(Object.fromEntries(shapes)));
  } else {
    console.log('top-level keys:', Object.keys(data));
    for (const k of Object.keys(data)) {
      const v = data[k];
      console.log(k, Array.isArray(v) ? `array(${v.length})` : typeof v);
      if (Array.isArray(v) && v.length) console.log('  first item keys:', Object.keys(v[0] || {}).join(','));
    }
  }
} catch (e) {
  if (e instanceof UsageError) usage(e.message);
  if (e instanceof ZstdFrameError) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
