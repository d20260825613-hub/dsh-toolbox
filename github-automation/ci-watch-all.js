/**
 * Watch the latest CI run of several repositories until all of them settle.
 *
 * Runs in the background while other work continues; prints a final table with
 * any failed job names so nothing has to be dug out of the API afterwards.
 *
 * Usage: node ci-watch-all.js owner/repo [...] [--timeout-min 40]
 */

import { apiRequest, resolveToken } from './gh-tunnel.js';

const args = process.argv.slice(2);
const timeoutIndex = args.indexOf('--timeout-min');
const timeoutMin = timeoutIndex === -1 ? 40 : Number(args[timeoutIndex + 1]);
const repos = args.filter((a, i) => !a.startsWith('--') && i !== timeoutIndex + 1);

const token = resolveToken();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with a few retries; the tunnel drops connections regularly. */
async function get(path) {
  let lastError;
  for (let i = 0; i < 6; i += 1) {
    try {
      const r = await apiRequest('GET', path, { token });
      if (r.status === 200) return r.body;
      lastError = new Error(`status ${r.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(800 * (i + 1));
  }
  throw lastError;
}

const pending = new Set(repos);
const results = new Map();
const deadline = Date.now() + timeoutMin * 60 * 1000;

while (pending.size > 0 && Date.now() < deadline) {
  for (const repo of [...pending]) {
    let run;
    try {
      const runs = await get(`/repos/${repo}/actions/runs?per_page=1`);
      run = runs.workflow_runs?.[0];
    } catch (error) {
      console.log(`${new Date().toISOString().slice(11, 19)} ${repo}: lookup failed (${error.message})`);
      continue;
    }
    if (!run || run.status !== 'completed') continue;

    const jobs = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const failed = jobs.jobs.filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion));
    results.set(repo, { sha: run.head_sha, jobs: jobs.jobs, failed, conclusion: run.conclusion });
    pending.delete(repo);
    console.log(
      `${new Date().toISOString().slice(11, 19)} ${repo}: ${run.conclusion} (${jobs.jobs.length} jobs, ${failed.length} failed)`,
    );
  }
  if (pending.size > 0) await sleep(20_000);
}

console.log('\n================ final CI status ================');
let bad = 0;
for (const repo of repos) {
  const result = results.get(repo);
  if (!result) {
    console.log(`  TIMEOUT  ${repo}`);
    bad += 1;
    continue;
  }
  const ok = result.failed.length === 0;
  if (!ok) bad += 1;
  console.log(`  ${ok ? 'PASS    ' : 'FAIL    '} ${repo}  ${result.sha.slice(0, 7)}  (${result.jobs.length} jobs)`);
  for (const job of result.failed) console.log(`             failed: ${job.name}`);
}
console.log(bad === 0 ? '\nall repositories green' : `\n${bad} repository(ies) not green`);
process.exit(bad === 0 ? 0 : 1);
