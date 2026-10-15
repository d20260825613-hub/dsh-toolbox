/**
 * Poll the device flow once and print the complete GitHub response.
 *
 * gh-device-poll.js retries transient TLS failures and only logs "still
 * waiting", which is the right behaviour for a long-running watcher but hides
 * *why* nothing is arriving. This prints the raw body so the difference between
 * authorization_pending, expired_token and access_denied is visible.
 *
 * Usage: node gh-device-diag.js
 */

import https from 'node:https';
import fs from 'node:fs';
import { connectTunnel, withTunnelRetry } from './gh-tunnel.js';

const CLIENT_ID = '178c6fc778ccc68e1d6a';
const challenge = Object.fromEntries(
  fs
    .readFileSync('D:\\dsh\\_tools\\gh-device-challenge.txt', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

console.log('code        :', challenge.code);
console.log('device_code :', `${challenge.device_code.slice(0, 12)}…`);
console.log('scopes      :', challenge.scopes);

const body = new URLSearchParams({
  client_id: CLIENT_ID,
  device_code: challenge.device_code,
  grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
}).toString();

// github.com (unlike api.github.com) resets a large share of tunnel TLS
// handshakes through this proxy, so one attempt is not a diagnosis.
const res = await withTunnelRetry(
  () =>
    connectTunnel('github.com').then(
      (socket) =>
        new Promise((resolve, reject) => {
          const req = https.request(
            {
              host: 'github.com',
              path: '/login/oauth/access_token',
              method: 'POST',
              socket,
              agent: false,
              servername: 'github.com',
              headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': String(Buffer.byteLength(body)),
                'user-agent': 'diag',
              },
            },
            (r) => {
              const c = [];
              r.on('data', (d) => c.push(d));
              r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(c).toString('utf8') }));
            },
          );
          req.on('error', reject);
          req.end(body);
        }),
    ),
  { attempts: 8, label: 'device-poll' },
);

console.log('http status :', res.status);
console.log('raw body    :', res.text);

try {
  const j = JSON.parse(res.text);
  if (j.access_token) {
    fs.writeFileSync('D:\\dsh\\_tools\\gh-token.txt', j.access_token, 'utf8');
    console.log('RESULT      : token saved, scopes =', j.scope);
  } else {
    console.log('RESULT      :', j.error, '-', j.error_description || '');
  }
} catch {
  console.log('RESULT      : non-JSON reply');
}
