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

// ---- #442: GitHub Release assets are not an install path (advisory) ---------------------------
const assets = (files, visibility) => guard.assetFindings({ ...reader(files), visibility });
const wf = (body) => ({ '.github/workflows/rel.yml': body });

test('#442 private repo uploading Release assets warns — every upload spelling', () => {
  for (const body of [
    'steps:\n  - run: gh release upload "$TAG" dist/tool-linux-x64\n',
    'steps:\n  - run: gh release create "$TAG" --title "$TAG" dist/*\n',
    'steps:\n  - run: gh release create v1.0.0 tool.tar.gz --notes "x"\n',
    'steps:\n  - uses: softprops/action-gh-release@v2\n    with:\n      files: dist/*\n',
    'steps:\n  - uses: ncipollo/release-action@v1\n    with:\n      artifacts: "dist/*.zip"\n',
    'steps:\n  - uses: svenstaro/upload-release-action@v2\n',
    'steps:\n  - uses: actions/upload-release-asset@v1\n',
  ]) {
    const f = assets(wf(body), 'private');
    assert.strictEqual(f.length, 1, body);
    assert.strictEqual(f[0].level, 'warn', 'advisory, never a failure');
    assert.match(f[0].text, /rel\.yml:\d+ .*Release asset.*dist refs/);
  }
});

test('#442 notes-only releases are not asset uploads (the handbook\'s own release templates)', () => {
  for (const body of [
    'steps:\n  - run: gh release create "$TAG" --verify-tag --title "$TAG" --notes-file "$NOTES" --generate-notes "${KIND[@]}"\n',
    'steps:\n  - run: gh release create v1.0.0 --notes "a.b release" -t "v1.0.0"\n',
    'steps:\n  - uses: softprops/action-gh-release@v2\n    with:\n      body_path: NOTES.md\n  - name: next\n    with:\n      files: other.txt\n',
    'steps:\n  - run: echo ok # gh release upload v1 x.tgz\n',
  ]) {
    assert.deepStrictEqual(assets(wf(body), 'private'), [], body);
  }
  for (const t of ['release-auto.yml', 'release-tag.yml']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', t), 'utf8');
    assert.deepStrictEqual(assets({ [`.github/workflows/${t}`]: text }, 'private'), [], t);
  }
});

test('#442 public repos pass; unknown visibility is one warn naming every site', () => {
  const body = 'steps:\n  - run: gh release upload v1 a.tgz\n  - run: gh release upload v1 b.tgz\n';
  assert.deepStrictEqual(assets(wf(body), 'public'), []);
  const f = assets(wf(body), null);
  assert.strictEqual(f.length, 1);
  assert.match(f[0].text, /could not be read.*rel\.yml:2.*rel\.yml:3/);
  assert.deepStrictEqual(assets({ 'README.md': 'hi' }, null), []);
});

test('#442 audit end to end: a no-remote repo uploading Release assets warns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-guard-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main', '.');
    g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: go\n');
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'rel.yml'), 'on: push\njobs:\n  r:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release upload v1 dist/tool\n');
    g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture');
    let out;
    try { out = execFileSync('node', [path.join(__dirname, '..', '..', 'audit', 'audit.mjs'), '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { out = e.stdout; }
    const hits = JSON.parse(out).results[0].findings.filter((f) => /Release-asset install rule/.test(f.text));
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].level, 'warn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#442 release-tag.yml\'s ATTACH_ARTIFACTS switch: off as shipped, reported once turned on', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'release-tag.yml'), 'utf8');
  assert.match(text, /ATTACH_ARTIFACTS: "false"/, 'the template ships the switch off');
  const on = text.replace('ATTACH_ARTIFACTS: "false"', 'ATTACH_ARTIFACTS: "true"');
  const f = assets({ '.github/workflows/release.yml': on }, 'private');
  assert.strictEqual(f.length, 1);
  assert.match(f[0].text, /softprops\/action-gh-release/);
});
