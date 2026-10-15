// Audit the published repositories: list suspicious (binary/junk) files.
const repos = ['local-ai-ops-toolkit', 'dsh-toolbox', '12306-ticket-radar', 'music-player'];
const token = process.env.GH_TOKEN;
const junk = /\.(exe|zip|png|ico|jpe?g|log|pyc)$|(^|\/)(logs|backup|_downloads)\//i;

for (const r of repos) {
  const res = await fetch(
    `https://api.github.com/repos/d20260825613-hub/${r}/git/trees/main?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dsh-agent' } },
  );
  const t = await res.json();
  const files = t.tree.filter((e) => e.type === 'blob');
  const bad = files.filter((e) => junk.test(e.path));
  console.log(`=== ${r}  files=${files.length}  suspicious=${bad.length}`);
  for (const e of bad.slice(0, 14)) console.log(`    ${e.path}  ${e.size || 0}B`);
}
