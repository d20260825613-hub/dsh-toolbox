/**
 * Talk to the GitHub API from behind the local Clash proxy, through a CONNECT
 * tunnel.
 *
 * Why this exists: on this machine the Windows hosts file blackholes every
 * github.com name to 127.0.0.1, and the DSH sandbox drops all non-loopback
 * egress. 127.0.0.1:7897 (Clash Verge / verge-mihomo) is the only way out, and
 * it is reachable. Node's https client does not read the WinINET proxy setting,
 * and it does resolve names through the hosts file, so a plain request dies on
 * ECONNREFUSED 127.0.0.1:443. Tunnel first, then hand the raw socket to TLS
 * with the correct SNI.
 *
 * Usage:
 *   node gh-tunnel.js GET  /rate_limit
 *   node gh-tunnel.js GET  /repos/d20260825613-hub/spacehog
 *   node gh-tunnel.js GET  /repos/OWNER/REPO/contents/PATH?ref=main
 *   node gh-tunnel.js POST /repos/OWNER/REPO/git/blobs @body.json
 *   node gh-tunnel.js GET  /rate_limit --token <token>
 *
 * The token comes from $GITHUB_TOKEN, then $GH_TOKEN, then --token, then
 * `gh auth token` (publish-to-github.mjs uses GH_TOKEN first; both names work
 * everywhere so a caller never has to guess which one a script wants).
 * GH_TUNNEL_DEBUG=1 prints the tunnel steps.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROXY_HOST = process.env.GH_TUNNEL_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = Number(process.env.GH_TUNNEL_PROXY_PORT || 7897);
const API_HOST = process.env.GH_TUNNEL_API_HOST || 'api.github.com';
const GH = 'D:\\dsh\\_tools\\gh\\bin\\gh.exe';

const debug = (...a) => {
  if (process.env.GH_TUNNEL_DEBUG === '1') console.error('[tunnel]', ...a);
};

/**
 * Keep every tunnelled socket strongly referenced until it closes.
 *
 * A CONNECT request object that nothing points at any more can be collected as
 * soon as its 'connect' event has fired, which tears down the socket mid-flight
 * and surfaces as a bare "socket hang up". Holding the socket here keeps the
 * tunnel alive for as long as it is in use.
 */
const liveTunnels = new Set();

/** Open a CONNECT tunnel through the local proxy and resolve the raw socket. */
export function connectTunnel(targetHost = API_HOST, targetPort = 443) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      timeout: 15000,
    });
    req.on('connect', (res, socket) => {
      debug(`CONNECT ${targetHost}:${targetPort} -> ${res.statusCode}`);
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy refused CONNECT: ${res.statusCode}`));
        return;
      }
      liveTunnels.add(socket);
      socket.on('close', () => liveTunnels.delete(socket));
      resolve(socket);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('proxy CONNECT timed out'));
    });
    req.end();
  });
}

/** Retry a tunnel-opening operation on the transient failures seen in practice. */
export async function withTunnelRetry(fn, { attempts = 3, label = 'request' } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const transient = /socket hang up|ECONNRESET|EPIPE|timed out|ECONNREFUSED|socket disconnected/i.test(
        e.message || '',
      );
      if (!transient || i === attempts) throw e;
      debug(`${label} attempt ${i} failed (${e.message}); retrying`);
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastError;
}

/** Return the token to authenticate with, or null when none is available. */
export function resolveToken(explicit) {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const idx = process.argv.indexOf('--token');
  const fromArg = explicit || (idx !== -1 ? process.argv[idx + 1] : null);
  if (fromArg) return fromArg.trim();
  const r = spawnSync(GH, ['auth', 'token'], { encoding: 'utf8' });
  const t = (r.stdout || '').trim();
  return t || null;
}

/**
 * Perform one API request through the tunnel.
 * Returns { status, headers, body } with body already JSON-parsed when possible.
 */
export async function apiRequest(method, apiPath, { body, token, host = API_HOST } = {}) {
  const socket = await connectTunnel(host);
  const headers = {
    'user-agent': 'gh-tunnel',
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined && body !== null) {
    payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path: apiPath, method, headers, socket, agent: false, servername: host, timeout: 60000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* not JSON: keep the raw text */
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Read a request body: @file means read that file, otherwise the literal text. */
function readBodyArg(arg) {
  if (!arg) return undefined;
  if (arg.startsWith('@')) return fs.readFileSync(arg.slice(1));
  return JSON.parse(arg);
}

async function main() {
  const [method = 'GET', apiPath, bodyArg] = process.argv.slice(2).filter((a) => a !== '--token' && a !== process.argv[process.argv.indexOf('--token') + 1]);
  if (!apiPath || !apiPath.startsWith('/')) {
    console.error('usage: node gh-tunnel.js <METHOD> </api/path> [@bodyFile|json]');
    process.exit(2);
  }
  const token = resolveToken();
  debug(token ? 'token: present' : 'token: none (anonymous request)');
  const res = await apiRequest(method.toUpperCase(), apiPath, { body: readBodyArg(bodyArg), token });
  console.error(`[tunnel] ${method.toUpperCase()} ${apiPath} -> ${res.status}`);
  console.log(typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2));
  process.exit(res.status >= 400 ? 1 : 0);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error('[tunnel] FAILED:', e.message);
    process.exit(1);
  });
}
