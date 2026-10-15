/** Look at the two outputs the clone checks disagreed with. */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ENV = {
  ...process.env,
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  PATH: `D:\\dsh\\_tools\\git\\cmd;${path.delimiter}${process.env.PATH}`,
};

const run = (tool, args, cwd) => {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd, encoding: 'utf8', env: ENV })
      : spawnSync(tool, args, { cwd, encoding: 'utf8', env: ENV });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

// 1. sumcheck: what does the changed-file line actually say?
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-look-'));
fs.writeFileSync(path.join(work, 'a.txt'), 'alpha');
const manifest = path.join(work, 'm.json');
console.log('--- generate ---');
console.log(run('node', ['bin/sumcheck.js', 'generate', work, '-m', manifest], 'D:\\dsh\\sumcheck').stdout);
fs.writeFileSync(path.join(work, 'a.txt'), 'TAMPERED');
console.log('--- verify after tampering ---');
const changed = run('node', ['bin/sumcheck.js', 'verify', work, '-m', manifest], 'D:\\dsh\\sumcheck');
console.log('status:', changed.status);
console.log('stdout:');
console.log(changed.stdout);
console.log('stderr:');
console.log(changed.stderr);

// 2. speck: why is nothing reported after IEND?
const speckWork = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-look-'));
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
const payload = Buffer.from('<script>alert(1)</script>');
const file = path.join(speckWork, 'holiday.jpg');
fs.writeFileSync(file, Buffer.concat([png, payload]));
console.log(`\npng=${png.length} bytes, payload=${payload.length} bytes, total=${fs.statSync(file).size}`);
console.log('--- identify ---');
const identify = run('node', ['bin/speck.js', 'identify', file], 'D:\\dsh\\speck');
console.log('status:', identify.status);
console.log(identify.stdout);
console.log('--- info (warnings only) ---');
const info = run('node', ['bin/speck.js', 'info', file, '--json'], 'D:\\dsh\\speck');
const parsed = JSON.parse(info.stdout);
console.log('warnings:', JSON.stringify(parsed.warnings, null, 2));

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(speckWork, { recursive: true, force: true });
