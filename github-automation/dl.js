/**
 * Download a file from the internet through the local proxy tunnel.
 *
 * Needed because this machine has two independent obstacles: the Windows hosts
 * file points every github.com name at 127.0.0.1, and there is no direct
 * external egress at all. Clash on 127.0.0.1:7897 is the only way out, and it
 * resolves host names itself, so CONNECT tunnels work where plain requests do
 * not. Redirects are followed by hand because release assets and archive links
 * land on different hosts (release-assets.githubusercontent.com,
 * codeload.github.com), each of which needs its own tunnel.
 *
 * Usage:
 *   node dl.js <url> <outFile>
 *   node dl.js --asset <owner/repo> <nameSubstring> <outFile>
 *
 * Examples:
 *   node dl.js https://codeload.github.com/adityatelange/hugo-PaperMod/zip/refs/tags/v8.0 papermod.zip
 *   node dl.js --asset gohugoio/hugo windows-amd64.zip hugo.zip
 */

import fs from 'node:fs';
import https from 'node:https';
import { connectTunnel, withTunnelRetry, apiRequest, resolveToken } from './gh-tunnel.js';

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('usage: node dl.js <url> <outFile>');
  console.error('       node dl.js --asset <owner/repo> <nameSubstring> <outFile>');
  process.exit(2);
}
if (argv[0] === '--asset' && argv.length < 4) {
  // The url form only needs two arguments, so the --asset form used to pass the
  // generic check with outFile undefined and then die inside createWriteStream.
  console.error('usage: node dl.js --asset <owner/repo> <nameSubstring> <outFile>');
  process.exit(2);
}

const token = resolveToken();

/** Resolve an asset's download URL from the latest release of a repository. */
async function assetUrl(slug, pattern) {
  const r = await apiRequest('GET', `/repos/${slug}/releases/latest`, { token });
  if (r.status !== 200) throw new Error(`release lookup failed: HTTP ${r.status}`);
  const match = r.body.assets.find((a) => a.name.includes(pattern));
  if (!match) {
    throw new Error(
      `no asset matching "${pattern}" in ${slug} ${r.body.tag_name}. Available: ${r.body.assets
        .map((a) => a.name)
        .join(', ')}`,
    );
  }
  console.log(`asset: ${match.name} (${(match.size / 1048576).toFixed(1)} MB) from ${r.body.tag_name}`);
  return match.browser_download_url;
}

/** One HTTPS GET through a fresh tunnel, returning the response to the caller. */
function request(url) {
  const u = new URL(url);
  return withTunnelRetry(
    () =>
      connectTunnel(u.hostname).then(
        (socket) =>
          new Promise((resolve, reject) => {
            const req = https.request(
              {
                host: u.hostname,
                path: u.pathname + u.search,
                method: 'GET',
                socket,
                agent: false,
                servername: u.hostname,
                headers: {
                  'user-agent': 'dl',
                  accept: 'application/octet-stream',
                  ...(token && u.hostname.endsWith('github.com') ? { authorization: `Bearer ${token}` } : {}),
                },
              },
              (res) => resolve({ res, socket }),
            );
            req.on('error', reject);
            req.end();
          }),
      ),
    { attempts: 8, label: 'download' },
  );
}

let url;
let outFile;
if (argv[0] === '--asset') {
  outFile = argv[3];
  url = await assetUrl(argv[1], argv[2]);
} else {
  [url, outFile] = argv;
}

for (let hop = 0; hop < 8; hop += 1) {
  const { res, socket } = await request(url);
  const status = res.statusCode;

  if (status >= 300 && status < 400 && res.headers.location) {
    res.resume();
    socket.destroy();
    url = new URL(res.headers.location, url).toString();
    console.log(`redirect -> ${new URL(url).hostname}`);
    continue;
  }
  if (status !== 200) {
    res.resume();
    socket.destroy();
    throw new Error(`HTTP ${status} for ${url}`);
  }

  const total = Number(res.headers['content-length'] || 0);
  let received = 0;
  let lastPct = -1;
  const out = fs.createWriteStream(outFile);
  res.on('data', (chunk) => {
    received += chunk.length;
    if (total) {
      const pct = Math.floor((received / total) * 100);
      if (pct >= lastPct + 25) {
        lastPct = pct;
        console.log(`  ${pct}%`);
      }
    }
  });
  await new Promise((resolve, reject) => {
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
  socket.destroy();
  console.log(`saved ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB)`);
  process.exit(0);
}
throw new Error('too many redirects');
