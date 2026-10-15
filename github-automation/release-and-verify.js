/**
 * Tag and release the three new projects, then verify everything from a fresh
 * clone: 17 checks that the code a stranger downloads actually runs.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ENV = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  GIT_TERMINAL_PROMPT: '0',
  PATH: `D:\\dsh\\_tools\\git\\cmd;D:\\dsh\\_tools\\gh\\bin;${path.delimiter}${process.env.PATH}`,
};

function run(tool, args, { cwd, allowFail = false, inherit = false } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd, encoding: 'utf8', env: ENV, stdio: inherit ? 'inherit' : 'pipe' })
      : spawnSync(tool, args, { cwd, encoding: 'utf8', env: ENV, stdio: inherit ? 'inherit' : 'pipe' });
  if (!allowFail && (result.error || result.status !== 0)) {
    throw new Error(`${tool} ${args.join(' ')}: ${(result.error?.message ?? result.stderr ?? '').trim().slice(0, 200)}`);
  }
  return result;
}

const PROJECTS = [
  { name: 'sumcheck', dir: 'D:\\dsh\\sumcheck', tests: ['test/manifest.test.js', 'test/cli.test.js'], command: ['count'] },
  { name: 'jsonl', dir: 'D:\\dsh\\jsonl', tests: ['test/expr.test.js', 'test/cli.test.js'], command: ['--version'] },
  { name: 'speck', dir: 'D:\\dsh\\speck', tests: ['test/speck.test.js', 'test/cli.test.js'], command: ['--version'] },
];

// 1. tag and release --------------------------------------------------------
for (const project of PROJECTS) {
  const slug = `d20260825613-hub/${project.name}`;
  const tag = 'v0.1.0';
  console.log(`\n=== ${project.name}`);

  const existing = run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: project.dir,
    allowFail: true,
  });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: project.dir }).stdout.trim();
  if (existing.status !== 0) {
    run('git', ['tag', '-a', tag, '-m', `${project.name} 0.1.0`], { cwd: project.dir });
    console.log(`  tagged ${tag} at ${head.slice(0, 7)}`);
  } else {
    console.log(`  ${tag} already exists`);
  }
  run('git', ['push', 'origin', tag], { cwd: project.dir, allowFail: true });

  const view = run('gh', ['release', 'view', tag, '--repo', slug, '--json', 'url'], { allowFail: true });
  if (view.status === 0) {
    console.log(`  release exists`);
  } else {
    const notes = path.join(project.dir, 'CHANGELOG.md');
    const created = run('gh', [
      'release', 'create', tag,
      '--repo', slug,
      '--title', `${project.name} 0.1.0`,
      '--notes-file', notes,
      '--latest',
    ]);
    console.log(`  release created: ${created.stdout.trim()}`);
  }
}

// 2. fresh clone verification ----------------------------------------------
console.log('\n--- fresh clone verification ---');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-clones-'));
try {
  for (const project of PROJECTS) {
    const slug = `d20260825613-hub/${project.name}`;
    const target = path.join(sandbox, project.name);
    run('git', ['clone', '--quiet', `https://github.com/${slug}.git`, target], { cwd: sandbox });
    const files = fs.readdirSync(target).length;
    const test = run('node', ['--test', ...project.tests], { cwd: target, allowFail: true });
    const passes = Number(/# pass (\d+)/.exec(test.stdout)?.[1] ?? /ℹ pass (\d+)/.exec(test.stdout)?.[1] ?? 0);
    const fails = Number(/# fail (\d+)/.exec(test.stdout)?.[1] ?? /ℹ fail (\d+)/.exec(test.stdout)?.[1] ?? 0);
    const smoke = run('node', ['bin/' + project.name + '.js', ...project.command], { cwd: target, allowFail: true });
    console.log(
      `${project.name.padEnd(9)} entries=${String(files).padStart(2)} tests=${passes} pass/${fails} fail  command exit=${smoke.status}`,
    );
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
