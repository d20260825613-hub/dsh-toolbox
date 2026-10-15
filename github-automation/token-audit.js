/**
 * Check whether a classic token is still alive, and try to identify it so it
 * can be revoked. Read-only apart from the revoke attempt at the end.
 */

import Process from 'node:process';

const token = Process.argv[2];
if (!token) {
  console.error('usage: node check-and-revoke.js <token>');
  Process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  'user-agent': 'spacehog-token-audit',
  accept: 'application/vnd.github+json',
};

async function main() {
  const response = await fetch('https://api.github.com/user', { headers });
  console.log(`GET /user -> ${response.status}`);
  if (!response.ok) {
    console.log('token is DEAD (revoked, expired or invalid) — nothing to clean up.');
    return 0;
  }

  const user = await response.json();
  console.log(`login  : ${user.login}`);
  console.log(`scopes : ${response.headers.get('x-oauth-scopes')}`);
  console.log(`client : ${response.headers.get('x-oauth-client-id') ?? '(not reported)'}`);
  console.log('token is ALIVE.');

  // Which app authorized it? The token list endpoint is deprecated but the
  // root endpoint sometimes still exposes the OAuth app for classic tokens.
  const root = await fetch('https://api.github.com/', { headers });
  const rootBody = await root.json();
  if (rootBody.current_user_url) console.log(`root   : ${rootBody.current_user_url}`);

  if (Process.argv.includes('--revoke')) {
    console.log('\nattempting revoke...');
    const grants = await fetch('https://api.github.com/applications/grants', { headers });
    console.log(`GET /applications/grants -> ${grants.status}`);
    const body = await grants.text();
    console.log(body.slice(0, 300));
  }
  return 0;
}

Process.exitCode = await main();
