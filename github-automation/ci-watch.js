/**
 * Wait for a commit's CI checks to settle, then print the outcome.
 *
 * The package job runs on three platforms and each takes minutes, so polling in
 * the foreground would just block. Run this in the background and read the
 * output later.
 *
 * Usage: node ci-watch.js [sha] [--timeout-min 20]
 */

import { apiRequest, resolveToken } from './gh-tunnel.js';
import { numberOption, parseOptions } from './cli-flags.mjs';

let args;
let timeoutMin;
try {
  // The sha is the only positional argument; --timeout-min takes a value.
  const parsed = parseOptions(process.argv.slice(2), []);
  args = parsed.positionals;
  timeoutMin = numberOption(parsed.options, '--timeout-min', 20, { min: 1 });
} catch (e) {
  console.error(`error: ${e.message}`);
  console.error('usage: node ci-watch.js [sha] [--timeout-min 20]');
  process.exit(2);
}
const sha = args[0] || 'HEAD';

const TOKEN = resolveToken();
const REPO = 'd20260825613-hub/spacehog';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let i = 0; i < 6; i += 1) {
    try {
      const r = await apiRequest('GET', path, { token: TOKEN });
      if (r.status === 200) return r.body;
      throw new Error(`status ${r.status}`);
    } catch (e) {
      if (i === 5) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

let target = sha;
if (sha === 'HEAD') {
  const c = await get(`/repos/${REPO}/commits/main`);
  target = c.sha;
}
console.log(`watching ${target} (timeout ${timeoutMin} min)`);

const deadline = Date.now() + timeoutMin * 60 * 1000;
let last = '';

while (Date.now() < deadline) {
  const j = await get(`/repos/${REPO}/commits/${target}/check-runs`);
  const runs = j.check_runs || [];
  const done = runs.filter((r) => r.status === 'completed');
  const failed = done.filter((r) => !['success', 'neutral', 'skipped'].includes(r.conclusion));
  const pending = runs.filter((r) => r.status !== 'completed');

  const summary = `  ${done.length}/${runs.length} complete, ${failed.length} failed, ${pending.length} pending`;
  if (summary !== last) {
    console.log(new Date().toISOString().slice(11, 19) + summary);
    last = summary;
  }

  if (runs.length > 0 && pending.length === 0) {
    console.log('\nfinal results:');
    for (const r of runs.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${r.conclusion === 'success' ? 'PASS' : r.conclusion.toUpperCase().padEnd(6)}  ${r.name}`);
    }
    console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
    process.exit(failed.length === 0 ? 0 : 1);
  }
  await sleep(15000);
}

console.log('timed out waiting for checks');
process.exit(2);
