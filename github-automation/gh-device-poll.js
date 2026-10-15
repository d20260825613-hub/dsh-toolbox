/**
 * Poll GitHub for the token belonging to an already-requested device code.
 *
 * Reads the challenge written by gh-device-code.js, so the human-facing code
 * was printed by a process that has already exited. On success the token is
 * written to D:\dsh\_tools\gh-token.txt with owner-only intent, and optionally
 * handed to the gh CLI as the github.com credential.
 *
 * Usage: node gh-device-poll.js [--store] [--max-wait 15]
 */

import https from 'node:https';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { connectTunnel, withTunnelRetry } from './gh-tunnel.js';
import { numberOption, parseOptions } from './cli-flags.mjs';

const CLIENT_ID = '178c6fc778ccc68e1d6a';
const GH = 'D:\\dsh\\_tools\\gh\\bin\\gh.exe';
const CHALLENGE = 'D:\\dsh\\_tools\\gh-device-challenge.txt';
const TOKEN_FILE = 'D:\\dsh\\_tools\\gh-token.txt';

const USAGE = 'usage: node gh-device-poll.js [--max-wait 15] [--store]';

let options;
try {
  ({ options } = parseOptions(process.argv.slice(2), ['--store']));
} catch (e) {
  console.error(`error: ${e.message}`);
  console.error(USAGE);
  process.exit(2);
}
const store = options.has('--store');
// `--max-wait` with no value used to become NaN, so the poll loop was skipped
// entirely and the script only ever printed "gave up after NaN minutes".
let maxWaitMs;
try {
  maxWaitMs = numberOption(options, '--max-wait', 15, { min: 0.1 }) * 60 * 1000;
} catch (e) {
  console.error(`error: ${e.message}`);
  console.error(USAGE);
  process.exit(2);
}

const challenge = Object.fromEntries(
  fs
    .readFileSync(CHALLENGE, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
if (!challenge.device_code) {
  console.error('no device_code in ' + CHALLENGE);
  process.exit(1);
}

function postForm(params) {
  return connectTunnel('github.com').then(
    (socket) =>
      new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const req = https.request(
          {
            host: 'github.com',
            path: '/login/oauth/access_token',
            method: 'POST',
            socket,
            agent: false,
            servername: 'github.com',
            timeout: 30000,
            headers: {
              accept: 'application/json',
              'content-type': 'application/x-www-form-urlencoded',
              'content-length': String(Buffer.byteLength(body)),
              'user-agent': 'dsh-device-flow',
            },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              try {
                resolve(JSON.parse(text));
              } catch {
                reject(new Error('non-JSON reply: ' + text.slice(0, 200)));
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.end(body);
      }),
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const interval = (Number(challenge.interval) || 5) * 1000;
const deadline = Date.now() + maxWaitMs;
let polls = 0;

console.error(`[poll] watching code ${challenge.code} (interval ${interval / 1000}s)`);
while (Date.now() < deadline) {
  await sleep(interval);
  polls += 1;
  let body;
  try {
    body = await withTunnelRetry(
      () =>
        postForm({
          client_id: CLIENT_ID,
          device_code: challenge.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      { label: 'poll' },
    );
  } catch (e) {
    console.error(`[poll] ${polls}: transient error ${e.message}; continuing`);
    continue;
  }

  if (body.access_token) {
    fs.writeFileSync(TOKEN_FILE, body.access_token, 'utf8');
    console.error(`[poll] SUCCESS after ${polls} poll(s); scopes: ${body.scope || '(none reported)'}`);
    console.error('[poll] token saved to ' + TOKEN_FILE);
    if (store) {
      const r = spawnSync(GH, ['auth', 'login', '--hostname', 'github.com', '--with-token'], {
        input: body.access_token,
        encoding: 'utf8',
      });
      console.error('[poll] gh auth login exit=' + r.status + (r.stderr ? ' ' + r.stderr.trim() : ''));
    }
    console.log('TOKEN_STORED=' + TOKEN_FILE);
    process.exit(0);
  }
  if (body.error === 'authorization_pending') {
    if (polls % 6 === 0) console.error(`[poll] still waiting for approval (${polls} polls)`);
    continue;
  }
  if (body.error === 'slow_down') {
    await sleep(interval);
    continue;
  }
  console.error('[poll] FAILED: ' + JSON.stringify(body));
  process.exit(1);
}
console.error(`[poll] gave up after ${maxWaitMs / 60000} minutes`);
process.exit(1);
