// asar.mjs: unpacked entries, link entries and the 40 MB skip threshold.
//
// The bug: the parser kept only path/size/offset, so an `unpacked: true` entry
// (whose bytes live in app.asar.unpacked/, not in the archive) was searched in
// the archive body and reported a hit with ANOTHER file's content; files over
// 40 MB were skipped with no mention at all, so "total hits" read as complete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, describe, node, test, tmpdir } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'agent-inspectors', 'asar.mjs');

/**
 * Build an archive in the exact layout asar.mjs reads:
 *   u32 @4 = header size; header = [jsonLen @4][json @8]; blobs follow at 8+size,
 *   with each entry's `offset` relative to that point.
 */
function buildAsar(header, blobs) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const headerSize = 8 + json.length;
  const headerBuf = Buffer.alloc(headerSize);
  headerBuf.writeUInt32LE(json.length, 4);
  json.copy(headerBuf, 8);
  const out = Buffer.alloc(8 + headerSize + blobs.length);
  out.writeUInt32LE(headerSize, 4);
  headerBuf.copy(out, 8);
  blobs.copy(out, 8 + headerSize);
  return out;
}

function fixture() {
  const dir = tmpdir('dshtb-asar-');
  const main = Buffer.from('const NEEDLE = "in-main";\n'.repeat(4), 'utf8');
  const filler = Buffer.alloc(4096, 0x41);
  const big = Buffer.from('const NEEDLE = "in-big-bundle";', 'utf8');
  const header = {
    files: {
      'main.js': { size: main.length, offset: '0' },
      'huge.json': { size: 4096, offset: String(main.length), unpacked: true },
      vendor: { files: { 'bigbundle.js': { size: 45000000, offset: String(main.length + filler.length) } } },
      'linked.js': { link: 'main.js' },
    },
  };
  const asarPath = path.join(dir, 'app.asar');
  fs.writeFileSync(asarPath, buildAsar(header, Buffer.concat([main, filler, big])));
  const unpackedDir = `${asarPath}.unpacked`;
  fs.mkdirSync(unpackedDir, { recursive: true });
  fs.writeFileSync(path.join(unpackedDir, 'huge.json'), '{"NEEDLE":"from-unpacked"}');
  return { dir, asarPath, unpackedDir };
}

describe('asar.mjs');

test('an unpacked entry is read from app.asar.unpacked and labelled', () => {
  const { asarPath } = fixture();
  const r = node([SCRIPT, asarPath, 'NEEDLE']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('(unpacked)'), r.stdout);
  assert.ok(r.stdout.includes('from-unpacked'), 'unpacked content was read');
  assert.ok(r.stdout.includes('(unpacked)'), 'the hit is marked as unpacked');
});

test('an unpacked entry no longer reports another file\'s bytes', () => {
  const { asarPath, unpackedDir } = fixture();
  fs.rmSync(unpackedDir, { recursive: true, force: true });
  const r = node([SCRIPT, asarPath, 'NEEDLE']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('=== '));
  assert.ok(!lines.some((l) => l.includes('huge.json')), `huge.json must not match: ${lines.join(' | ')}`);
  assert.ok(r.stdout.includes('unpacked file(s) missing'), r.stdout);
});

test('files over 40 MB are reported as skipped, not silently dropped', () => {
  const { asarPath } = fixture();
  const r = node([SCRIPT, asarPath, 'NEEDLE']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('skipped 1 file(s) larger than 40 MB'), r.stdout);
  assert.ok(r.stdout.includes('/vendor/bigbundle.js'), r.stdout);
});

test('link entries are skipped and reported', () => {
  const { asarPath } = fixture();
  const r = node([SCRIPT, asarPath, 'NEEDLE']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('symlink/link entr'), r.stdout);
});

test('a junk file exits 2 with a readable error instead of a stack trace', () => {
  const dir = tmpdir('dshtb-asar-');
  const junk = path.join(dir, 'junk.asar');
  fs.writeFileSync(junk, 'this is not an asar archive at all');
  const r = node([SCRIPT, junk, 'NEEDLE']);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.ok(!/at Object\.|at Module\./.test(r.stderr), `raw stack: ${r.stderr}`);
});

test('no arguments prints usage and exits 2', () => {
  const r = node([SCRIPT]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('usage:'), r.stderr);
});
