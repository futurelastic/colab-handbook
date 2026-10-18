'use strict';
/**
 * Unit tests for lib/docs-only.js (#345) — the classifier behind the docs-only exception to
 * `colab ship`'s autonomy gate. The CLI wiring is tested end to end in ship-docs-only.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('./git');
const d = require('./docs-only');

const e = (p, extra = {}) => ({ path: p, oldMode: '100644', newMode: '100644', binary: false, ...extra });

test('the allowlist: .md, .mdx, .txt at any depth, and anything under a top-level docs/', () => {
  for (const p of ['README.md', 'a/b/guide.mdx', 'notes.txt', 'docs/build.js', 'docs/img/x.svg']) {
    assert.equal(d.pathReason(p), null, p);
  }
});

test('outside the allowlist: other extensions, no extension, a nested docs/, an upper-case extension', () => {
  for (const p of ['tools/colab', 'a.js', 'Makefile', 'src/docs/x.js', 'README.MD', '.md']) {
    assert.notEqual(d.pathReason(p), null, p);
  }
});

test('the exclusions win over the allowlist, at any depth', () => {
  for (const p of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'pkg/CLAUDE.md', 'docs/AGENTS.md',
    '.claude/skills/x.md', '.github/project.yml', '.github/ISSUE_TEMPLATE/bug.md', '.githooks/README.txt',
    'docs/.github/x.md']) {
    assert.notEqual(d.pathReason(p), null, p);
  }
});

test('#520: a skill local-policy overlay under .colab/skills/ is agent instructions, at any depth', () => {
  for (const p of ['.colab/skills/code-wrap.md', '.colab/skills/x/y.txt', 'pkg/.colab/skills/code-start.md',
    'docs/.colab/skills/code-ship.md']) {
    assert.match(d.pathReason(p), /\.colab\/skills\/ \(skill local policy/, p);
  }
  const v = d.classify([e('README.md'), e('.colab/skills/code-wrap.md')]);
  assert.equal(v.docsOnly, false);
  assert.deepEqual(v.offenders.map((o) => o.path), ['.colab/skills/code-wrap.md']);
});

test('#520: only the .colab/skills subtree is excluded — other .colab docs and look-alikes judge normally', () => {
  for (const p of ['.colab/README.md', '.colab/skills.md', 'skills/code-wrap/x.md', '.colab/hooks/notes.txt']) {
    assert.equal(d.pathReason(p), null, p);
  }
});

test('classify: an all-docs set passes and counts distinct paths', () => {
  const v = d.classify([e('README.md'), e('docs/a.js'), e('README.md')]);
  assert.equal(v.docsOnly, true);
  assert.equal(v.files, 2);
  assert.equal(v.reason, 'docs-only (2 files)');
});

test('classify: an empty set is never docs-only', () => {
  const v = d.classify([]);
  assert.equal(v.docsOnly, false);
  assert.match(v.reason, /empty diff/);
});

test('classify: one code path among docs refuses and names it', () => {
  const v = d.classify([e('README.md'), e('tools/x.js')]);
  assert.equal(v.docsOnly, false);
  assert.deepEqual(v.offenders.map((o) => o.path), ['tools/x.js']);
});

test('classify: a symlink, a submodule or a binary refuses even under an allowed name', () => {
  assert.equal(d.classify([e('link.md', { newMode: '120000' })]).docsOnly, false);
  assert.equal(d.classify([e('link.md', { oldMode: '120000', newMode: '000000' })]).docsOnly, false);
  assert.equal(d.classify([e('docs/vendor', { newMode: '160000' })]).docsOnly, false);
  assert.equal(d.classify([e('docs/logo.zip', { binary: true })]).docsOnly, false);
  assert.equal(d.classify([e('docs/design/x.png', { newMode: '120000', binary: true })]).docsOnly, false);
});

test('#606: a binary design artifact under docs/ is documentation; any other binary is not', () => {
  for (const p of ['docs/design/x.png', 'docs/a.JPG', 'docs/b.jpeg', 'docs/c.gif', 'docs/d.WebP', 'docs/e.svg', 'docs/spec.PDF']) {
    assert.equal(d.classify([e(p, { binary: true })]).docsOnly, true, p);
  }
  for (const p of ['assets/x.png', 'a/docs/x.png', 'docs/x.zip', 'docs/x.exe', 'docs/.png', 'README.pdf']) {
    const v = d.classify([e(p, { binary: true })]);
    assert.equal(v.docsOnly, false, p);
  }
  assert.match(d.classify([e('assets/x.png', { binary: true })]).reason, /binary change/);
  // the unchanged exclusions still hold, binary or not.
  for (const p of ['AGENTS.md', 'docs/CLAUDE.md', '.github/x.png', 'docs/.claude/x.png', '.colab/skills/x.md']) {
    assert.equal(d.classify([e(p)]).docsOnly, false, p);
  }
});

test('#606: classify honours the ci-docs-skip exclusions — by path prefix, never string prefix', () => {
  const ex = { exclude: ['docs/api', 'README.md'] };
  assert.equal(d.classify([e('docs/api/x.md')], ex).docsOnly, false);
  assert.match(d.classify([e('docs/api/x.md')], ex).reason, /listed in ci-docs-skip \(docs\/api\)/);
  assert.equal(d.classify([e('README.md')], ex).docsOnly, false);
  assert.equal(d.classify([e('docs/apiary.md'), e('a/README.md')], ex).docsOnly, true);
  assert.equal(d.classify([e('docs/api/x.md')]).docsOnly, true, 'no list, no exclusion');
});

// ---- against real git: renames, deletions, binaries, symlinks -------------------------------

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'docs-only test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'x\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'r\n');
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'b');
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); };
  return { dir, g, commit, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('branchChanges: a rename judges BOTH names — code renamed to .md refuses', () => {
  const r = repo();
  try {
    r.g('mv', 'a.js', 'a.md'); r.commit('rename');
    const v = d.branchChanges(git, r.dir, 'main', 'b');
    assert.equal(v.docsOnly, false);
    assert.deepEqual(v.offenders.map((o) => o.path), ['a.js']);
  } finally { r.cleanup(); }
});

test('branchChanges: deleting a doc and editing another is docs-only', () => {
  const r = repo();
  try {
    fs.writeFileSync(path.join(r.dir, 'NEW.md'), 'n\n'); r.commit('add');
    r.g('rm', '-q', 'README.md'); r.commit('del');
    const v = d.branchChanges(git, r.dir, 'main', 'b');
    assert.equal(v.docsOnly, true, v.reason);
    assert.equal(v.files, 2);
  } finally { r.cleanup(); }
});

test('branchChanges: git-detected binary content under a .txt name refuses', () => {
  const r = repo();
  try {
    fs.writeFileSync(path.join(r.dir, 'blob.txt'), Buffer.from([0, 1, 2, 0, 255]));
    r.commit('bin');
    const v = d.branchChanges(git, r.dir, 'main', 'b');
    assert.equal(v.docsOnly, false);
    assert.match(v.reason, /binary/);
  } finally { r.cleanup(); }
});

test('branchChanges: a symlink named .md refuses', () => {
  const r = repo();
  try {
    fs.symlinkSync('a.js', path.join(r.dir, 'link.md')); r.commit('link');
    const v = d.branchChanges(git, r.dir, 'main', 'b');
    assert.equal(v.docsOnly, false);
    assert.match(v.reason, /symlink/);
  } finally { r.cleanup(); }
});

test('branchChanges: an unreadable range refuses, never throws', () => {
  const r = repo();
  try {
    const v = d.branchChanges(git, r.dir, 'main', 'no-such-branch');
    assert.equal(v.docsOnly, false);
    assert.match(v.reason, /could not read/);
  } finally { r.cleanup(); }
});

test('directChanges: no creation time, or no commits since it, refuses', () => {
  const r = repo();
  try {
    assert.equal(d.directChanges(git, r.dir, 'main', null).docsOnly, false);
    const future = new Date(Date.now() + 3600e3).toISOString();
    const v = d.directChanges(git, r.dir, 'main', future);
    assert.equal(v.docsOnly, false);
    assert.match(v.reason, /empty diff/);
  } finally { r.cleanup(); }
});

test('directChanges: every commit since the claim counts, including the root commit', () => {
  const r = repo();
  try {
    const past = new Date(Date.now() - 3600e3).toISOString();
    const v = d.directChanges(git, r.dir, 'main', past);
    assert.equal(v.docsOnly, false); // the root commit added a.js
    assert.deepEqual(v.offenders.map((o) => o.path), ['a.js']);
  } finally { r.cleanup(); }
});

test('#570/#606: ci-docs-skip — absent is ON, off is off, a list of plain repo paths is on, anything else is a finding', () => {
  const { parseCiDocsSkip } = require('./docs-only.js');
  assert.deepStrictEqual(parseCiDocsSkip({}), { declared: false, valid: true, on: true, exclude: [], reason: parseCiDocsSkip({}).reason });
  assert.deepStrictEqual(parseCiDocsSkip(null).on, true);
  for (const off of ['off', false]) {
    const r = parseCiDocsSkip({ 'ci-docs-skip': off });
    assert.deepStrictEqual([r.declared, r.valid, r.on], [true, true, false], String(off));
  }
  // an empty value is not absence: every reader takes it as "CI required", so it is a finding.
  assert.deepStrictEqual([parseCiDocsSkip({ 'ci-docs-skip': null }).valid, parseCiDocsSkip({ 'ci-docs-skip': null }).on], [false, false]);
  assert.deepStrictEqual(parseCiDocsSkip({ 'ci-docs-skip': [] }).exclude, []);
  const on = parseCiDocsSkip({ 'ci-docs-skip': ['docs/api/', 'openapi.md'] });
  assert.ok(on.valid && on.on);
  assert.deepStrictEqual(on.exclude, ['docs/api', 'openapi.md']);
  for (const v of [true, 'yes', 'on', 'OFF', {}, ['docs/*'], ['../x'], ['/abs'], ['a//b'], ['./x'], [''], [3], ['a b']]) {
    const r = parseCiDocsSkip({ 'ci-docs-skip': v });
    assert.strictEqual(r.valid, false, JSON.stringify(v));
    assert.strictEqual(r.on, false, JSON.stringify(v));
  }
});

test('#570: a build input is never documentation, despite the .txt extension', () => {
  for (const p of ['requirements.txt', 'a/requirements-dev.txt', 'dev-Requirements.txt', 'requirements/base.txt',
    'docs/requirements.txt', 'constraints.txt', 'CMakeLists.txt', 'lib/CMakeLists.txt']) {
    assert.match(d.pathReason(p), /build input/, p);
  }
  for (const p of ['notes.txt', 'requirements.md', 'cmakelists.txt', 'docs/build.txt']) assert.strictEqual(d.pathReason(p), null, p);
  assert.strictEqual(d.classify([{ path: 'README.md' }, { path: 'requirements.txt' }]).docsOnly, false);
});

// ---- #626: docs-only-paths ------------------------------------------------------------------------

test('#626 parseDocsOnlyPaths: absent and [] add nothing; a plain list is read, trailing slash dropped', () => {
  assert.deepEqual(d.parseDocsOnlyPaths({}).include, []);
  assert.equal(d.parseDocsOnlyPaths({}).declared, false);
  assert.deepEqual(d.parseDocsOnlyPaths({ 'docs-only-paths': [] }).include, []);
  const v = d.parseDocsOnlyPaths({ 'docs-only-paths': ['public/images/blog/', 'content'] });
  assert.equal(v.valid, true);
  assert.deepEqual(v.include, ['public/images/blog', 'content']);
});

test('#626 parseDocsOnlyPaths: a glob, an absolute path, .., a scalar or an empty value is invalid and reads as absent', () => {
  for (const val of [['public/images/blog/**'], ['/abs'], ['a/../b'], ['./a'], 'public/images', null, [''], [3]]) {
    const v = d.parseDocsOnlyPaths({ 'docs-only-paths': val });
    assert.equal(v.valid, false, JSON.stringify(val));
    assert.deepEqual(v.include, [], JSON.stringify(val));
    assert.match(v.reason, /^docs-only-paths .* plain repo paths/);
  }
});

const INC = { include: ['public/images/blog'] };

test('#626 classify: an image under a declared path is docs-only WITH include, and never without it (autonomy unchanged)', () => {
  const set = [e('public/images/blog/a.PNG', { binary: true }), e('public/images/blog/x/b.webp', { binary: true }),
    e('public/images/blog/c.svg'), e('content/post.md')];
  assert.equal(d.classify(set, INC).docsOnly, true);
  const narrow = d.classify(set);
  assert.equal(narrow.docsOnly, false);
  assert.equal(narrow.offenders.length, 3);
});

test('#626 classify: under a declared path only content extensions count — code, no extension and a look-alike prefix refuse', () => {
  for (const p of ['public/images/blog/app.js', 'public/images/blog/Makefile', 'public/images/blogroll/a.png', 'public/images/a.png']) {
    assert.equal(d.classify([e(p, { binary: p.endsWith('.png') })], INC).docsOnly, false, p);
  }
});

test('#626 classify: the never-rules, ci-docs-skip, symlinks and submodules still win inside a declared path', () => {
  const inc = { include: ['public/images/blog', '.github'], exclude: ['public/images/blog/feed'] };
  for (const ent of [e('public/images/blog/CLAUDE.md'), e('.github/x.png', { binary: true }),
    e('public/images/blog/feed/a.png', { binary: true }), e('public/images/blog/l.png', { newMode: '120000' }),
    e('public/images/blog/m.png', { newMode: '160000' }), e('public/images/blog/requirements.txt')]) {
    assert.equal(d.classify([ent], inc).docsOnly, false, ent.path);
  }
});

test('#626 shipDocsOnly reads the declaration; branchChanges (the autonomy exception) does not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-paths-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g('init', '-q', '-b', 'main', '.'); g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-q', '-m', 'init');
    g('checkout', '-q', '-b', 'b');
    fs.mkdirSync(path.join(dir, 'public/images/blog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public/images/blog/a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 0]));
    g('add', '-A'); g('commit', '-q', '-m', 'img');
    const doc = { 'docs-only-paths': ['public/images/blog'] };
    assert.equal(d.shipDocsOnly(git, dir, 'main', 'b', doc).docsOnly, true);
    assert.equal(d.shipDocsOnly(git, dir, 'main', 'b', {}).docsOnly, false);
    assert.equal(d.shipDocsOnly(git, dir, 'main', 'b', { ...doc, 'ci-docs-skip': 'off' }).docsOnly, false);
    assert.equal(d.branchChanges(git, dir, 'main', 'b').docsOnly, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
