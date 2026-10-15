/**
 * GitHub OAuth device-flow login over the local Clash CONNECT tunnel.
 *
 * Needed because both halves of the normal route are broken here: git/gh see
 * github.com blackholed to 127.0.0.1 by the hosts file, and the OAuth token
 * already in the keyring has been revoked (401). The device flow needs no
 * inbound port and no callback URL, and it yields a token with exactly the
 * scopes requested.
 *
 * Usage: node gh-device-login.js [--scopes repo,workflow,read:org] [--store]
 *
 * Prints the one-time code and the verification URL for a human to open, then
 * polls until GitHub hands over the token. With --store the token is written to
 * the gh CLI as the github.com credential, so ordinary `gh` and `git push`
 * (with the credential helper) work afterwards.
 */

import { spawnSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import { connectTunnel, withTunnelRetry } from './gh-tunnel.js';
import { numberOption, parseOptions } from './cli-flags.mjs';

// GitHub CLI's public OAuth app client id (device flow enabled).
const CLIENT_ID = '178c6fc778ccc68e1d6a';
const GH = 'D:\\dsh\\_tools\\gh\\bin\\gh.exe';

const USAGE = 'usage: node gh-device-login.js [--scopes repo,workflow,read:org] [--max-wait 10] [--interval N] [--challenge <file>] [--store]';

let options;
try {
  // `--store` is the only boolean option; everything else needs a value, and a
  // missing one is an error instead of the previous silent `undefined`/NaN.
  ({ options } = parseOptions(process.argv.slice(2), ['--store']));
} catch (e) {
  console.error(`error: ${e.message}`);
  console.error(USAGE);
  process.exit(2);
}

const store = options.has('--store');
const scopes = options.get('--scopes') || 'repo,workflow,read:org';
const intervalOverride = numberOption(options, '--interval', 0, { min: 0 });
let maxWaitMs;
try {
  maxWaitMs = numberOption(options, '--max-wait', 10, { min: 0.1 }) * 60 * 1000;
} catch (e) {
  console.error(`error: ${e.message}`);
  console.error(USAGE);
  process.exit(2);
}

/** POST a form to github.com through a fresh CONNECT tunnel. */
async function postForm(path, params) {
  const socket = await connectTunnel('github.com');
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'github.com',
        path,
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
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            return reject(new Error(`non-JSON reply from ${path}: ${text.slice(0, 200)}`));
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timed out posting to ${path}`)));
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.error('[login] requesting a device code …');
  const codeRes = await withTunnelRetry(() => postForm('/login/device/code', { client_id: CLIENT_ID, scope: scopes }), {
    label: 'device-code',
  });
  const dc = codeRes.body;
  if (!dc.device_code) {
    console.error('[login] GitHub refused the device-code request:', JSON.stringify(dc));
    process.exit(1);
  }

  // Persist the challenge immediately: a caller reading the job log later still
  // needs the code, and the polling below can run for minutes.
  const challengePath = options.get('--challenge') || 'D:\\dsh\\_tools\\gh-device-challenge.txt';
  fs.writeFileSync(
    challengePath,
    `url=${dc.verification_uri}\ncode=${dc.user_code}\nscopes=${scopes}\nexpires_in=${dc.expires_in}\n`,
    'utf8',
  );

  console.log('==================================================================');
  console.log(' OPEN THIS URL IN A BROWSER: ' + dc.verification_uri);
  console.log(' ENTER THIS CODE           : ' + dc.user_code);
  console.log('==================================================================');
  console.log('(scopes requested: ' + scopes + '; expires in ' + dc.expires_in + 's)');
  console.log('(also saved to ' + challengePath + ')');

  const interval = (intervalOverride || dc.interval || 5) * 1000;
  const deadline = Date.now() + maxWaitMs;
  let pollCount = 0;

  while (Date.now() < deadline) {
    await sleep(interval);
    pollCount += 1;
    const res = await withTunnelRetry(
      () =>
        postForm('/login/oauth/access_token', {
          client_id: CLIENT_ID,
          device_code: dc.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      { label: 'poll' },
    );
    const b = res.body;
    if (b.access_token) {
      console.error('[login] SUCCESS — token received after ' + pollCount + ' poll(s).');
      console.error('[login] scopes: ' + (b.scope || '(none reported)'));
      if (store) {
        const r = spawnSync(GH, ['auth', 'login', '--hostname', 'github.com', '--with-token'], {
          input: b.access_token,
          encoding: 'utf8',
        });
        console.error('[login] gh auth login --with-token exit=' + r.status);
        if (r.stdout) console.error(r.stdout.trim());
        if (r.stderr) console.error(r.stderr.trim());
      }
      // The token itself stays on stdout so the caller can capture it; the
      // human-facing status lines above go to stderr.
      console.log(b.access_token);
      process.exit(0);
    }
    if (b.error === 'authorization_pending') {
      console.error('[login] waiting for you to approve … (' + pollCount + ')');
      continue;
    }
    if (b.error === 'slow_down') {
      console.error('[login] slow_down requested; backing off');
      await sleep(interval);
      continue;
    }
    console.error('[login] FAILED:', JSON.stringify(b));
    process.exit(1);
  }
  console.error('[login] gave up after ' + maxWaitMs / 60000 + ' minutes without approval');
  process.exit(1);
}

main().catch((e) => {
  console.error('[login] ERROR:', e.message);
  process.exit(1);
});
