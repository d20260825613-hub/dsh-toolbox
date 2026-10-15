/**
 * Print a failed GitHub Actions job's log, with escape sequences stripped.
 *
 * `gh run view --log-failed` only works once the whole run finishes, and the
 * per-job log endpoint returns a redirect plus ANSI codes that PowerShell
 * mangles. Doing it here keeps the output readable.
 *
 * Usage: node joblog.js <owner/repo> [runId] [--job <nameSubstring>] [--grep <regex>]
 */

import { apiRequest, resolveToken, connectTunnel } from './gh-tunnel.js';
import https from 'node:https';

const argv = process.argv.slice(2);
const slug = argv[0];
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const runId = argv.find((a) => /^\d+$/.test(a));
const nameFilter = flag('--job');
const grep = flag('--grep');

if (!slug) {
  console.error('usage: node joblog.js <owner/repo> [runId] [--job <substring>] [--grep <regex>]');
  process.exit(2);
}

const token = resolveToken();

async function jobsFor(run) {
  const r = await apiRequest('GET', `/repos/${slug}/actions/runs/${run}/jobs?per_page=100`, { token });
  if (r.status !== 200) throw new Error(`jobs lookup -> ${r.status}`);
  return r.body.jobs;
}

async function latestRun() {
  const r = await apiRequest('GET', `/repos/${slug}/actions/runs?per_page=1`, { token });
  return r.body.workflow_runs[0];
}

/** Fetch a job's log text: the endpoint 302s to a signed blob URL. */
async function jobLog(jobId) {
  const r = await apiRequest('GET', `/repos/${slug}/actions/jobs/${jobId}/logs`, { token });
  const loc = r.headers.location;
  if (!loc) return typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 500);
  const u = new URL(loc);
  const socket = await connectTunnel(u.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: u.hostname, path: u.pathname + u.search, method: 'GET', socket, agent: false, servername: u.hostname },
      (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => {
          socket.destroy();
          resolve(Buffer.concat(c).toString('utf8'));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const run = runId || (await latestRun()).id;
console.log(`run ${run} in ${slug}`);
const jobs = await jobsFor(run);

for (const job of jobs) {
  if (nameFilter && !job.name.includes(nameFilter)) continue;
  console.log(`\n=== ${job.name} : ${job.conclusion || job.status} ===`);
  const failedSteps = job.steps.filter((s) => s.conclusion === 'failure');
  for (const s of failedSteps) console.log(`  failed step: ${s.name}`);
  if (job.conclusion !== 'failure') continue;

  const text = await jobLog(job.id);
  const clean = text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''))
    .filter((l) => l.trim());

  if (grep) {
    const re = new RegExp(grep, 'i');
    const hits = clean.filter((l) => re.test(l));
    console.log(hits.slice(-40).map((l) => '  ' + l).join('\n'));
  } else {
    console.log(clean.slice(-45).map((l) => '  ' + l).join('\n'));
  }
}
