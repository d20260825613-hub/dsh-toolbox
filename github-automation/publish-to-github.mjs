// Publish local repositories to GitHub through the REST + Git Data API.
//
// Why the API instead of `git push`: on this network github.com:443 is blocked,
// but api.github.com / raw.githubusercontent.com / codeload.github.com are
// reachable, and the token is honoured directly (no third-party proxy involved).
// The Git Data API (blobs -> tree -> commit -> ref) produces ONE clean commit
// per repository instead of one commit per file.
//
// The publish list follows git's own ignore rules. This matters because the tool
// exists precisely to replace `git push`, and it publishes to a PUBLIC repository:
// walking the working tree verbatim used to upload .env, *.log and anything else
// the user had deliberately listed in .gitignore.
//
// Usage:  set GH_TOKEN (or GITHUB_TOKEN, or run via the wrapper that reads
//         `gh auth token`), then
//         node publish-to-github.mjs <repoDir> <name> <description> [topics]
//         node publish-to-github.mjs --dry-run <repoDir> <name> ...
//
// Options:
//   --dry-run       print the file list and the remote paths that would be
//                   deleted, then stop before touching the API
//   --delete-remote also delete files that exist on the branch but not locally
//                   (default: keep them; the tree is merged onto the branch head)
//   --allow-secrets override the secret-name guard (use only when you mean it)
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const API = process.env.GH_API || 'https://api.github.com';

// Always skipped, ignore file or not: VCS metadata, dependency dumps, caches.
const SKIP = /(^|[\\/])(\.git|node_modules|__pycache__|\.venv|venv)([\\/]|$)/i;

// Names that must never reach a public repository. This is a second line of
// defence behind .gitignore — a missing or wrong .gitignore would otherwise leak
// a live credential, and the destination is public by default.
const SECRET = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])\.env$/i,
  /(^|[\\/])[^\\/]*\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|[\\/])[^\\/]*(token|secret|credential|password|passwd)[^\\/]*$/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|[\\/])\.npmrc$/i,
  /(^|[\\/])\.netrc$/i,
  /(^|[\\/])cookies?\.(txt|json|sqlite)$/i,
];

// ---------------------------------------------------------------------------
// .gitignore semantics
// ---------------------------------------------------------------------------

/**
 * Compile one .gitignore file into matcher functions.
 *
 * Supports the parts of the format that decide what a working tree looks like:
 * comments, blank lines, `!` negation, a trailing `/` (directories only), a
 * leading `/` (anchor at this level), `*`, `?`, `[abc]`, and `**`.
 */
export function parseGitignore(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);
    if (!line) continue;

    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);
    if (!line) continue;

    const hasSlash = line.includes('/');
    const source = globToRegExp(line);
    // An unanchored pattern without a slash matches a path component at any
    // depth; `prefix` is the matcher for that (used for directories and for the
    // ancestor check), while `regex` matches the full relative path.
    const anywhere = !anchored && !hasSlash;
    rules.push({
      dirOnly,
      regex: new RegExp(`^${source}$`),
      prefix: anywhere ? new RegExp(`^${source}$`) : null,
      negate,
      raw,
    });
  }
  return rules;
}

/** Translate one gitignore glob into a regex fragment (no anchors). */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; a trailing `**` matches anything.
        const next = glob[i + 2];
        if (next === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let cls = glob.slice(i + 1, close);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        out += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (ch === '\\') {
      i += 1;
      out += escapeRegExp(glob[i] ?? '\\');
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide whether a path is ignored.
 *
 * `dirs` holds every ancestor directory of the path (relative), so a
 * directory-only rule can match an ancestor and a file inside an ignored
 * directory stays ignored. The path itself is also a candidate for dirOnly
 * rules, which is what lets `build/` match the directory `build`.
 *
 * `rules` is ordered outermost .gitignore first, so a deeper file can re-include
 * what a parent excluded.
 */
export function isIgnored(rel, rules, dirs = []) {
  let ignored = false;
  for (const rule of rules) {
    // `prefix` is set for an unanchored pattern without a slash. Such a pattern
    // matches one path component, so it has to be tested against every segment:
    // that is how a bare `logs` rule reaches `a/b/logs`, and how `build/` matches
    // the directory `build` wherever it appears.
    const matches = (p) => {
      if (rule.regex.test(p)) return true;
      if (!rule.prefix) return false;
      return p.split('/').some((seg) => rule.prefix.test(seg));
    };
    if ([rel, ...dirs].some(matches)) ignored = !rule.negate;
  }
  return ignored;
}

/** True when a path looks like a credential and must not be published. */
export function looksSecret(rel) {
  return SECRET.some((re) => re.test(rel));
}

/** Read `<dir>/.gitignore` (empty when absent). */
function readGitignore(dir) {
  const file = path.join(dir, '.gitignore');
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * Ask git for the publish list. This is authoritative — it includes nested
 * .gitignore files, .git/info/exclude and the global excludes file, none of
 * which a hand-rolled parser would see. Returns null when git is unavailable or
 * `dir` is not a work tree.
 */
function gitLsFiles(dir) {
  const r = spawnSync('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0 || !r.stdout) return null;
  const out = r.stdout.toString('utf8').split('\0').filter(Boolean);
  return out.length ? out : null;
}

/**
 * Build the publish list for `dir`.
 *
 * Preferred source is `git ls-files -co --exclude-standard`; the .gitignore
 * parser is the fallback for a directory that is not a git work tree yet.
 * Both are filtered by SKIP, and credential-looking names are held back in
 * `secrets` so a missing/wrong .gitignore cannot leak one silently.
 * Returns { files, ignored, secrets, source }.
 */
export function listPublishFiles(dir) {
  const secrets = [];
  const keep = (rel, out) => {
    if (SKIP.test(rel)) return;
    if (looksSecret(rel)) secrets.push(rel);
    out.push(rel);
  };

  const fromGit = gitLsFiles(dir);
  if (fromGit) {
    const files = [];
    for (const rel of fromGit.map((p) => p.replace(/\\/g, '/'))) keep(rel, files);
    return { files: files.sort(), ignored: [], secrets: secrets.sort(), source: 'git ls-files -co --exclude-standard' };
  }

  const rules = parseGitignore(readGitignore(dir));
  const files = [];
  const ignored = [];
  const collect = (base) => {
    const abs = base ? path.join(dir, base) : dir;
    // Ancestor directories of `base`, so directory-only rules can match them.
    const baseDirs = base
      ? base.split('/').reduce((acc, part) => [...acc, acc.length ? `${acc[acc.length - 1]}/${part}` : part], [])
      : [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (SKIP.test(rel)) continue;
      if (isIgnored(rel, rules, baseDirs)) {
        ignored.push(rel);
        continue;
      }
      if (entry.isDirectory()) collect(rel);
      else if (entry.isFile()) keep(rel, files);
    }
  };
  collect('');
  return {
    files: files.sort(),
    ignored: ignored.sort(),
    secrets: secrets.sort(),
    source: '.gitignore parsed locally (not a git work tree)',
  };
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: node publish-to-github.mjs [--dry-run] [--delete-remote] [--allow-secrets] ' +
      '<repoDir> <name> <description> [topics,csv]',
  );
  process.exit(2);
}

/** Thrown for bad arguments, so main() can print usage instead of a stack. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseArgv(argv) {
  const flags = { dryRun: false, deleteRemote: false, allowSecrets: false };
  const rest = [];
  for (const a of argv) {
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--delete-remote') flags.deleteRemote = true;
    else if (a === '--allow-secrets') flags.allowSecrets = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option: ${a}`);
    else rest.push(a);
  }
  return { flags, rest };
}

function resolveToken() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) return token.trim();
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const fromGh = (r.stdout || '').trim();
  return fromGh || null;
}

async function api(method, url, body) {
  const full = url.startsWith('http') ? url : API + url;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(full, {
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

/** Blob paths already on the branch, so --dry-run can show what would vanish. */
async function remotePaths(owner, name, sha) {
  if (!sha) return [];
  const tree = await api('GET', `/repos/${owner}/${name}/git/trees/${sha}?recursive=1`);
  if (!tree?.tree) return [];
  if (tree.truncated) console.error('  warning: the remote tree listing was truncated');
  return tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

let TOKEN = null;

async function main() {
  const { flags, rest } = parseArgv(process.argv.slice(2));
  const [dirArg, nameArg, descArg, topicsArg] = rest;
  if (!dirArg || !nameArg) usage('missing <repoDir> or <name>');

  const dir = path.resolve(dirArg);
  const name = nameArg;
  const description = descArg || '';
  const topics = (topicsArg || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) usage(`not a directory: ${dir}`);

  TOKEN = resolveToken();
  if (!TOKEN) {
    console.error('no token: set GH_TOKEN or GITHUB_TOKEN (or log in with `gh auth login`)');
    process.exit(2);
  }

  // ---- publish list ------------------------------------------------------
  const { files, ignored, secrets, source } = listPublishFiles(dir);
  console.log(`publish list from ${source}`);
  console.log(`  ${files.length} file(s) to upload${ignored.length ? `, ${ignored.length} ignored by .gitignore` : ''}`);
  if (secrets.length && !flags.allowSecrets) {
    console.error('\nrefusing to publish: these paths look like credentials:');
    for (const s of secrets) console.error(`    ${s}`);
    console.error('  add them to .gitignore (or pass --allow-secrets to override)');
    process.exit(3);
  }
  if (secrets.length) console.error(`warning: publishing ${secrets.length} credential-looking path(s) anyway`);

  if (files.length === 0) {
    console.error(`nothing to publish: ${dir} has no unignored files`);
    process.exit(2);
  }

  const user = await api('GET', '/user');
  const owner = user.login;
  console.log(`publishing ${path.basename(dir)} -> ${owner}/${name} (${user.name || ''})`);

  // ---- create or reuse the repository ------------------------------------
  let repo = await api('GET', `/repos/${owner}/${name}`);
  if (!repo && !flags.dryRun) {
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
  } else if (repo) {
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

  let refSha = null;
  if (!flags.dryRun) {
    // make sure the default branch exists (empty repos need one bootstrap commit)
    refSha = await headSha();
    if (!refSha) {
      console.log('  repository has no main branch yet - bootstrapping one commit');
      await api('PUT', `/repos/${owner}/${name}/contents/.dsh-bootstrap`, {
        message: 'chore: bootstrap repository',
        content: Buffer.from('bootstrap\n').toString('base64'),
      });
      refSha = await headSha();
    }
  }

  // ---- what the remote has and the local copy does not -------------------
  const existing = await remotePaths(owner, name, refSha || (await headSha()));  const localSet = new Set(files);
  const remoteOnly = existing.filter((p) => !localSet.has(p));

  if (flags.dryRun) {
    console.log('\n--dry-run: files that would be uploaded:');
    for (const f of files) {
      const size = fs.statSync(path.join(dir, f)).size;
      console.log(`    ${String(size).padStart(9)}  ${f}`);
    }
    if (remoteOnly.length) {
      console.log(`\n${remoteOnly.length} path(s) exist on the branch but not locally:`);
      for (const p of remoteOnly) console.log(`    ${p}`);
      console.log(
        flags.deleteRemote
          ? '    -> would be DELETED (--delete-remote)'
          : '    -> kept: the tree is merged onto the branch head (pass --delete-remote to remove them)',
      );
    }
    console.log('\n--dry-run: nothing was sent to GitHub');
    return;
  }

  // ---- upload files as one commit ----------------------------------------
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
  const parentSha = refSha || (await headSha());
  const parents = parentSha ? [parentSha] : [];

  const treeBody = { tree };
  if (parents.length) {
    // base_tree merges onto the branch instead of replacing it, so remote-only
    // files survive a publish from a partial local checkout. Deletions have to be
    // requested one by one, which is exactly the explicit step that was missing.
    treeBody.base_tree = parentSha;
    if (flags.deleteRemote) {
      for (const p of remoteOnly) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
    }
  }

  const treeObj = await api('POST', `/repos/${owner}/${name}/git/trees`, treeBody);
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
  if (remoteOnly.length) {
    console.log(
      flags.deleteRemote
        ? `  deleted ${remoteOnly.length} remote-only path(s)`
        : `  kept ${remoteOnly.length} remote-only path(s) (use --delete-remote to remove)`,
    );
  }

  if (topics.length) {
    try {
      await api('PUT', `/repos/${owner}/${name}/topics`, { names: topics });
      console.log(`  topics: ${topics.join(', ')}`);
    } catch (e) {
      console.log(`  topics failed: ${e.message}`);
    }
  }

  console.log(`DONE ${repo.html_url}  files=${files.length} commit=${commit.sha.slice(0, 10)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    if (e instanceof UsageError) usage(e.message);
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
