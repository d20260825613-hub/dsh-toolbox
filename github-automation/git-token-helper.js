/**
 * A git credential helper that reads the token from a file.
 *
 * `git config credential.helper` has to be able to produce the password for a
 * github.com URL without the token appearing in an argument vector (where any
 * process on the machine can read it from the command line) or in .git/config
 * (where it would be committed or copied with the repository).
 *
 * Git invokes the helper with `get` (expects `username=…` / `password=…` on
 * stdout) or `store`/`erase` (expects nothing). Only `get` matters here.
 *
 * Usage: wire it up for one command, never persistently:
 *   git -c credential.helper='!node D:/dsh/_tools/git-token-helper.js' push
 */

import fs from 'node:fs';

const TOKEN_FILE = 'D:\\dsh\\_tools\\gh-token.txt';
const USERNAME = 'd20260825613-hub';

const action = process.argv[2] || 'get';
if (action !== 'get') process.exit(0);

let token = '';
try {
  token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
} catch {
  // No token available: print nothing so git falls through to the next helper
  // and fails with its normal authentication error.
  process.exit(0);
}
if (!token) process.exit(0);

process.stdout.write(`username=${USERNAME}\npassword=${token}\n`);
