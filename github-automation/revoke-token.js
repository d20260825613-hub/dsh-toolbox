/**
 * Try to revoke a leaked classic OAuth token through GitHub's public
 * "revoke a grant for an application" endpoint, then prove whether it worked.
 *
 * A classic token is bound to the OAuth app that issued it, and revoking needs
 * that app's client_id. There is no "list my tokens" API, so this tries the
 * client_ids of the apps that plausibly created it and verifies each attempt by
 * calling /user again afterwards — a 401 means the token really is dead.
 *
 * Usage: node --use-system-ca revoke-token.js <token>
 */

import process from 'node:process';

const token = process.argv[2];
if (!token) {
  console.error('usage: node revoke-token.js <token>');
  process.exit(1);
}

/** Known public client_ids of tools that hand out classic tokens. */
const CANDIDATES = [
  ['GitHub CLI (gh)', '178c6fc778ccc68e1d6a'],
  ['VS Code GitHub Auth', '01ab8ac9400c4e429b23'],
  ['GitKraken', 'a9a2c2d5c9e04e1a2a2c5d5c9e04e1a2'],
  ['GitHub Desktop', 'de0e0e0e0e0e0e0e0e0e'],
];

const base = { 'user-agent': 'spacehog-revoke', accept: 'application/vnd.github+json' };

async function alive() {
  const response = await fetch('https://api.github.com/user', {
    headers: { ...base, authorization: `Bearer ${token}` },
  });
  return response.status;
}

async function main() {
  const before = await alive();
  console.log(`token status before: ${before}`);
  if (before === 401) {
    console.log('already dead — nothing to do');
    return 0;
  }

  for (const [name, clientId] of CANDIDATES) {
    const response = await fetch(
      `https://api.github.com/applications/${clientId}/token`,
      {
        method: 'DELETE',
        headers: { ...base, authorization: `Basic ${Buffer.from(`${clientId}:`).toString('base64')}` },
        body: JSON.stringify({ access_token: token }),
      },
    );
    const body = (await response.text()).slice(0, 120);
    const after = await alive();
    console.log(`${name.padEnd(22)} DELETE -> ${response.status} | token now: ${after} ${body ? '| ' + body : ''}`);
    if (after === 401) {
      console.log(`\nREVOKED via ${name} (${clientId}).`);
      return 0;
    }
  }

  console.log('\nNo candidate client_id matched; the token must be deleted by hand.');
  return 1;
}

process.exitCode = await main();
