/**
 * Set the qwq repository description, homepage and topics.
 *
 * JSON is written by Node, not PowerShell: `Set-Content -Encoding utf8` prepends
 * a byte-order mark, and `gh api --input` then fails with "Problems parsing
 * JSON". The BOM is invisible in an editor, which is what makes it a good trap.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const SLUG = 'd20260825613-hub/qwq';
const DESCRIPTION =
  'Audit how a repository looks to a stranger: missing files, a thin README, manifest gaps, committed secrets, conflicting lockfiles. Also generates README banners and badges as plain SVG, entirely offline.';
const TOPICS = [
  'readme',
  'badge',
  'banner',
  'svg',
  'repository',
  'audit',
  'cli',
  'nodejs',
  'zero-dependencies',
  'developer-tools',
  'documentation',
  'linter',
];

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwq-meta-'));
try {
  const repoFile = path.join(tmp, 'repo.json');
  fs.writeFileSync(repoFile, JSON.stringify({ description: DESCRIPTION, homepage: `https://github.com/${SLUG}`, has_issues: true }));
  gh(['api', '--method', 'PATCH', `repos/${SLUG}`, '--input', repoFile]);
  console.log(`description set (${DESCRIPTION.length} chars)`);

  const topicFile = path.join(tmp, 'topics.json');
  fs.writeFileSync(topicFile, JSON.stringify({ names: TOPICS }));
  const result = JSON.parse(gh(['api', '--method', 'PUT', `repos/${SLUG}/topics`, '--input', topicFile]));
  console.log(`topics set: ${(result.names ?? []).join(', ')}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
