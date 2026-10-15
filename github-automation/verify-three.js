/** Final verification across the three repositories. */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const env = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  PATH: `D:\\dsh\\_tools\\git\\cmd;D:\\dsh\\_tools\\gh\\bin;${path.delimiter}${process.env.PATH}`,
};

function gh(args, { optional = false } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'gh', ...args], { encoding: 'utf8', env })
      : spawnSync('gh', args, { encoding: 'utf8', env });
  if (result.status !== 0) {
    if (optional) return null;
    throw new Error(`gh ${args.join(' ')}: ${(result.stderr || result.stdout).slice(0, 150)}`);
  }
  return result.stdout;
}

const WANTED = ['README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md'];

for (const name of ['spacehog', 'lockbox', 'qwq']) {
  const slug = `d20260825613-hub/${name}`;
  const repo = JSON.parse(gh(['repo', 'view', slug, '--json', 'name,description,repositoryTopics']));
  // The query string is passed as a field, not glued to the path: `gh` mangles
  // a bare `path?key=value` argument.
  const tree = JSON.parse(gh(['api', `repos/${slug}/git/trees/main`, '-f', 'recursive=1']));
  const files = (tree.tree ?? []).filter((x) => x.type === 'blob');
  const releases = JSON.parse(gh(['api', `repos/${slug}/releases`]));
  const profile = gh(['api', `repos/${slug}/community/profile`], { optional: true });

  console.log(`\n=== ${name}`);
  console.log(`  description : ${(repo.description ?? '(none)').slice(0, 88)}`);
  console.log(`  topics      : ${(repo.repositoryTopics ?? []).length}`);
  console.log(`  files       : ${files.length}`);
  console.log(`  health      : ${profile ? `${JSON.parse(profile).health_percentage}%` : 'unavailable'}`);
  const missing = WANTED.filter((f) => !files.some((x) => x.path === f));
  console.log(`  missing     : ${missing.length === 0 ? 'none of the usual four' : missing.join(', ')}`);
  console.log(
    `  releases    : ${releases.length === 0 ? 'none' : releases.map((r) => `${r.tag_name} (${r.body ? `${r.body.length} chars` : 'EMPTY'})`).join(', ')}`,
  );
}
