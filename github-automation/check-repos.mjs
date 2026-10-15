// Audit the published repositories: list suspicious (binary/junk) files.
//
// Usage: set GH_TOKEN (or GITHUB_TOKEN), then
//        node check-repos.mjs [owner] [repo ...]
import process from 'node:process';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('no token: set GH_TOKEN or GITHUB_TOKEN');
  process.exit(2);
}

const argv = process.argv.slice(2);
const owner = argv[0] || 'd20260825613-hub';
const repos = argv.length > 1 ? argv.slice(1) : ['local-ai-ops-toolkit', 'dsh-toolbox', '12306-ticket-radar', 'music-player'];
const junk = /\.(exe|zip|png|ico|jpe?g|log|pyc)$|(^|\/)(logs|backup|_downloads)\//i;

let failed = 0;
for (const r of repos) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${r}/git/trees/main?recursive=1`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'dsh-agent' },
  });
  if (!res.ok) {
    // Not checking res.ok used to surface as "Cannot read properties of
    // undefined (reading 'filter')", which says nothing about the real cause.
    const text = (await res.text()).slice(0, 200);
    console.log(`=== ${r}  HTTP ${res.status}  ${text.replace(/\s+/g, ' ')}`);
    if (res.status === 404) console.log('    (repository or main branch not found, or the token cannot see it)');
    failed += 1;
    continue;
  }
  const t = await res.json();
  if (!Array.isArray(t.tree)) {
    console.log(`=== ${r}  unexpected response (no "tree" field): ${JSON.stringify(t).slice(0, 200)}`);
    failed += 1;
    continue;
  }
  const files = t.tree.filter((e) => e.type === 'blob');
  const bad = files.filter((e) => junk.test(e.path));
  console.log(`=== ${r}  files=${files.length}  suspicious=${bad.length}`);
  for (const e of bad.slice(0, 14)) console.log(`    ${e.path}  ${e.size || 0}B`);
}

process.exit(failed === 0 ? 0 : 1);
