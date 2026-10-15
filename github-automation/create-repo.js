/**
 * Create a GitHub repository for a local project, push it, and set its
 * description and topics.
 *
 * Written once and reused because the same eight steps were being retyped per
 * project, and two of them are easy to get wrong:
 *
 *   - `gh api --input` rejects a file that starts with a byte-order mark, and
 *     `Set-Content -Encoding utf8` in Windows PowerShell writes one. JSON here
 *     is always written by Node.
 *   - the query string of an API path cannot be glued to the path argument.
 *
 * Usage: node create-repo.js <localDir> <name> <descriptionFile> [topicsFile]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [localDir, name, descriptionFile, topicsFile] = process.argv.slice(2);
if (!localDir || !name || !descriptionFile) {
  console.error('usage: node create-repo.js <localDir> <name> <descriptionFile> [topicsFile]');
  process.exit(2);
}

const OWNER = 'd20260825613-hub';
const slug = `${OWNER}/${name}`;
const root = path.resolve(localDir);
const description = fs.readFileSync(descriptionFile, 'utf8').trim();
const topics = topicsFile ? JSON.parse(fs.readFileSync(topicsFile, 'utf8')) : [];

const GIT = 'D:\\dsh\\_tools\\git\\cmd\\git.exe';
const ENV = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  GIT_TERMINAL_PROMPT: '0',
  PATH: `D:\\dsh\\_tools\\git\\cmd;D:\\dsh\\_tools\\gh\\bin;${path.delimiter}${process.env.PATH}`,
};

function run(tool, args, { allowFail = false, cwd = root } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd, encoding: 'utf8', env: ENV })
      : spawnSync(tool, args, { cwd, encoding: 'utf8', env: ENV });
  if (!allowFail && (result.error || result.status !== 0)) {
    throw new Error(`${tool} ${args.join(' ')}: ${(result.error?.message ?? result.stderr ?? result.stdout ?? '').trim().slice(0, 300)}`);
  }
  return result;
}

const gh = (args, options) => run('gh', args, options);

console.log(`=== ${name}`);

// 1. local commit ----------------------------------------------------------
if (!fs.existsSync(path.join(root, '.git'))) {
  run(GIT, ['init', '-b', 'main']);
  console.log('  git init');
}
run(GIT, ['add', '-A']);
const staged = run(GIT, ['diff', '--cached', '--name-only']).stdout.trim();
if (staged) {
  const count = staged.split('\n').length;
  run(GIT, ['commit', '-m', `chore: ${name} 0.1.0`]);
  console.log(`  committed ${count} file(s)`);
} else {
  console.log('  nothing new to commit');
}

// 2. remote ----------------------------------------------------------------
const view = gh(['repo', 'view', slug, '--json', 'name'], { allowFail: true });
if (view.status !== 0) {
  gh(['repo', 'create', name, '--public', '--description', description]);
  console.log('  created the repository');
} else {
  console.log('  repository already exists');
}

const remotes = run(GIT, ['remote']).stdout;
if (!remotes.includes('origin')) {
  run(GIT, ['remote', 'add', 'origin', `https://github.com/${slug}.git`]);
}
const push = run(GIT, ['push', '-u', 'origin', 'main'], { allowFail: true });
if (push.status !== 0 && /rejected|non-fast-forward/.test(push.stderr ?? '')) {
  throw new Error('push rejected: the remote has commits this checkout does not');
}
console.log('  pushed main');

// 3. description, homepage and topics -------------------------------------
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'repo-meta-'));
try {
  const repoFile = path.join(tmp, 'repo.json');
  fs.writeFileSync(repoFile, JSON.stringify({ description, homepage: `https://github.com/${slug}`, has_issues: true }));
  gh(['api', '--method', 'PATCH', `repos/${slug}`, '--input', repoFile]);
  console.log(`  description set (${description.length} chars)`);

  if (topics.length > 0) {
    const topicFile = path.join(tmp, 'topics.json');
    fs.writeFileSync(topicFile, JSON.stringify({ names: topics }));
    const result = JSON.parse(gh(['api', '--method', 'PUT', `repos/${slug}/topics`, '--input', topicFile]).stdout);
    console.log(`  topics set: ${(result.names ?? []).length}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`  https://github.com/${slug}`);
