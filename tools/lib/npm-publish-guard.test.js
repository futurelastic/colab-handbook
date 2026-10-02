'use strict';
/** Tests for the private-repo / public-npm rule — issue #432. Run: node --test tools/lib/npm-publish-guard.test.js */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('./npm-publish-guard.js');

function reader(files) {
  const readFile = (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null);
  const listDir = (d) => {
    const pre = d.replace(/\/$/, '') + '/';
    return [...new Set(Object.keys(files).filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))];
  };
  const workflows = Object.keys(files).filter((f) => f.startsWith('.github/workflows/')).map((f) => path.basename(f));
  return { readFile, listDir, workflows };
}
const pkg = (o) => JSON.stringify(o);
const PUBLISH_WF = 'on: push\njobs:\n  p:\n    steps:\n      - run: npm publish --access public\n';
const run = (files, visibility) => guard.findings({ ...reader(files), visibility });

test('private repo missing "private": true fails', () => {
  const f = run({ 'package.json': pkg({ name: '@o/x' }) }, 'private');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].level, 'fail');
  assert.match(f[0].text, /package\.json lacks "private": true/);
});

test('private repo with "private": true and no publish step passes', () => {
  assert.deepStrictEqual(run({ 'package.json': pkg({ name: 'x', private: true }) }, 'private'), []);
});

test('private repo with a publish step fails, even with private: true', () => {
  const f = run({ 'package.json': pkg({ private: true }), '.github/workflows/rel.yml': PUBLISH_WF }, 'private');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].level, 'fail');
  assert.match(f[0].text, /rel\.yml:5 publishes to public npm/);
});

test('every publish spelling is caught; dry-run, other registries and comments are not', () => {
  const w = (cmd) => ({ '.github/workflows/w.yml': `steps:\n  - run: ${cmd}\n` });
  for (const c of ['pnpm publish', 'yarn npm publish', 'yarn publish', 'bun publish', 'npm publish --registry=https://registry.npmjs.org']) {
    assert.strictEqual(run(w(c), 'private').length, 1, c);
  }
  assert.strictEqual(run({ '.github/workflows/w.yml': 'steps:\n  - uses: JS-DevTools/npm-publish@v3\n' }, 'private').length, 1);
  for (const c of ['npm publish --dry-run', 'npm publish --registry https://npm.pkg.github.com', 'echo ok # npm publish']) {
    assert.deepStrictEqual(run(w(c), 'private'), [], c);
  }
});

test('publishConfig.registry pointing at public npm fails', () => {
  const f = run({ 'package.json': pkg({ private: true, publishConfig: { registry: 'https://registry.npmjs.org/' } }) }, 'private');
  assert.strictEqual(f.length, 1);
  assert.match(f[0].text, /publishConfig\.registry/);
});

test('a workspace member without private: true fails (array, object and pnpm forms)', () => {
  const member = { 'packages/a/package.json': pkg({ name: 'a' }) };
  for (const root of [
    { 'package.json': pkg({ private: true, workspaces: ['packages/*'] }) },
    { 'package.json': pkg({ private: true, workspaces: { packages: ['packages/a'] } }) },
    { 'package.json': pkg({ private: true }), 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" },
  ]) {
    const f = run({ ...root, ...member }, 'private');
    assert.strictEqual(f.length, 1);
    assert.match(f[0].text, /packages\/a\/package\.json lacks/);
  }
});

test('public repo with both problems passes', () => {
  assert.deepStrictEqual(run({ 'package.json': pkg({ name: '@o/x' }), '.github/workflows/rel.yml': PUBLISH_WF }, 'public'), []);
});

test('unknown visibility is reported, not passed — but only when there is an npm surface', () => {
  const f = run({ 'package.json': pkg({ name: 'x' }) }, null);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].level, 'warn');
  assert.match(f[0].text, /visibility could not be read/);
  assert.deepStrictEqual(run({ 'README.md': 'hi' }, null), []);
  assert.deepStrictEqual(run({ 'package.json': pkg({ private: true }) }, null), []);
});

test('audit end to end: a repo with no GitHub remote and an npm gap warns instead of passing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-guard-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main', '.');
    g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
    fs.mkdirSync(path.join(dir, '.github'));
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ name: 'x' }));
    g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture');
    let out;
    try { out = execFileSync('node', [path.join(__dirname, '..', '..', 'audit', 'audit.mjs'), '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { out = e.stdout; }
    const texts = JSON.parse(out).results[0].findings.filter((f) => /private-repo npm rule/.test(f.text));
    assert.strictEqual(texts.length, 1);
    assert.strictEqual(texts[0].level, 'warn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
