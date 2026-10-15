// Tiny synchronous test harness: registers tests, runs them, prints a summary.
// Kept intentionally small — this repository has no package manager on purpose.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const cases = [];
let current = '(top level)';

/** Name the group the following `test()` calls belong to. */
export function describe(name) {
  current = name;
}

/** Register a test case. `fn` may be async and may return a promise. */
export function test(name, fn) {
  cases.push({ group: current, name, fn });
}

/** Run every registered case. Returns true when all passed. */
export async function run() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    const label = `${c.group} :: ${c.name}`;
    try {
      await c.fn();
      passed += 1;
    } catch (e) {
      failures.push({ label, error: e });
    }
  }
  console.log(`\n${passed}/${cases.length} passed`);
  for (const f of failures) {
    console.error(`\nFAIL ${f.label}`);
    console.error('  ' + String(f.error?.message ?? f.error).split('\n').join('\n  '));
  }
  return failures.length === 0;
}

/** Create a scratch directory under the OS temp dir (never inside the repo). */
export function tmpdir(prefix = 'dshtb-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write a file, creating parent directories as needed. */
export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** Repo root, derived from this file's location. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a repo script with plain node, returning { status, stdout, stderr }.
 *  A hard timeout keeps a hung script (e.g. a request to a dead port) from
 *  wedging the whole suite. */
export function node(args, { cwd = repoRoot, env = {}, timeoutMs = 60_000 } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** Start a helper script as its own detached process; it must print a port. */
export function startHelper(script, env = {}) {
  const dir = tmpdir('dshtb-helper-');
  const portFile = path.join(dir, 'port');
  const logFile = path.join(dir, 'log.jsonl');
  fs.writeFileSync(portFile, '');
  fs.writeFileSync(logFile, '');
  const child = spawn(process.execPath, [path.join(repoRoot, 'tests', script)], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, MOCK_PORT_FILE: portFile, MOCK_LOG: logFile },
  });
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const text = fs.readFileSync(portFile, 'utf8').trim();
    if (text) {
      return {
        url: `http://127.0.0.1:${text}`,
        child,
        stop: () => { try { process.kill(child.pid); } catch { /* already gone */ } },
        /** Every request the helper served, oldest first. */
        requests: () =>
          fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      };
    }
    // Busy-wait is fine: this is a local port bind, typically a few milliseconds.
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},50)'], { stdio: 'ignore' });
  }
  try { process.kill(child.pid); } catch { /* already gone */ }
  throw new Error(`helper ${script} did not report a port in 10s`);
}

export { assert };
