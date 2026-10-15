// ci-watch-all.js argument parsing.
//
// The bug: `args.filter((a, i) => !a.startsWith('--') && i !== timeoutIndex + 1)`
// used the option's index to also drop its value, so when --timeout-min was
// ABSENT (index -1) it dropped the first repository too. With one repository the
// run queried nothing at all, printed "all repositories green" and exited 0.
//
// These cases exercise parseArgs directly (no network) and then the CLI, where a
// usage error must exit 2 before any request is attempted.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, describe, node, test } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'github-automation', 'ci-watch-all.js');
const mod = () => import(new URL('../github-automation/ci-watch-all.js', import.meta.url).href);

describe('ci-watch-all :: parseArgs');

test('collects every repository when --timeout-min is absent', async () => {
  const { parseArgs } = await mod();
  assert.deepEqual(parseArgs(['ownerA/repoA']).repos, ['ownerA/repoA']);
  assert.deepEqual(parseArgs(['ownerA/repoA', 'ownerB/repoB']).repos, ['ownerA/repoA', 'ownerB/repoB']);
  assert.equal(parseArgs(['ownerA/repoA']).timeoutMin, 40, 'default timeout');
});

test('collects every repository when --timeout-min is present, wherever it sits', async () => {
  const { parseArgs } = await mod();
  assert.deepEqual(parseArgs(['--timeout-min', '5', 'ownerA/repoA', 'ownerB/repoB']).repos, ['ownerA/repoA', 'ownerB/repoB']);
  assert.equal(parseArgs(['--timeout-min', '5', 'ownerA/repoA']).timeoutMin, 5);
  assert.deepEqual(parseArgs(['ownerA/repoA', '--timeout-min', '7', 'ownerB/repoB']).repos, ['ownerA/repoA', 'ownerB/repoB']);
  assert.deepEqual(parseArgs(['ownerA/repoA', '--timeout-min', '7']).repos, ['ownerA/repoA']);
  assert.equal(parseArgs(['ownerA/repoA', '--timeout-min', '7']).timeoutMin, 7);
});

test('the timeout value is never mistaken for a repository', async () => {
  const { parseArgs } = await mod();
  const { repos } = parseArgs(['--timeout-min', '30', 'a/b']);
  assert.ok(!repos.includes('30'), repos.join(','));
});

test('an empty repository list is an error, not a green run', async () => {
  const { parseArgs } = await mod();
  assert.throws(() => parseArgs([]), /no repositories/);
  assert.throws(() => parseArgs(['--timeout-min', '10']), /no repositories/);
});

test('a missing or non-numeric timeout value throws', async () => {
  const { parseArgs } = await mod();
  assert.throws(() => parseArgs(['a/b', '--timeout-min']), /missing value/);
  assert.throws(() => parseArgs(['a/b', '--timeout-min', 'abc']), /must be a number/);
  assert.throws(() => parseArgs(['a/b', '--timeout-min', '0']), /must be a number/);
  assert.throws(() => parseArgs(['a/b', '--timeout-min', '-5']), /must be a number/);
});

test('a non-slug positional throws instead of being ignored', async () => {
  const { parseArgs } = await mod();
  assert.throws(() => parseArgs(['a/b', 'notaslug']), /not an owner\/repo slug/);
});

describe('ci-watch-all :: CLI');

test('no arguments exits 2 with usage (previously "all green", exit 0)', () => {
  const r = node([SCRIPT]);
  assert.equal(r.status, 2, `stdout: ${r.stdout}`);
  assert.ok(r.stderr.includes('usage:'), r.stderr);
  assert.ok(!r.stdout.includes('all repositories green'), `must not claim success: ${r.stdout}`);
});

test('--timeout-min with no value exits 2 instead of timing everything out', () => {
  const r = node([SCRIPT, 'ownerA/repoA', '--timeout-min']);
  assert.equal(r.status, 2, `stdout: ${r.stdout}`);
  assert.ok(r.stderr.includes('usage:'), r.stderr);
});

test('a single repository is actually watched, not silently dropped', () => {
  // No proxy is reachable here, so every lookup fails. The point is that the
  // script NAMES the repository it is watching and never reports green.
  const r = node([SCRIPT, '--timeout-min', '1', 'ownerA/repoA'], { timeoutMs: 120_000 });
  assert.notEqual(r.status, 0, `must not exit 0: ${r.stdout}`);
  assert.ok(r.stdout.includes('ownerA/repoA'), `the repository must be named: ${r.stdout}`);
  assert.ok(r.stdout.includes('watching 1 repositories'), r.stdout);
  assert.ok(!r.stdout.includes('all repositories green'), r.stdout);
});
