// Multi-frame zstd decoding: the regression the whole z* family was written for.
//
// DSH's session.v4.jsonl.zstd is several zstd frames concatenated.
// zstdDecompressSync()/createZstdDecompress() stop after the first frame without
// an error, so every one of these scripts used to emit a truncated session and
// still exit 0.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { assert, describe, node, test, tmpdir } from './harness.mjs';
import { falseMagicFile, lineFile, threeFrameFile } from './fixtures.mjs';

const INSPECTORS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent-inspectors');
const script = (name) => path.join(INSPECTORS, name);
const framesModule = () => import(new URL('../agent-inspectors/zstd-frames.mjs', import.meta.url).href);

describe('zstd-frames decoder');

test('decodes every frame, not just the first', async () => {
  const dir = tmpdir();
  const { file, text, frames } = threeFrameFile(dir);
  const { decodeZstdFrames } = await framesModule();
  const d = decodeZstdFrames(fs.readFileSync(file));
  assert.equal(d.frames, frames);
  assert.equal(d.complete, true);
  assert.equal(d.consumed, fs.statSync(file).size);
  assert.equal(d.text, text);
  assert.ok(d.text.includes('MIDDLE-FRAME-PAYLOAD'), 'middle frame content present');
  assert.ok(d.text.includes('TAIL-FRAME-PAYLOAD'), 'tail frame content present');
});

test('node zlib really does stop at frame one (the root cause)', () => {
  const dir = tmpdir();
  const { file, text } = threeFrameFile(dir);
  const raw = fs.readFileSync(file);
  const first = zlib.zstdDecompressSync(raw).toString('utf8');
  assert.notEqual(first, text, 'single call must NOT return the whole file');
  assert.ok(!first.includes('TAIL-FRAME-PAYLOAD'));
});


test('a truncated tail throws instead of silently succeeding', async () => {
  const dir = tmpdir();
  const { file, raw } = threeFrameFile(dir);
  const { decodeZstdFrames, ZstdFrameError } = await import(new URL('../agent-inspectors/zstd-frames.mjs', import.meta.url));
  const cut = fs.readFileSync(file).subarray(0, raw.length - 4);
  assert.throws(() => decodeZstdFrames(cut), ZstdFrameError);
  const partial = decodeZstdFrames(cut, { allowPartial: true });
  assert.equal(partial.complete, false);
  assert.ok(partial.consumed < cut.length);
});

test('non-zstd input is reported, not half-decoded', async () => {
  const dir = tmpdir();
  const bad = path.join(dir, 'garbage.zstd');
  fs.writeFileSync(bad, 'this is not zstd at all');
  const r = node([script('zstream.mjs'), bad, path.join(dir, 'out.txt')]);
  assert.notEqual(r.status, 0, 'exit code must be non-zero');
});

describe('zstream.mjs (CLI)');

test('writes every frame of a multi-frame file', () => {
  const dir = tmpdir();
  const { file, text } = threeFrameFile(dir);
  const out = path.join(dir, 'out.txt');
  const r = node([script('zstream.mjs'), file, out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), text);
  assert.ok(r.stdout.includes('frames 3'), `expected frame count in stdout: ${r.stdout}`);
});

test('-o selects the output path', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const out = path.join(dir, 'chosen.txt');
  const r = node([script('zstream.mjs'), file, '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
});

test('no arguments prints usage and exits 2 (no raw stack)', () => {
  const r = node([script('zstream.mjs')]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('usage:'), r.stderr);
  assert.ok(!/at Object\./.test(r.stderr), 'no Node stack trace');
});

test('a missing file prints usage, not ENOENT stack', () => {
  const r = node([script('zstream.mjs'), path.join(tmpdir(), 'nope.zstd')]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('no such file'), r.stderr);
});

describe('zdump.mjs (CLI)');

test('sees lines from every frame', () => {
  const dir = tmpdir();
  const { file, text } = threeFrameFile(dir);
  const out = path.join(dir, 'dump.txt');
  const r = node([script('zdump.mjs'), file, '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  const written = fs.readFileSync(out, 'utf8');
  const declared = Number(/^lines: (\d+)/.exec(written)?.[1]);
  const expected = text.split('\n').filter(Boolean).length;
  assert.equal(declared, expected, `line count ${declared} != ${expected}`);
  assert.ok(written.includes('TAIL-FRAME-PAYLOAD'), 'tail frame is in the dump');
});

test('keyword filter finds content in a later frame', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const out = path.join(dir, 'dump.txt');
  const r = node([script('zdump.mjs'), file, 'tail-frame-payload', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(out, 'utf8').includes('TAIL-FRAME-PAYLOAD'));
});

test('ZOUT is honoured even without a keyword (it used to be ignored)', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const zout = path.join(dir, 'zout-target.txt');
  const r = node([script('zdump.mjs'), file], { env: { ZOUT: zout } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(zout), 'ZOUT path was written');
  assert.ok(!fs.existsSync('zdump.out.txt'), 'must not litter the repo directory');
});

test('default output lands next to the input, not in the cwd', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const r = node([script('zdump.mjs'), file]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'zdump.out.txt')), 'written beside the input file');
});

describe('ztail.mjs (CLI)');

test('tail counts lines across all frames', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const out = path.join(dir, 'tail.txt');
  const r = node([script('ztail.mjs'), file, 'tail', '2', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('total 3 selected 2'), r.stdout);
  assert.ok(fs.readFileSync(out, 'utf8').includes('TAIL-FRAME-PAYLOAD'));
});

test('head counts lines', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const out = path.join(dir, 'head.txt');
  const r = node([script('ztail.mjs'), file, 'head', '1', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('total 3 selected 1'), r.stdout);
});

test('grep filters', () => {
  const dir = tmpdir();
  const { file } = threeFrameFile(dir);
  const out = path.join(dir, 'grep.txt');
  const r = node([script('ztail.mjs'), file, 'grep', 'middle-frame', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('selected 1'), r.stdout);
});

test('a non-numeric count is rejected instead of dumping everything', () => {
  const dir = tmpdir();
  const { file } = lineFile(dir, 100);
  const r = node([script('ztail.mjs'), file, 'tail', 'abc']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
  assert.ok(!fs.existsSync(path.join(dir, 'zdump.out.txt')), 'must not write output on a usage error');
});

test('a zero count is rejected (slice(-0) used to mean "everything")', () => {
  const dir = tmpdir();
  const { file } = lineFile(dir, 100);
  const r = node([script('ztail.mjs'), file, 'tail', '0']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
});

test('an unknown mode is rejected instead of falling through to "all lines"', () => {
  const dir = tmpdir();
  const { file } = lineFile(dir, 100);
  const r = node([script('ztail.mjs'), file, 'GREPMODE', 'line 5']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stdout}`);
});

test('tail N really selects N of 100 lines', () => {
  const dir = tmpdir();
  const { file } = lineFile(dir, 100);
  const out = path.join(dir, 'tail.txt');
  const r = node([script('ztail.mjs'), file, 'tail', '7', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('total 100 selected 7'), r.stdout);
});

describe('zinfo.mjs (CLI)');

test('reports the multi-frame shape, not just the metadata frame', () => {
  const dir = tmpdir();
  const { file, raw, text } = threeFrameFile(dir);
  const r = node([script('zinfo.mjs'), file]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`file bytes: ${raw.length}`), r.stdout);
  assert.ok(r.stdout.includes('frames: 3'), r.stdout);
  assert.ok(r.stdout.includes(`decompressed bytes: ${text.length}`), r.stdout);
});

test('no arguments prints usage', () => {
  const r = node([script('zinfo.mjs')]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('usage:'));
});

describe('zframes.mjs (CLI)');

test('does not mistake magic bytes inside another frame for a frame start', () => {
  const dir = tmpdir();
  const fx = falseMagicFile(dir);
  const out = path.join(dir, 'out.txt');
  const r = node([script('zframes.mjs'), fx.file, out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('frames 3'), `expected 3 frames (2 real + 1 skippable): ${r.stdout}`);
  assert.ok(r.stdout.includes(`magic count ${fx.magicCount}`), r.stdout);
  assert.ok(fs.readFileSync(out, 'utf8').includes('SECOND-FRAME-PAYLOAD'), 'second frame was not lost');
});

test('a truncated file exits non-zero instead of reporting a partial decode as OK', () => {
  const dir = tmpdir();
  const fx = falseMagicFile(dir);
  const truncated = path.join(dir, 'trunc.zstd');
  fs.writeFileSync(truncated, fs.readFileSync(fx.file).subarray(0, fx.firstLen + 4));
  const r = node([script('zframes.mjs'), truncated, path.join(dir, 'o.txt')]);
  assert.notEqual(r.status, 0, `expected non-zero exit, got ${r.status}: ${r.stdout}`);
  assert.ok(r.stderr.includes('only'), r.stderr);
});
