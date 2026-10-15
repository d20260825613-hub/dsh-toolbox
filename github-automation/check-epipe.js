/**
 * Does the CLI survive a reader that goes away early?
 *
 * This is the `tool | head -5` case. The reader closes the pipe after the first
 * line, the writer gets EPIPE, and node's default is an unhandled 'error' event
 * and a stack trace. A well-behaved tool exits quietly.
 *
 * The check must be deterministic, so the pipe is closed on purpose rather than
 * relying on `head` finishing first.
 *
 * Usage: node _tools/check-epipe.js <projectDir> <binRelativePath> [args...]
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const [projectDir, binPath, ...args] = process.argv.slice(2);
if (!projectDir || !binPath) {
  console.error('usage: node check-epipe.js <projectDir> <binPath> [args...]');
  process.exit(2);
}

const child = spawn(process.execPath, [binPath, ...args], {
  cwd: path.resolve(projectDir),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

// Close the read side as soon as anything arrives, then destroy it, which is
// exactly what `head` does when it has enough lines.
child.stdout.once('data', () => {
  child.stdout.destroy();
});

const exitCode = await new Promise((resolve) => {
  child.on('close', (code, signal) => resolve(signal ? `signal ${signal}` : code));
});

const trace = /EPIPE|broken pipe/i.test(stderr) || /at .*\(.*:\d+:\d+\)/.test(stderr);
console.log(`  exit: ${exitCode}`);
console.log(`  stderr: ${stderr.trim() === '' ? '(empty)' : JSON.stringify(stderr.trim().slice(0, 200))}`);
console.log(`  ${trace ? 'FAIL' : 'ok  '} no EPIPE noise`);

process.exit(trace ? 1 : 0);
