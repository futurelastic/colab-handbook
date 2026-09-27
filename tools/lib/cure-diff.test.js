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
const { cureDiffSignals, scriptsBlockDiffers, isPythonManifest, pythonIncludes, ABSENT } = require('./cure-diff');

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
  // A Python half (#377): the manifests the Python template installs from, and one file reached
  // only through an include, so the include closure is exercised against an UNCHANGED includer.
  fs.mkdirSync(path.join(dir, 'svc/deps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'svc/pyproject.toml'), '[project]\nname = "svc"\ndependencies = ["fastapi"]\n');
  fs.writeFileSync(path.join(dir, 'svc/requirements-dev.txt'), '-r deps/test.txt\nruff==0.6.0\n');
  fs.writeFileSync(path.join(dir, 'svc/deps/test.txt'), 'pytest==8.3.0\n');
  fs.writeFileSync(path.join(dir, 'svc/app.py'), 'x = 1\n');
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

test('an unreadable range → ok:false with every flag null, never throws', () => withRepo((r) => {
  const s = cureDiffSignals(git, r.dir, 'main', 'no-such-branch');
  assert.equal(s.ok, false);
  assert.equal(s.workflowsTouched, null);
  assert.equal(s.manifestScriptsTouched, null);
  assert.equal(s.pythonManifestTouched, null);
}));

// --- #377 condition 6: Python dependency manifests -------------------------------------------

test('the #377 case: pytest dropped from requirements-dev.txt → Python manifest touched, named, and neither other door sees it', () => withRepo((r) => {
  r.write('svc/requirements-dev.txt', 'ruff==0.6.0\n'); r.commit('drop the test include');
  const s = r.signals();
  assert.equal(s.pythonManifestTouched, true);
  assert.deepEqual(s.pythonManifestPaths, ['svc/requirements-dev.txt']);
  assert.equal(s.workflowsTouched, false);
  assert.equal(s.manifestScriptsTouched, false);
}));

test('a file reached only through an unchanged -r include → touched (the include closure, not the name)', () => withRepo((r) => {
  r.write('svc/deps/test.txt', '# pytest removed\n'); r.commit('gut the included file');
  const s = r.signals();
  assert.equal(s.pythonManifestTouched, true);
  assert.deepEqual(s.pythonManifestPaths, ['svc/deps/test.txt']);
}));

test('an include deleted WITH its target → both touched (the base side still sees the include)', () => withRepo((r) => {
  r.write('svc/requirements-dev.txt', 'ruff==0.6.0\n');
  r.g('rm', '-q', 'svc/deps/test.txt'); r.commit('drop both');
  assert.deepEqual(r.signals().pythonManifestPaths.sort(), ['svc/deps/test.txt', 'svc/requirements-dev.txt']);
}));

test('pyproject.toml dependencies edited → touched (whole-file: a version pin counts, the accepted false refusal)', () => withRepo((r) => {
  r.write('svc/pyproject.toml', '[project]\nname = "svc"\ndependencies = ["fastapi<0.100"]\n'); r.commit('pin');
  assert.deepEqual(r.signals().pythonManifestPaths, ['svc/pyproject.toml']);
}));

test('a [tool.setuptools.dynamic] file = target → touched through the pyproject include', () => withRepo((r) => {
  r.write('svc/pyproject.toml', '[project]\nname = "svc"\ndynamic = ["dependencies"]\n[tool.setuptools.dynamic]\ndependencies = {file = ["deps/runtime.list"]}\n');
  r.write('svc/deps/runtime.list', 'fastapi\n'); r.commit('dynamic deps');
  r.g('checkout', '-q', 'main'); r.g('merge', '-q', '--ff-only', 'b'); r.g('checkout', '-q', 'b');
  r.write('svc/deps/runtime.list', 'fastapi\nhttpx\n'); r.commit('edit the dynamic file');
  assert.deepEqual(r.signals().pythonManifestPaths, ['svc/deps/runtime.list']);
}));

test('a requirements file ADDED, and one RENAMED away → both touched', () => withRepo((r) => {
  r.write('requirements.txt', 'flask\n'); r.g('mv', 'svc/requirements-dev.txt', 'svc/dev.txt.off'); r.commit('add + move');
  const s = r.signals();
  assert.equal(s.pythonManifestTouched, true);
  assert.ok(s.pythonManifestPaths.includes('requirements.txt'));
  assert.ok(s.pythonManifestPaths.includes('svc/requirements-dev.txt'), 'the deleted side of the move counts');
}));

test('Python code, a README.txt and a lockfile changing → not a Python manifest touch', () => withRepo((r) => {
  r.write('svc/app.py', 'x = 2\n'); r.write('README.txt', 'hi\n'); r.write('svc/poetry.lock', 'x\n'); r.commit('code');
  const s = r.signals();
  assert.equal(s.pythonManifestTouched, false);
  assert.deepEqual(s.pythonManifestPaths, []);
}));

test('a chmod-only change to requirements-dev.txt → not touched', () => withRepo((r) => {
  fs.chmodSync(path.join(r.dir, 'svc/requirements-dev.txt'), 0o755); r.commit('chmod');
  assert.equal(r.signals().pythonManifestTouched, false);
}));

test('isPythonManifest / pythonIncludes: the pure name and include rules', () => {
  for (const p of ['pyproject.toml', 'a/setup.py', 'a/setup.cfg', 'requirements.txt', 'x/dev-requirements.in',
    'requirements/test.txt', 'svc/requirements/base.in']) assert.equal(isPythonManifest(p), true, p);
  for (const p of ['README.txt', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'docs/requirements.md', 'app.py']) {
    assert.equal(isPythonManifest(p), false, p);
  }
  assert.deepEqual(pythonIncludes('a/requirements-dev.txt',
    '-r base.txt\n-c ../constraints.txt  # pin\n--requirement=deps/t.txt\n-rfoo.txt\npytest\n-r https://x/y.txt\n# -r ignored.txt\n-r ../../escape.txt\n'),
  ['a/base.txt', 'constraints.txt', 'a/deps/t.txt', 'a/foo.txt']);
  assert.deepEqual(pythonIncludes('pyproject.toml',
    '[project]\nreadme = {file = "README.md"}\n[tool.setuptools.dynamic]\ndependencies = {file = ["req.in", "sub/b.txt"]}\n[tool.other]\nx = {file = "no.txt"}\n'),
  ['req.in', 'sub/b.txt'], 'only [tool.setuptools.dynamic] files — a readme include is not an install input');
});

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
