'use strict';
/**
 * Tests for lib/cure-diff.js (#297) — the diff signals behind the cure rule's conditions 4 and 5:
 * whether a branch touches `.github/workflows/**`, and whether it changes the `scripts` block of any
 * `package.json`. Against real git, because the failure modes live in git's own output (renames,
 * deletions, symlinks); the verdict they feed is tested purely in ci-cure.test.js.
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
const { cureDiffSignals, scriptsBlockDiffers, ABSENT } = require('./cure-diff');

const PKG = { name: 'app', version: '1.0.0', scripts: { lint: 'eslint .', test: 'node --test' }, dependencies: { a: '1.0.0' } };
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-diff-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'cure-diff test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/a'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), 'name: CI\n');
  fs.writeFileSync(path.join(dir, 'package.json'), json(PKG));
  fs.writeFileSync(path.join(dir, 'packages/a/package.json'), json({ name: 'a', scripts: { test: 'vitest' } }));
  fs.writeFileSync(path.join(dir, 'src.js'), 'x\n');
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'b');
  const write = (p, text) => fs.writeFileSync(path.join(dir, p), text);
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); };
  const signals = () => cureDiffSignals(git, dir, 'main', 'b');
  return { dir, g, write, commit, signals, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withRepo(fn) {
  const r = repo();
  try { fn(r); } finally { r.cleanup(); }
}

test('a diff touching neither instrument path → both false', () => withRepo((r) => {
  r.write('src.js', 'y\n'); r.commit('code');
  const s = r.signals();
  assert.equal(s.ok, true);
  assert.equal(s.workflowsTouched, false);
  assert.equal(s.manifestScriptsTouched, false);
  assert.deepEqual(s.manifestPaths, []);
}));

test('a dependency-only package.json bump → scripts untouched', () => withRepo((r) => {
  r.write('package.json', json({ ...PKG, dependencies: { a: '2.0.0' } })); r.commit('bump');
  assert.equal(r.signals().manifestScriptsTouched, false);
}));

test('the #297 case: scripts.test removed → touched, and named', () => withRepo((r) => {
  const { test: _gone, ...rest } = PKG.scripts;
  r.write('package.json', json({ ...PKG, scripts: rest })); r.commit('drop test');
  const s = r.signals();
  assert.equal(s.manifestScriptsTouched, true);
  assert.deepEqual(s.manifestPaths, ['package.json']);
  assert.equal(s.workflowsTouched, false, 'no workflow file was touched — condition 4 alone would miss this');
}));

test('a script COMMAND edited (the name kept) → touched', () => withRepo((r) => {
  r.write('package.json', json({ ...PKG, scripts: { ...PKG.scripts, test: 'true' } })); r.commit('gut');
  assert.equal(r.signals().manifestScriptsTouched, true);
}));

test('scripts keys merely reordered → not touched', () => withRepo((r) => {
  r.write('package.json', json({ ...PKG, scripts: { test: 'node --test', lint: 'eslint .' } })); r.commit('reorder');
  assert.equal(r.signals().manifestScriptsTouched, false);
}));

test('a NESTED package.json scripts change → touched (any depth, not just the root)', () => withRepo((r) => {
  r.write('packages/a/package.json', json({ name: 'a', scripts: {} })); r.commit('nested');
  const s = r.signals();
  assert.equal(s.manifestScriptsTouched, true);
  assert.deepEqual(s.manifestPaths, ['packages/a/package.json']);
}));

test('package.json deleted → touched (it flips the template\'s hashFiles guard off every Node step)', () => withRepo((r) => {
  r.g('rm', '-q', 'package.json'); r.commit('delete');
  assert.equal(r.signals().manifestScriptsTouched, true);
}));

test('package.json RENAMED away → touched (--no-renames sees the deleted side)', () => withRepo((r) => {
  r.g('mv', 'package.json', 'package.json.bak'); r.commit('rename');
  const s = r.signals();
  assert.equal(s.manifestScriptsTouched, true);
  assert.deepEqual(s.manifestPaths, ['package.json']);
}));

test('a package.json ADDED → touched', () => withRepo((r) => {
  fs.mkdirSync(path.join(r.dir, 'packages/b'), { recursive: true });
  r.write('packages/b/package.json', json({ name: 'b', scripts: { test: 'x' } })); r.commit('add');
  assert.equal(r.signals().manifestScriptsTouched, true);
}));

test('the head package.json does not parse → null (unmeasurable), never false', () => withRepo((r) => {
  r.write('package.json', '{ "scripts": '); r.commit('broken');
  const s = r.signals();
  assert.equal(s.ok, true);
  assert.equal(s.manifestScriptsTouched, null);
  assert.match(s.reason, /package\.json/);
}));

test('an unparseable nested manifest does not hide a touched root one → true wins over null', () => withRepo((r) => {
  r.write('packages/a/package.json', 'not json'); r.write('package.json', json({ ...PKG, scripts: {} })); r.commit('both');
  const s = r.signals();
  assert.equal(s.manifestScriptsTouched, true);
  assert.deepEqual(s.manifestPaths, ['package.json']);
}));

test('a BOM-prefixed rewrite with the same scripts → not touched', () => withRepo((r) => {
  r.write('package.json', `﻿${json({ ...PKG, version: '1.0.1' })}`); r.commit('bom');
  assert.equal(r.signals().manifestScriptsTouched, false);
}));

test('a chmod-only change to package.json → not touched', () => withRepo((r) => {
  fs.chmodSync(path.join(r.dir, 'package.json'), 0o755);
  r.g('config', 'core.fileMode', 'true');
  r.commit('chmod');
  assert.equal(r.signals().manifestScriptsTouched, false);
}));

test('package.json turned into a symlink → null (a manifest that is not a plain file is unmeasurable)', () => withRepo((r) => {
  r.write('real.json', json(PKG));
  fs.rmSync(path.join(r.dir, 'package.json'));
  fs.symlinkSync('real.json', path.join(r.dir, 'package.json'));
  r.commit('symlink');
  assert.equal(r.signals().manifestScriptsTouched, null);
}));

test('regression: a workflow file MOVED out of .github/workflows/ counts as touching it', () => withRepo((r) => {
  fs.mkdirSync(path.join(r.dir, 'disabled'), { recursive: true });
  r.g('mv', '.github/workflows/ci.yml', 'disabled/ci.yml'); r.commit('disable ci');
  assert.equal(r.signals().workflowsTouched, true);
}));

test('an ordinary workflow edit → workflowsTouched', () => withRepo((r) => {
  r.write('.github/workflows/ci.yml', 'name: CI2\n'); r.commit('wf');
  assert.equal(r.signals().workflowsTouched, true);
}));

test('an unreadable range → ok:false with both flags null, never throws', () => withRepo((r) => {
  const s = cureDiffSignals(git, r.dir, 'main', 'no-such-branch');
  assert.equal(s.ok, false);
  assert.equal(s.workflowsTouched, null);
  assert.equal(s.manifestScriptsTouched, null);
}));

test('scriptsBlockDiffers: the pure comparator', () => {
  assert.equal(scriptsBlockDiffers(ABSENT, ABSENT), false);
  assert.equal(scriptsBlockDiffers(ABSENT, '{}'), true);
  assert.equal(scriptsBlockDiffers('{}', ABSENT), true);
  assert.equal(scriptsBlockDiffers('{"scripts":null}', '{}'), false, 'the template reads scripts || {}');
  assert.equal(scriptsBlockDiffers('{"scripts":{}}', '{"name":"x"}'), false);
  assert.equal(scriptsBlockDiffers('{"scripts":{"t":"a"}}', '{"scripts":{"t":"b"}}'), true);
  assert.equal(scriptsBlockDiffers('[]', '{}'), null, 'a top-level array is not a manifest');
  assert.equal(scriptsBlockDiffers('{', '{}'), null);
});
