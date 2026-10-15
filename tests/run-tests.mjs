// Minimal zero-dependency test runner for dsh-toolbox.
//
// Usage:  node tests/run-tests.mjs
//         node tests/run-tests.mjs zstd      (only files whose name contains "zstd")
//
// No package.json, no npm: every test file is a plain .mjs module that imports
// `test` / `assert` from ./harness.mjs. Nothing here touches the network — the
// GitHub scripts are exercised either through pure exported functions or by
// spawning them with arguments that must fail before any request is made.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];
const files = fs
  .readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`no test files${filter ? ` matching "${filter}"` : ''}`);
  process.exit(2);
}

for (const f of files) {
  console.log(`\n== ${f}`);
  await import(new URL(f, import.meta.url).href);
}

try {
  process.exit((await run()) ? 0 : 1);
} catch (e) {
  console.error('\n' + (e?.stack ?? e));
  process.exit(1);
}
