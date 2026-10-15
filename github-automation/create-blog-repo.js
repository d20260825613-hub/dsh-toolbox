/**
 * Create a GitHub repository and configure it for a static site.
 *
 * Uses the REST API rather than `gh repo create` so every step is explicit and
 * verifiable, and so a partial failure can be retried per step instead of
 * re-running the whole creation.
 *
 * Steps: create repo -> enable Pages with GitHub Actions as the source ->
 * enable Discussions (needed by giscus) -> print the resulting URLs.
 *
 * Usage: node create-blog-repo.js
 */

import { apiRequest, resolveToken } from './gh-tunnel.js';

const token = resolveToken();
const OWNER = 'd20260825613-hub';
const NAME = 'd20260825613-hub.github.io';

const DESCRIPTION =
  '个人技术博客：Hugo + PaperMod，GitHub Actions 构建，GitHub Pages 托管，零服务器零费用。';

async function call(method, path, body, { ok = [200, 201, 204] } = {}) {
  const r = await apiRequest(method, path, { token, body });
  const okHere = ok.includes(r.status);
  const detail = typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200);
  console.log(`  ${method} ${path} -> ${r.status}${okHere ? '' : '  ' + detail}`);
  return r;
}

console.log('1) create repository');
let r = await call('POST', '/user/repos', {
  name: NAME,
  description: DESCRIPTION,
  homepage: `https://${NAME}/`,
  private: false,
  has_issues: true,
  has_projects: false,
  has_wiki: false,
  has_discussions: true,
  auto_init: false,
  gitignore_template: null,
  license_template: 'mit',
}, { ok: [201, 422] });

if (r.status === 422) {
  console.log('  (already exists, continuing)');
}

console.log('2) repository settings (description, topics, homepage)');
await call('PATCH', `/repos/${OWNER}/${NAME}`, {
  description: DESCRIPTION,
  homepage: `https://${NAME}/`,
  has_discussions: true,
  has_wiki: false,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
});
await call('PUT', `/repos/${OWNER}/${NAME}/topics`, {
  names: ['blog', 'hugo', 'papermod', 'github-pages', 'static-site', 'chinese'],
});

console.log('3) enable GitHub Pages with Actions as the build source');
// build_type=workflow is what makes deploy-pages work; the legacy "branch"
// source would need a gh-pages branch and a second workflow instead.
await call('POST', `/repos/${OWNER}/${NAME}/pages`, { build_type: 'workflow' }, { ok: [201, 409] });
await call('PUT', `/repos/${OWNER}/${NAME}/pages`, { build_type: 'workflow' }, { ok: [204, 200] });

console.log('4) verify');
const pages = await call('GET', `/repos/${OWNER}/${NAME}/pages`);
const repo = await call('GET', `/repos/${OWNER}/${NAME}`);
if (repo.status === 200) {
  console.log('  clone url  :', repo.body.clone_url);
  console.log('  discussions:', repo.body.has_discussions);
  console.log('  default    :', repo.body.default_branch, repo.body.private ? '(private)' : '(public)');
}
if (pages.status === 200) {
  console.log('  pages url  :', pages.body.html_url);
  console.log('  pages state:', pages.body.status, '| build_type:', pages.body.build_type);
}
