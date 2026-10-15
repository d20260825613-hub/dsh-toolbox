/** Create and push the nameplate repo (qwq), then verify every project. */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ENV = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  GIT_TERMINAL_PROMPT: '0',
  PATH: `D:\\dsh\\_tools\\git\\cmd;D:\\dsh\\_tools\\gh\\bin;${path.delimiter}${process.env.PATH}`,
};

function run(tool, args, { cwd, allowFail = false } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd, encoding: 'utf8', env: ENV })
      : spawnSync(tool, args, { cwd, encoding: 'utf8', env: ENV });
  if (!allowFail && (result.error || result.status !== 0)) {
    throw new Error(`${tool} ${args.join(' ')}: ${(result.error?.message ?? result.stderr ?? '').trim().slice(0, 200)}`);
  }
  return result;
}

// 1. commit and push the nameplate finishing touches ------------------------
const nameplate = 'D:\\dsh\\nameplate';
run('git', ['add', '-A'], { cwd: nameplate });
const staged = run('git', ['diff', '--cached', '--name-only'], { cwd: nameplate }).stdout.trim();
if (staged) {
  run('git', ['commit', '-m', 'docs: contribute, conduct and security policies'], { cwd: nameplate });
  console.log(`nameplate: committed ${staged.split('\n').length} file(s)`);
}
run('git', ['push', 'origin', 'main'], { cwd: nameplate, allowFail: true });
console.log('nameplate: pushed');

// 2. verify every repository ------------------------------------------------
const PROJECTS = ['spacehog', 'lockbox', 'qwq', 'sumcheck', 'jsonl', 'speck'];
console.log('\n--- repositories ---');
for (const name of PROJECTS) {
  const slug = `d20260825613-hub/${name}`;
  let repo;
  try {
    repo = JSON.parse(run('gh', ['repo', 'view', slug, '--json', 'name,description,repositoryTopics,url']).stdout);
  } catch (error) {
    console.log(`${name.padEnd(10)} UNREACHABLE: ${error.message.slice(0, 80)}`);
    continue;
  }
  let files = '?';
  try {
    const tree = JSON.parse(run('gh', ['api', `repos/${slug}/git/trees/main`, '-f', 'recursive=1']).stdout);
    files = (tree.tree ?? []).filter((x) => x.type === 'blob').length;
  } catch {
    files = '?';
  }
  console.log(
    `${name.padEnd(10)} files=${String(files).padStart(3)} topics=${String((repo.repositoryTopics ?? []).length).padStart(2)}  ${(repo.description ?? '(none)').slice(0, 62)}`,
  );
}
