/**
 * Summarise the latest CI state of several repositories in one call.
 *
 * Usage: node ci-status.js owner/repo [...]
 */

import { apiRequest, resolveToken } from './gh-tunnel.js';

const token = resolveToken();
const slug = process.argv.slice(2);

if (slug.length === 0) {
  // No repositories means the loop below would not run at all; exiting 0 with no
  // output made "nothing was checked" look like "everything is fine".
  console.error('usage: node ci-status.js owner/repo [owner/repo ...]');
  process.exit(2);
}

let failed = 0;
for (const repo of slug) {
  const runs = await apiRequest('GET', `/repos/${repo}/actions/runs?per_page=1`, { token });
  if (runs.status !== 200) {
    console.log(`${repo.padEnd(48)} runs lookup -> ${runs.status}`);
    failed += 1;
    continue;
  }
  const run = runs.body.workflow_runs?.[0];
  if (!run) {
    console.log(`${repo.padEnd(48)} no workflow runs yet`);
    continue;
  }
  const jobs = await apiRequest('GET', `/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, { token });
  const list = jobs.status === 200 ? jobs.body.jobs : [];
  const counts = {};
  for (const job of list) {
    const key = job.conclusion || job.status;
    counts[key] = (counts[key] || 0) + 1;
  }
  console.log(
    `${repo.padEnd(48)} ${String(run.status).padEnd(11)} ${(run.conclusion || '-').padEnd(9)} ` +
      `${run.head_sha.slice(0, 7)}  ${JSON.stringify(counts)}`,
  );
  for (const job of list.filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion))) {
    console.log(`    FAILED: ${job.name}`);
    failed += 1;
  }
}

process.exit(failed === 0 ? 0 : 1);
