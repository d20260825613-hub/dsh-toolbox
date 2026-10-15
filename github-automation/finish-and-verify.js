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
let failed = 0;
run('git', ['add', '-A'], { cwd: nameplate });
const staged = run('git', ['diff', '--cached', '--name-only'], { cwd: nameplate }).stdout.trim();
if (staged) {
  run('git', ['commit', '-m', 'docs: contribute, conduct and security policies'], { cwd: nameplate });
  console.log(`nameplate: committed ${staged.split('\n').length} file(s)`);
}
// allowFail keeps the verification below running, but the exit code has to
// reflect the failure: printing "pushed" for a rejected or unauthenticated push
// is how a broken release was reported as a successful one.
const push = run('git', ['push', 'origin', 'main'], { cwd: nameplate, allowFail: true });
if (push.error || push.status !== 0) {
  failed += 1;
  console.error(`nameplate: push FAILED (exit ${push.status ?? 'spawn error'})`);
  const detail = (push.error?.message ?? push.stderr ?? push.stdout ?? '').trim();
  if (detail) console.error(detail.slice(0, 400));
} else {
  console.log('nameplate: pushed');
}

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
    failed += 1;
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

if (failed > 0) {
  console.error(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log('\nall good');
