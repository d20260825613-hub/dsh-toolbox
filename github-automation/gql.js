/**
 * Run a GitHub GraphQL query through the tunnel.
 *
 * The REST API has no endpoint for Discussions categories, but giscus needs a
 * category *node id*, which is only exposed through GraphQL.
 *
 * Usage:
 *   node gql.js '<query>'                       # inline
 *   node gql.js --file query.graphql            # from a file
 *   node gql.js --categories owner/repo         # shortcut: list discussion categories
 */

import fs from 'node:fs';
import { connectTunnel, withTunnelRetry, resolveToken } from './gh-tunnel.js';
import https from 'node:https';

const argv = process.argv.slice(2);
const token = resolveToken();
if (!token) {
  console.error('no token available');
  process.exit(1);
}

let query;
if (argv[0] === '--file') {
  query = fs.readFileSync(argv[1], 'utf8');
} else if (argv[0] === '--categories') {
  const [owner, name] = argv[1].split('/');
  query = `query {
    repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      id
      nameWithOwner
      hasDiscussionsEnabled
      discussionCategories(first: 25) {
        nodes { id name emoji description isAnswerable }
      }
    }
  }`;
} else {
  query = argv.join(' ');
}

const body = JSON.stringify({ query });

const result = await withTunnelRetry(
  () =>
    connectTunnel('api.github.com').then(
      (socket) =>
        new Promise((resolve, reject) => {
          const req = https.request(
            {
              host: 'api.github.com',
              path: '/graphql',
              method: 'POST',
              socket,
              agent: false,
              servername: 'api.github.com',
              timeout: 30000,
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(body)),
                'user-agent': 'gql',
              },
            },
            (res) => {
              const c = [];
              res.on('data', (d) => c.push(d));
              res.on('end', () => {
                const text = Buffer.concat(c).toString('utf8');
                try {
                  resolve({ status: res.statusCode, json: JSON.parse(text) });
                } catch {
                  reject(new Error(`non-JSON reply: ${text.slice(0, 300)}`));
                }
              });
            },
          );
          req.on('error', reject);
          req.end(body);
        }),
    ),
  { attempts: 6, label: 'graphql' },
);

if (result.json.errors) {
  console.error('GraphQL errors:', JSON.stringify(result.json.errors, null, 2));
}
console.log(JSON.stringify(result.json.data ?? result.json, null, 2));
process.exit(result.json.errors ? 1 : 0);
