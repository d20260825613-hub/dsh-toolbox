// publish-to-github.mjs: the publish list must follow .gitignore.
//
// This is the leak that mattered: the tool replaces `git push` and publishes to a
// PUBLIC repository, and it used to walk the working tree with only a hardcoded
// .git/.node_modules skip — so .env, *.log and anything else listed in .gitignore
// went up as a blob.
//
// No network here: `listPublishFiles` is a pure function over a directory.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, describe, node, startHelper, test, tmpdir, write } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'github-automation', 'publish-to-github.mjs');
const mod = () => import(new URL('../github-automation/publish-to-github.mjs', import.meta.url).href);

/** The fixture from the audit: secrets that .gitignore does list, plus files it does not. */
function fixture(dir) {
  write(path.join(dir, '.gitignore'), ['secret.txt', '.env', '*.log', 'node_modules/', 'dist/', '*.tmp', '!keep.tmp', ''].join('\n'));
  write(path.join(dir, 'secret.txt'), 'SUPER-SECRET-TOKEN-ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA\n');
  write(path.join(dir, '.env'), 'GH_TOKEN=ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBB\n');
  write(path.join(dir, 'debug.log'), 'a log line\n');
  write(path.join(dir, 'README.md'), '# demo\n');
  write(path.join(dir, 'keep.tmp'), 'negated, must be published\n');
  write(path.join(dir, 'drop.tmp'), 'ignored\n');
  write(path.join(dir, 'sub', 'code.js'), 'export const x = 1;\n');
  write(path.join(dir, '.git', 'config'), '[core]\n');
  write(path.join(dir, 'node_modules', 'dep.js'), 'module.exports = {};\n');
  write(path.join(dir, 'dist', 'bundle.js'), 'bundle\n');
  write(path.join(dir, '中文 名.txt'), 'spaces\n');
  return dir;
}

describe('publish-to-github :: .gitignore semantics');

test('a non-git directory: .env, secrets, logs, node_modules and dist are ignored', async () => {
  const dir = fixture(tmpdir());
  const { listPublishFiles } = await mod();
  const r = listPublishFiles(dir);
  const f = new Set(r.files);

  assert.ok(f.has('README.md'), 'README published');
  assert.ok(f.has('sub/code.js'), 'nested source published');
  assert.ok(f.has('中文 名.txt'), 'unicode name published');
  assert.ok(f.has('.gitignore'), '.gitignore itself is published');
  assert.ok(f.has('keep.tmp'), 'a ! negation re-includes a file');

  for (const bad of ['.env', 'secret.txt', 'debug.log', 'drop.tmp', 'node_modules/dep.js', 'dist/bundle.js']) {
    assert.ok(!f.has(bad), `${bad} must NOT be published`);
  }
  for (const bad of ['debug.log', '.env', 'secret.txt', 'drop.tmp']) {
    assert.ok(r.ignored.includes(bad), `${bad} reported as ignored`);
  }
});

test('a git work tree uses git\'s own answer (nested .gitignore + .git/info/exclude)', async () => {
  const dir = fixture(tmpdir());
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const init = git('init', '-q');
  if (init.error) return; // no git on PATH: the parser path above already covers this

  write(path.join(dir, 'sub', '.gitignore'), 'generated.js\n');
  write(path.join(dir, 'sub', 'generated.js'), 'ignored by a nested .gitignore\n');
  write(path.join(dir, '.git', 'info', 'exclude'), 'excluded-by-git.txt\n');
  write(path.join(dir, 'excluded-by-git.txt'), 'ignored via .git/info/exclude\n');

  const { listPublishFiles } = await mod();
  const r = listPublishFiles(dir);
  const f = new Set(r.files);
  assert.ok(r.source.includes('git ls-files'), `expected git as the source, got: ${r.source}`);
  assert.ok(f.has('sub/code.js'));
  assert.ok(!f.has('sub/generated.js'), 'nested .gitignore honoured');
  assert.ok(!f.has('excluded-by-git.txt'), '.git/info/exclude honoured');
  assert.ok(!f.has('.env'));
  assert.ok(!f.has('secret.txt'));
});

test('ignored directories are not descended into', async () => {
  const dir = fixture(tmpdir());
  const { listPublishFiles } = await mod();
  const r = listPublishFiles(dir);
  assert.ok(!r.files.some((f) => f.startsWith('node_modules/')));
  assert.ok(!r.files.some((f) => f.startsWith('dist/')));
});

test('an unignored credential file is caught by the name guard', async () => {
  const dir = tmpdir();
  // No .gitignore at all — exactly the case the audit worried about.
  write(path.join(dir, 'app.js'), 'console.log(1)\n');
  write(path.join(dir, '.env.production'), 'AWS_SECRET_ACCESS_KEY=nope\n');
  write(path.join(dir, 'id_rsa'), '-----BEGIN PRIVATE KEY-----\n');
  write(path.join(dir, 'gh-token.txt'), 'ghp_CCCC\n');
  const { listPublishFiles, looksSecret } = await mod();
  const r = listPublishFiles(dir);
  assert.ok(looksSecret('.env.production'));
  assert.ok(looksSecret('id_rsa'));
  assert.ok(looksSecret('gh-token.txt'));
  assert.ok(looksSecret('cookies.sqlite'));
  assert.ok(r.secrets.includes('.env.production'), r.secrets.join(','));
  assert.ok(r.secrets.includes('id_rsa'));
  assert.ok(!looksSecret('sub/code.js'));
  assert.ok(!looksSecret('README.md'));
});

describe('publish-to-github :: gitignore pattern engine');

test('anchoring, directory-only and glob rules behave', async () => {
  const { parseGitignore, isIgnored } = await mod();

  const rules = parseGitignore(['/root-only.txt', 'build/', 'src/**/*.min.js', 'a?c.txt', 'logs', ''].join('\n'));
  const check = (rel, dirs = []) => isIgnored(rel, rules, dirs);

  assert.equal(check('root-only.txt'), true, 'leading / anchors at the top level');
  assert.equal(check('sub/root-only.txt'), false, 'anchored rule does not match deeper');
  assert.equal(check('build/out.js', ['build']), true, 'directory-only rule ignores contents');
  assert.equal(check('build'), true, 'directory-only rule matches the directory itself');
  assert.equal(check('x/build/out.js', ['x', 'x/build']), true, 'build/ matches at any depth');
  assert.equal(check('src/a/b.min.js'), true, 'src/** matches nested dirs');
  assert.equal(check('src/b.min.js'), true, 'src/** matches zero dirs');
  assert.equal(check('abc.txt'), true, '? matches one character');
  assert.equal(check('abcd.txt'), false, '? matches exactly one character');
  assert.equal(check('logs/x.txt', ['logs']), true, 'bare name matches a directory at any depth');
  assert.equal(check('README.md'), false, 'unrelated file untouched');
});

test('comments, blank lines and escapes are not treated as patterns', async () => {
  const { parseGitignore } = await mod();
  const rules = parseGitignore(['# a comment', '', '   ', '\\#literal.txt', ''].join('\n'));
  assert.equal(rules.length, 1, `expected 1 rule, got ${rules.length}`);
});

describe('publish-to-github :: CLI');

test('--dry-run reports the plan and exits 0 without sending anything', () => {
  const dir = fixture(tmpdir());
  const api = startHelper('mock-github-api.mjs');
  try {
    const r = node([SCRIPT, '--dry-run', dir, 'demo', 'audit demo', 'cli,test'], { env: { GH_TOKEN: 'dummy', GH_API: api.url } });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('README.md'), r.stdout);
    assert.ok(!r.stdout.includes('SUPER-SECRET-TOKEN'), 'no file contents are printed');
    assert.ok(r.stdout.includes('nothing was sent to GitHub'), r.stdout);
    // Dry run may read (whoami, head, remote tree) but must never write.
    const writes = api.requests().filter((q) => q.method !== 'GET');
    assert.deepEqual(writes, [], `dry run issued ${writes.length} write request(s)`);
  } finally {
    api.stop();
  }
});

test('a publish sends only unignored files, and no secret blob', () => {
  const dir = fixture(tmpdir());
  const api = startHelper('mock-github-api.mjs');
  try {
    const r = node([SCRIPT, dir, 'demo', 'audit demo', 'cli,test'], { env: { GH_TOKEN: 'dummy', GH_API: api.url } });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);

    const treeReq = api.requests().find((q) => /\/git\/trees$/.test(q.url));
    const paths = treeReq.body.tree.map((t) => t.path);
    for (const bad of ['.env', 'secret.txt', 'debug.log', 'drop.tmp', 'node_modules/dep.js', 'dist/bundle.js']) {
      assert.ok(!paths.includes(bad), `${bad} was published: ${paths.join(', ')}`);
    }
    assert.ok(paths.includes('README.md'), paths.join(', '));
    assert.ok(paths.includes('sub/code.js'), paths.join(', '));

    // Blob contents travel as base64 in the request body; the secrets must not.
    const decoded = api
      .requests()
      .filter((q) => /\/git\/blobs$/.test(q.url))
      .map((q) => Buffer.from(q.body.content, 'base64').toString('utf8'))
      .join('\n');
    assert.ok(!decoded.includes('SUPER-SECRET-TOKEN'), 'secret.txt content reached the API');
    assert.ok(!decoded.includes('ghp_BBBB'), '.env content reached the API');
  } finally {
    api.stop();
  }
});

test('the tree is merged onto the branch head so remote-only files survive', () => {
  const dir = fixture(tmpdir());
  const api = startHelper('mock-github-api.mjs');
  try {
    const r = node([SCRIPT, dir, 'demo', 'audit demo'], { env: { GH_TOKEN: 'dummy', GH_API: api.url } });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const treeReq = api.requests().find((q) => /\/git\/trees$/.test(q.url));
    assert.equal(treeReq.body.base_tree, 'head1234', 'base_tree must be the branch head');
    const paths = treeReq.body.tree.map((t) => t.path);
    assert.ok(!paths.includes('.github/workflows/ci.yml'), 'a remote-only file must not become a deletion');
    assert.ok(!treeReq.body.tree.some((t) => t.sha === null), 'no deletions without --delete-remote');
    const commitReq = api.requests().find((q) => /\/git\/commits$/.test(q.url));
    assert.ok(commitReq.body.parents.includes('head1234'));
    assert.ok(r.stdout.includes('kept 2 remote-only path(s)'), r.stdout);
  } finally {
    api.stop();
  }
});

test('--delete-remote turns remote-only files into explicit deletions', () => {
  const dir = fixture(tmpdir());
  const api = startHelper('mock-github-api.mjs');
  try {
    const r = node([SCRIPT, '--delete-remote', dir, 'demo', 'audit demo'], { env: { GH_TOKEN: 'dummy', GH_API: api.url } });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const treeReq = api.requests().find((q) => /\/git\/trees$/.test(q.url));
    const deletions = treeReq.body.tree.filter((t) => t.sha === null).map((t) => t.path);
    assert.deepEqual(deletions.sort(), ['.github/workflows/ci.yml', 'docs/old.md']);
    assert.ok(r.stdout.includes('deleted 2 remote-only path(s)'), r.stdout);
  } finally {
    api.stop();
  }
});

test('a repo whose only file is a secret is refused with exit 3', () => {
  const dir = tmpdir();
  write(path.join(dir, '.env'), 'GH_TOKEN=ghp_ZZZ\n');
  write(path.join(dir, 'app.js'), 'ok\n');
  const r = node([SCRIPT, dir, 'demo', 'x']);
  assert.equal(r.status, 3, `expected the credential guard to stop it: ${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.includes('.env'), r.stderr);
});

test('an unknown option is a usage error, not a silent skip', () => {
  const r = node([SCRIPT, '--nope', 'dir', 'name', 'desc']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('a missing <name> prints usage', () => {
  const r = node([SCRIPT, tmpdir()]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('usage:'));
});

test('no token and no --dry-run stops before any request', () => {
  const dir = fixture(tmpdir());
  const r = node([SCRIPT, dir, 'demo', 'x'], { env: { GH_TOKEN: '', GITHUB_TOKEN: '', PATH: 'C:\\Windows\\System32' } });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.ok(/no token/.test(r.stderr), r.stderr);
});

test('GH_TOKEN and GITHUB_TOKEN are both accepted', () => {
  const dir = fixture(tmpdir());
  const api = startHelper('mock-github-api.mjs');
  try {
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
      const env = { GH_TOKEN: '', GITHUB_TOKEN: '', GH_API: api.url, [key]: 'dummy' };
      const r = node([SCRIPT, '--dry-run', dir, 'demo', 'x'], { env });
      assert.equal(r.status, 0, `${key} should be accepted, got: ${r.stderr}`);
      assert.ok(!/no token/.test(r.stderr), r.stderr);
    }
  } finally {
    api.stop();
  }
});
