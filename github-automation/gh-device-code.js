/**
 * Request one GitHub device-flow code and print it for a human to enter.
 *
 * Split out from gh-device-login.js so the code can be shown immediately: the
 * login script then polls in the background using the same device_code, and the
 * two can run as separate processes (the code stays valid for ~15 minutes).
 *
 * Usage: node gh-device-code.js [scopes]
 */

import https from 'node:https';
import fs from 'node:fs';
import { connectTunnel, withTunnelRetry } from './gh-tunnel.js';

const CLIENT_ID = '178c6fc778ccc68e1d6a';
const scopes = process.argv[2] || 'repo,workflow,read:org';

/** POST a form to github.com through a CONNECT tunnel, without redirects. */
function postForm(host, path, params) {
  return connectTunnel(host).then(
    (socket) =>
      new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const req = https.request(
          {
            host,
            path,
            method: 'POST',
            socket,
            agent: false,
            servername: host,
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
                resolve({ status: res.statusCode, body: JSON.parse(text) });
              } catch {
                reject(new Error(`non-JSON from ${host}${path}: ${text.slice(0, 200)}`));
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

const res = await withTunnelRetry(() => postForm('github.com', '/login/device/code', { client_id: CLIENT_ID, scope: scopes }), {
  label: 'device-code',
});
const dc = res.body;
if (!dc.device_code) {
  console.error('device-code request failed:', JSON.stringify(dc));
  process.exit(1);
}

const challenge = `url=${dc.verification_uri}\ncode=${dc.user_code}\ndevice_code=${dc.device_code}\nscopes=${scopes}\nexpires_in=${dc.expires_in}\ninterval=${dc.interval}\n`;
const challengePath = 'D:\\dsh\\_tools\\gh-device-challenge.txt';
fs.writeFileSync(challengePath, challenge, 'utf8');

console.log('CHALLENGE_FILE=' + challengePath);
console.log('VERIFICATION_URL=' + dc.verification_uri);
console.log('USER_CODE=' + dc.user_code);
console.log('EXPIRES_IN=' + dc.expires_in + 's');
console.log('INTERVAL=' + dc.interval + 's');
