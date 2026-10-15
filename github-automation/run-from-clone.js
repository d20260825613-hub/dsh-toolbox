/** Run each tool for real inside a fresh clone of its own repository. */

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

function run(tool, args, { cwd, allowFail = true } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd, encoding: 'utf8', env: ENV })
      : spawnSync(tool, args, { cwd, encoding: 'utf8', env: ENV });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'speck-run-'));
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

try {
  // --- sumcheck ------------------------------------------------------------
  console.log('\nsumcheck, cloned from GitHub:');
  const sumcheckDir = path.join(sandbox, 'sumcheck');
  run('git', ['clone', '--quiet', 'https://github.com/d20260825613-hub/sumcheck.git', sumcheckDir], { cwd: sandbox });

  const work = path.join(sandbox, 'work');
  fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(work, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(work, 'sub', 'b.txt'), 'beta');
  const manifest = path.join(sandbox, 'm.json');

  const generated = run('node', ['bin/sumcheck.js', 'generate', work, '-m', manifest], { cwd: sumcheckDir });
  check('generate exits 0', generated.status === 0, generated.stderr.slice(0, 120));
  check('manifest was written', fs.existsSync(manifest));

  const clean = run('node', ['bin/sumcheck.js', 'verify', work, '-m', manifest, '-q'], { cwd: sumcheckDir });
  check('verify of an untouched tree exits 0', clean.status === 0, `${clean.status} ${clean.stdout.slice(0, 80)}`);
  check('verify says the files match', /all files match/.test(clean.stdout));

  fs.writeFileSync(path.join(work, 'a.txt'), 'TAMPERED');
  const changed = run('node', ['bin/sumcheck.js', 'verify', work, '-m', manifest], { cwd: sumcheckDir });
  check('verify of a tampered tree exits 1', changed.status === 1, String(changed.status));
  check('verify names the changed file', /changed\s+a\.txt/.test(changed.stdout), changed.stdout.split('\n')[0]);

  fs.writeFileSync(path.join(work, 'new.txt'), 'extra');
  const extra = run('node', ['bin/sumcheck.js', 'verify', work, '-m', manifest, '-q'], { cwd: sumcheckDir });
  check('extra content is reported', /extra/.test(extra.stdout));

  // --- jsonl ---------------------------------------------------------------
  console.log('\njsonl, cloned from GitHub:');
  const jsonlDir = path.join(sandbox, 'jsonl');
  run('git', ['clone', '--quiet', 'https://github.com/d20260825613-hub/jsonl.git', jsonlDir], { cwd: sandbox });

  const log = path.join(sandbox, 'app.jsonl');
  const lines = [];
  for (let i = 1; i <= 50; i += 1) {
    lines.push(JSON.stringify({ level: i % 5 === 0 ? 'error' : 'info', status: i % 5 === 0 ? 500 : 200, duration: i }));
  }
  fs.writeFileSync(log, `${lines.join('\n')}\n`);

  const count = run('node', ['bin/jsonl.js', 'count', log, '--where', 'level == "error"', '-q'], { cwd: jsonlDir });
  check('count with a filter returns 10', count.stdout.trim() === '10', JSON.stringify(count.stdout.trim()));

  const grouped = run('node', ['bin/jsonl.js', 'count', log, '--group-by', 'level', '--json', '-q'], { cwd: jsonlDir });
  let parsed = null;
  try {
    parsed = JSON.parse(grouped.stdout);
  } catch {
    /* reported below */
  }
  check('count --group-by --json parses', parsed !== null && parsed.total === 50, grouped.stdout.slice(0, 80));
  check('groups are complete', parsed ? Object.values(parsed.groups).reduce((a, b) => a + b, 0) === 50 : false);

  const stats = run('node', ['bin/jsonl.js', 'stats', log, '--fields', 'duration', '--json', '-q'], { cwd: jsonlDir });
  const report = JSON.parse(stats.stdout);
  check('stats reports the right mean', report.groups[0].fields.duration.mean === 25.5, String(report.groups[0].fields.duration.mean));

  const hostile = run('node', ['bin/jsonl.js', 'count', log, '--where', 'process.exit(1)'], { cwd: jsonlDir });
  check('a hostile filter is refused, not executed', hostile.status === 3, String(hostile.status));

  // --- speck ---------------------------------------------------------------
  console.log('\nspeck, cloned from GitHub:');
  const speckDir = path.join(sandbox, 'speck');
  run('git', ['clone', '--quiet', 'https://github.com/d20260825613-hub/speck.git', speckDir], { cwd: sandbox });

  // A PNG named .jpg with something appended, built by hand.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(800, 0);
  ihdr.writeUInt32BE(600, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
  const disguised = path.join(sandbox, 'holiday.jpg');
  fs.writeFileSync(disguised, Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]));

  const identify = run('node', ['bin/speck.js', 'identify', disguised], { cwd: speckDir });
  check('identify exits 2 for a mismatched name', identify.status === 2, String(identify.status));
  check('identify reports the real format', /PNG image/.test(identify.stdout));
  check('identify reports the name mismatch', /does not match/.test(identify.stdout));
  check('identify reports the appended bytes', /follow the IEND/.test(identify.stdout));

  const info = run('node', ['bin/speck.js', 'info', disguised, '--strings', '--json'], { cwd: speckDir });
  const analysis = JSON.parse(info.stdout);
  check('info finds the real dimensions', analysis.details.some((f) => f.value === '800 x 600'));
  check('info flags the embedded script tag', analysis.notable.some((n) => /script tag/.test(n.why)));

  const formats = run('node', ['bin/speck.js', 'formats'], { cwd: speckDir });
  check('formats lists the table', /40 formats/.test(formats.stdout));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exitCode = passed === checks.length ? 0 : 1;
