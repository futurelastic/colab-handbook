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
  assert.equal(d.classify([e('docs/logo.png', { binary: true })]).docsOnly, false);
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
