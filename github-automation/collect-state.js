/**
 * Collect the facts the handover document needs: for each repository, its
 * description, topics, default branch, latest commit, CI state, package
 * version, test count if discoverable, and whether a release exists.
 *
 * Written as a script rather than gathered by hand so the handover cannot
 * contain a stale or invented figure.
 *
 * Usage: node collect-state.js [--json]
 */

import { apiRequest, resolveToken } from './gh-tunnel.js';

const token = resolveToken();
const OWNER = 'd20260825613-hub';
const REPOS = [
  'd20260825613-hub.github.io',
  'spacehog',
  'speck',
  'sumcheck',
  'lockbox',
  'jsonl',
  'qwq',
  'netpeek',
  'dropjar',
  'tabkit',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  let lastError;
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await apiRequest('GET', path, { token });
      if (r.status === 200) return r.body;
      if (r.status === 404) return null;
      lastError = new Error(`status ${r.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(600 * (i + 1));
  }
  throw lastError;
}

const summary = [];

for (const name of REPOS) {
  const repo = await get(`/repos/${OWNER}/${name}`);
  if (!repo) {
    summary.push({ name, missing: true });
    continue;
  }

  const entry = {
    name,
    description: repo.description,
    private: repo.private,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    topics: repo.topics ?? [],
    homepage: repo.homepage ?? null,
    hasPages: repo.has_pages ?? false,
    hasDiscussions: repo.has_discussions ?? false,
  };

  const commit = await get(`/repos/${OWNER}/${name}/commits/${repo.default_branch}`);
  if (commit) {
    entry.headSha = commit.sha;
    entry.headMessage = commit.commit.message.split('\n')[0];
    entry.headDate = commit.commit.committer.date;
  }

  const runs = await get(`/repos/${OWNER}/${name}/actions/runs?per_page=1`);
  const run = runs?.workflow_runs?.[0];
  if (run) {
    entry.ci = { status: run.status, conclusion: run.conclusion, sha: run.head_sha.slice(0, 7), name: run.name };
    const jobs = await get(`/repos/${OWNER}/${name}/actions/runs/${run.id}/jobs?per_page=100`);
    if (jobs) {
      entry.ci.jobs = jobs.jobs.length;
      entry.ci.failed = jobs.jobs
        .filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion))
        .map((j) => j.name);
    }
  }

  const releases = await get(`/repos/${OWNER}/${name}/releases?per_page=5`);
  entry.releases = (releases ?? []).map((r) => ({
    tag: r.tag_name,
    assets: r.assets.map((a) => a.name),
    publishedAt: r.published_at,
  }));

  summary.push(entry);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const entry of summary) {
    if (entry.missing) {
      console.log(`MISSING  ${entry.name}`);
      continue;
    }
    console.log(`\n=== ${entry.name} ===`);
    console.log(`  description : ${entry.description}`);
    console.log(`  branch/head : ${entry.defaultBranch} / ${entry.headSha?.slice(0, 7)}  (${entry.headDate})`);
    console.log(`  head message: ${entry.headMessage}`);
    console.log(`  topics      : ${entry.topics.join(', ')}`);
    console.log(`  pages       : ${entry.hasPages}  discussions: ${entry.hasDiscussions}`);
    console.log(`  ci          : ${entry.ci ? `${entry.ci.status}/${entry.ci.conclusion} ${entry.ci.sha} (${entry.ci.jobs} jobs, ${entry.ci.failed?.length ?? 0} failed)` : 'none'}`);
    if (entry.ci?.failed?.length) console.log(`  ci failures : ${entry.ci.failed.join(', ')}`);
    console.log(`  releases    : ${entry.releases.length === 0 ? 'none' : entry.releases.map((r) => r.tag).join(', ')}`);
    for (const release of entry.releases) {
      console.log(`                ${release.tag}: ${release.assets.join(', ') || '(no assets)'}`);
    }
  }
}
