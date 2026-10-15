// Publish local repositories to GitHub through the REST + Git Data API.
//
// Why the API instead of `git push`: on this network github.com:443 is blocked,
// but api.github.com / raw.githubusercontent.com / codeload.github.com are
// reachable, and the token is honoured directly (no third-party proxy involved).
// The Git Data API (blobs -> tree -> commit -> ref) produces ONE clean commit
// per repository instead of one commit per file.
//
// Usage:  set GH_TOKEN (or run via the wrapper that reads `gh auth token`), then
//         node publish-to-github.mjs <repoDir> <name> <description> [topics]
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.GH_API || 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('GH_TOKEN is not set');
  process.exit(2);
}

const [, , dirArg, nameArg, descArg, topicsArg] = process.argv;
if (!dirArg || !nameArg) {
  console.error('usage: node publish-to-github.mjs <repoDir> <name> <description> [topics,csv]');
  process.exit(2);
}
const dir = path.resolve(dirArg);
const name = nameArg;
const description = descArg || '';
const topics = (topicsArg || '').split(',').map((s) => s.trim()).filter(Boolean);

async function api(method, url, body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dsh-agent',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (res.ok) return json;
    if (res.status === 404 && method === 'GET') return null;
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const msg = json?.message || text.slice(0, 200);
    const err = new Error(`${method} ${url} -> HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  throw new Error(`${method} ${url} failed after retries`);
}

// ---- file walk ----------------------------------------------------------------
const SKIP = /(^|[\\/])(\.git|node_modules|__pycache__)([\\/]|$)/i;
function walk(root, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (SKIP.test(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const user = await api('GET', '/user');
const owner = user.login;
console.log(`publishing ${path.basename(dir)} -> ${owner}/${name} (${user.name || ''})`);

// ---- create or reuse the repository -------------------------------------------
let repo = await api('GET', `/repos/${owner}/${name}`);
if (!repo) {
  // auto_init creates a first commit; without it GitHub rejects blob creation on a
  // brand-new repository with HTTP 409 "Git Repository is empty".
  repo = await api('POST', '/user/repos', {
    name,
    description,
    private: false,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: true,
  });
  console.log(`  created repository ${repo.full_name}`);
} else {
  console.log(`  repository exists: ${repo.full_name}`);
}

// GitHub answers 409 "Git Repository is empty" (not 404) when a brand-new repo
// has no refs yet, so both codes have to be treated as "no branch".
async function headSha() {
  try {
    const r = await api('GET', `/repos/${owner}/${name}/git/ref/heads/main`);
    return r?.object?.sha || null;
  } catch (e) {
    if (e.status === 404 || e.status === 409) return null;
    throw e;
  }
}

// make sure the default branch exists (empty repos need one bootstrap commit)
let refSha = await headSha();
if (!refSha) {
  console.log('  repository has no main branch yet - bootstrapping one commit');
  await api('PUT', `/repos/${owner}/${name}/contents/.dsh-bootstrap`, {
    message: 'chore: bootstrap repository',
    content: Buffer.from('bootstrap\n').toString('base64'),
  });
  refSha = await headSha();
}

// ---- upload files as one commit ----------------------------------------------
const files = walk(dir);
console.log(`  uploading ${files.length} files as blobs...`);
const tree = [];
let done = 0;
for (const rel of files) {
  const abs = path.join(dir, rel);
  const buf = fs.readFileSync(abs);
  const blob = await api('POST', `/repos/${owner}/${name}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  const mode = /\.(sh|cmd)$/i.test(rel) ? '100755' : '100644';
  tree.push({ path: rel, mode, type: 'blob', sha: blob.sha });
  done++;
  if (done % 25 === 0) console.log(`    ${done}/${files.length}`);
}

// parent = current head, when the branch already exists
const parentSha = await headSha();
const parents = parentSha ? [parentSha] : [];

const treeObj = await api('POST', `/repos/${owner}/${name}/git/trees`, { tree });
const commit = await api('POST', `/repos/${owner}/${name}/git/commits`, {
  message: `${parents.length ? 'Update' : 'Initial commit'}: ${name}\n\nPublished by the DSH agent from the build machine (Git Data API, single commit).`,
  tree: treeObj.sha,
  parents,
});

if (parents.length) {
  await api('PATCH', `/repos/${owner}/${name}/git/refs/heads/main`, { sha: commit.sha, force: false });
} else {
  await api('POST', `/repos/${owner}/${name}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
}
console.log(`  commit ${commit.sha.slice(0, 10)} pushed to main`);

if (topics.length) {
  try {
    await api('PUT', `/repos/${owner}/${name}/topics`, { names: topics });
    console.log(`  topics: ${topics.join(', ')}`);
  } catch (e) {
    console.log(`  topics failed: ${e.message}`);
  }
}

console.log(`DONE ${repo.html_url}  files=${files.length} commit=${commit.sha.slice(0, 10)}`);
