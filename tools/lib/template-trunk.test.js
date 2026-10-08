'use strict';
/**
 * #526: `colab template ci-*` writes the repo's declared trunk into the copy.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Pins the pure rewrite (tools/lib/template-trunk.js) against every live CI template, then the CLI
 * end to end on the measured scenario: trunk `master`, no build script, its own test workflow.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tt = require('./template-trunk.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES = ['ci-node.yml', 'ci-laravel.yml', 'ci-python.yml'];
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, 'templates', f), 'utf8');
const refsIn = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

test('protectedRefs: one branch, two branches, nothing declared', () => {
  assert.deepStrictEqual(tt.protectedRefs({ trunk: 'master', tier: 'B' }).refs, ['master']);
  assert.deepStrictEqual(tt.protectedRefs({ trunk: 'main', exposure: 'released' }).refs, ['main']);
  assert.deepStrictEqual(tt.protectedRefs({ trunk: 'dev', exposure: 'live' }).refs, ['main', 'dev']);
  assert.deepStrictEqual(tt.protectedRefs({ trunk: 'develop', tier: 'C' }).refs, ['main', 'develop']);
  // exposure is the axis of record: a tier letter never overrides it.
  assert.deepStrictEqual(tt.protectedRefs({ trunk: 'develop', tier: 'C', exposure: 'self' }).refs, ['develop']);
  assert.strictEqual(tt.protectedRefs({ tier: 'B' }), null);
  assert.strictEqual(tt.protectedRefs(null), null);
});

for (const file of TEMPLATES) {
  const text = read(file);

  test(`${file}: trunk master — every protected ref is master, no main/dev left in the three places (#526)`, () => {
    const r = tt.substituteTrunk(text, tt.protectedRefs({ trunk: 'master', tier: 'B' }));
    assert.deepStrictEqual(r.missed, []);
    assert.ok(r.changes.includes('concurrency group') && r.changes.includes('cancel-in-progress') && r.changes.includes("dedupe guard's if:"));
    const group = r.text.match(/^  group: (.*)$/m)[1];
    const cancel = r.text.match(/^  cancel-in-progress: (.*)$/m)[1];
    const guard = r.text.match(/^    if: github\.event_name == 'push' && \(github\.event\.created \|\| (.*)$/m)[1];
    for (const line of [group, cancel, guard]) {
      assert.deepStrictEqual(refsIn(line, /refs\/heads\/([^']+)'/g), ['master'], line);
    }
    assert.doesNotMatch(r.text, /refs\/heads\/dev'/);
    if (file === 'ci-laravel.yml') {
      assert.ok(r.changes.includes('test tier'));
      assert.match(r.text, /\[ "\$REF" = "refs\/heads\/master" \] \|\| \[ "\$trunk" = "master" \]/);
    }
  });

  test(`${file}: trunk dev with a main release branch — the template's refs, unchanged`, () => {
    const r = tt.substituteTrunk(text, tt.protectedRefs({ trunk: 'dev', exposure: 'live' }));
    assert.strictEqual(r.text, text);
    assert.deepStrictEqual(r.changes, []);
    assert.deepStrictEqual(r.missed, []);
  });

  test(`${file}: trunk main — dev dropped from all three places`, () => {
    const r = tt.substituteTrunk(text, tt.protectedRefs({ trunk: 'main', exposure: 'none' }));
    assert.doesNotMatch(r.text, /refs\/heads\/dev'/);
    assert.match(r.text, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
    if (file === 'ci-laravel.yml') assert.ok(!r.changes.includes('test tier'));
  });
}

test('an already-edited shape is reported missed, never guessed at', () => {
  const r = tt.substituteTrunk('concurrency:\n  group: ci-x\n', tt.protectedRefs({ trunk: 'master' }));
  assert.deepStrictEqual(r.missed, ['concurrency group', 'cancel-in-progress', "dedupe guard's if:"]);
});

test('colab template ci-node: trunk master, no build script, its own CI — substituted, listed (#526)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-trunk-'));
  try {
    const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    g('init', '-q', '-b', 'master');
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: master\nproduction: null\ndeploy: none\nstack: node\n');
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'test.yml'), 'name: Test\non:\n  push:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n');
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'nightly.yml'), "name: Nightly\non:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n");
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x","scripts":{"test":"node -e 0"}}');
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'colab'), 'template', 'ci-node', '--dest', '.github/workflows/ci.yml'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /trunk: wrote master \(from \.github\/project\.yml\) into: concurrency group, cancel-in-progress, dedupe guard's if:/);
    assert.match(r.stdout, /also run on push[\s\S]*\.github\/workflows\/test\.yml/);
    assert.doesNotMatch(r.stdout, /nightly\.yml/);
    assert.doesNotMatch(r.stdout, /^    \.github\/workflows\/ci\.yml$/m, "the copy itself is not listed");
    const copy = fs.readFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(copy, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/master' \}\}/);
    assert.doesNotMatch(copy, /refs\/heads\/(main|dev)'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ci-node Build is optional: no build script or an empty BUILD_COMMAND skips with a notice (#526)', () => {
  const text = read('ci-node.yml');
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^      - name: Build$/.test(l));
  assert.notStrictEqual(at, -1);
  const runAt = lines.findIndex((l, i) => i > at && /^        run: \|$/.test(l));
  const body = [];
  for (let i = runAt + 1; i < lines.length && (/^          /.test(lines[i]) || lines[i] === ''); i++) body.push(lines[i].slice(10));
  const script = body.join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-build-'));
  const run = (pkg, cmd) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    return spawnSync('/bin/bash', ['-e', '-c', script], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, BUILD_COMMAND: cmd } });
  };
  try {
    let r = run({ scripts: { test: 'x' } }, 'build');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /::notice::No 'build' script in package\.json — skipping the build\./);
    r = run({ scripts: { build: 'x' } }, '');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /BUILD_COMMAND is empty/);
    r = run({ scripts: { build: 'echo BUILT-OK' } }, 'build');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /BUILT-OK/);
    r = run({ scripts: { build: 'exit 3' } }, 'build');
    assert.notStrictEqual(r.status, 0, 'a declared build that fails still fails the job');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderForRepo: CI templates only, and only when a trunk is declared', () => {
  const body = read('ci-node.yml');
  assert.match(tt.renderForRepo('ci-node', body, { trunk: 'master' }), /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/master' \}\}/);
  assert.strictEqual(tt.renderForRepo('ci-node', body, null), body);
  assert.strictEqual(tt.renderForRepo('release-auto', 'x refs/heads/main', { trunk: 'master' }), 'x refs/heads/main');
});

test('colab update: a CI copy rendered for its repo still reads pristine (behind), a hand edit still diverged (#526)', () => {
  const stamp = require('./stamp.js');
  const hb = stamp.handbookInfo(REPO_ROOT);
  // An old release whose ci-node.yml has changed since — any tag will do as long as it is reachable.
  const tags = spawnSync('git', ['tag', '--sort=version:refname'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.split('\n')
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const doc = { trunk: 'master', tier: 'B' };
  const render = (b) => tt.renderForRepo('ci-node', b, doc);
  // The newest one whose ci-node.yml the rendering actually changes, and which has changed since.
  const old = tags.reverse().find((t) => {
    const b = stamp.templateAt(REPO_ROOT, t, 'ci-node');
    return b !== null && render(b) !== b && stamp.templateChangedSince(REPO_ROOT, stamp.templateFiles('ci-node'), t).changed;
  });
  if (hb.untagged || !old) return; // a shallow or tagless checkout cannot answer this question
  const local = stamp.stampLine('ci-node', old) + render(stamp.templateAt(REPO_ROOT, old, 'ci-node'));
  const base = { root: REPO_ROOT, hb, tmplNames: stamp.templateNames(REPO_ROOT), templateName: 'ci-node', stampVersion: old, comparable: true };
  assert.strictEqual(stamp.classifyStamped({ ...base, localText: local, render }).state, 'behind');
  assert.strictEqual(stamp.classifyStamped({ ...base, localText: local }).state, 'diverged', 'without the rendering it would never refresh');
  assert.strictEqual(stamp.classifyStamped({ ...base, localText: `${local}# my edit\n`, render }).state, 'diverged');
});
