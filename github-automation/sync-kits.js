// Copies the canonical _shared/cli-kit.js into every project and verifies bytes.
// Usage: node _tools/sync-kits.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = 'D:\\dsh';
const CANON = join(ROOT, '_shared', 'cli-kit.js');

const PROJECTS = ['spacehog', 'lockbox', 'nameplate', 'sumcheck', 'jsonl', 'speck'];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const canonical = readFileSync(CANON);

// Refuse to ship a kit that lacks the idempotency guard it is supposed to have.
if (!canonical.includes('installed.set(')) {
  console.error('canonical kit has no idempotency guard, aborting');
  process.exit(1);
}

let failures = 0;
for (const name of PROJECTS) {
  const target = join(ROOT, name, 'src', 'cli-kit.js');
  if (!existsSync(target)) {
    console.log(`${name.padEnd(10)} MISSING ${target}`);
    failures += 1;
    continue;
  }
  const before = readFileSync(target);
  if (sha(before) !== sha(canonical)) {
    writeFileSync(target, canonical);
  }
  const after = readFileSync(target);
  const same = sha(after) === sha(canonical);
  if (!same) failures += 1;
  console.log(
    `${name.padEnd(10)} ${String(after.length).padStart(6)} bytes  ${sha(after).slice(0, 12)}  ` +
      `${same ? 'OK' : 'MISMATCH'}  ${sha(before) === sha(canonical) ? 'already-current' : 'copied'}`,
  );
}

console.log(`\ncanonical ${canonical.length} bytes  ${sha(canonical).slice(0, 12)}`);
console.log(failures === 0 ? 'all copies identical' : `${failures} project(s) still wrong`);
process.exit(failures === 0 ? 0 : 1);
