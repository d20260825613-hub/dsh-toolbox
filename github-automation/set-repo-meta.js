/**
 * Set each repository's About description and topics.
 *
 * Descriptions are plain: what it does, what it is built on, one thing that
 * makes it different. No slogans. Topics are lowercase and hyphenated, which is
 * what GitHub accepts.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repo = 'd20260825613-hub';

const REPOS = {
  spacehog: {
    description:
      'Audit a directory tree and report what is taking up space: duplicate files, the largest files, junk, sparse files and empty folders. Zero dependencies, report-only, never deletes.',
    topics: [
      'disk-space',
      'disk-usage',
      'duplicate-files',
      'duplicate-detection',
      'cleanup',
      'cli',
      'command-line-tool',
      'nodejs',
      'zero-dependencies',
      'cross-platform',
      'storage',
      'filesystem',
    ],
  },
  lockbox: {
    description:
      'Encrypt a file with a password. scrypt derives the key, AES-256-GCM encrypts in authenticated chunks, so a wrong password or an edited file is reported instead of returning garbage.',
    topics: [
      'encryption',
      'file-encryption',
      'aes-256-gcm',
      'scrypt',
      'cli',
      'command-line-tool',
      'nodejs',
      'zero-dependencies',
      'cross-platform',
      'security-tools',
      'password-based-encryption',
    ],
  },
};

function gh(args) {
  const dirs = ['D:\\dsh\\_tools\\git\\cmd', 'D:\\dsh\\_tools\\gh\\bin'].filter((d) => fs.existsSync(d));
  const extra = dirs.filter((d) => !(process.env.PATH ?? '').includes(d));
  const env = {
    ...process.env,
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    HTTP_PROXY: 'http://127.0.0.1:7897',
    ...(extra.length > 0 ? { PATH: `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` } : {}),
  };
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'gh', ...args], { encoding: 'utf8', env })
      : spawnSync('gh', args, { encoding: 'utf8', env });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`);
  }
  return result.stdout;
}

for (const [name, spec] of Object.entries(REPOS)) {
  const slug = `${repo}/${name}`;
  console.log(`\n=== ${name} ===`);

  // Temp JSON goes to %TEMP%, like set-qwq-meta.js and create-repo.js. Writing it
  // next to the script left .repo-*.json inside the repository whenever the
  // process was killed (a common outcome when `gh` hangs), where a later
  // `git add -A` could pick it up.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-meta-'));
  try {
    // Description and homepage in one call.
    const repoFile = path.join(tmp, 'repo.json');
    fs.writeFileSync(repoFile, JSON.stringify({ description: spec.description, has_issues: true }));
    gh(['api', '--method', 'PATCH', `repos/${slug}`, '--input', repoFile]);
    console.log(`  description set (${spec.description.length} chars)`);

    // Topics in one call.
    const topicFile = path.join(tmp, 'topics.json');
    fs.writeFileSync(topicFile, JSON.stringify({ names: spec.topics }));
    const result = JSON.parse(gh(['api', '--method', 'PUT', `repos/${slug}/topics`, '--input', topicFile]));
    console.log(`  topics set: ${(result.names ?? []).join(', ')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\ndone');
