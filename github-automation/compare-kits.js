/** Compare every project's cli-kit.js against the shared source, byte for byte. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PROJECTS = ['spacehog', 'lockbox', 'nameplate', 'sumcheck', 'jsonl', 'speck'];
const sharedPath = 'D:\\dsh\\_shared\\cli-kit.js';
const shared = fs.readFileSync(sharedPath);
const sharedHash = crypto.createHash('sha256').update(shared).digest('hex');

console.log(`shared:      ${shared.length} bytes  ${sharedHash.slice(0, 12)}`);
console.log(`idempotent?  ${shared.includes('installed.set(stdout, remove)') ? 'yes (has the guard)' : 'NO - stale copy'}`);
console.log('');

for (const name of PROJECTS) {
  const file = `D:\\dsh\\${name}\\src\\cli-kit.js`;
  if (!fs.existsSync(file)) {
    console.log(`${name.padEnd(10)} MISSING`);
    continue;
  }
  const bytes = fs.readFileSync(file);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const label = hash === sharedHash ? 'identical' : 'DIFFERENT';
  const guard = bytes.includes('installed.set(stdout, remove)') ? 'guard' : 'no-guard';
  const stripsDashes = bytes.includes("replace(/^-+/, '')") ? 'strips-dashes' : 'no-strip';
  console.log(`${name.padEnd(10)} ${String(bytes.length).padStart(5)} bytes  ${hash.slice(0, 12)}  ${label.padEnd(9)} ${guard} ${stripsDashes}`);
}
