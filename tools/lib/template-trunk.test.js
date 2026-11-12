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
    // #724: a caller names its trunk refs in the call's `trunk-branches` input, not a guard `if:`.
    assert.ok(r.changes.includes('concurrency group') && r.changes.includes('cancel-in-progress') && r.changes.includes('trunk-branches input'));
    const group = r.text.match(/^  group: (.*)$/m)[1];
    const cancel = r.text.match(/^  cancel-in-progress: (.*)$/m)[1];
    for (const line of [group, cancel]) {
      assert.deepStrictEqual(refsIn(line, /refs\/heads\/([^']+)'/g), ['master'], line);
    }
    assert.match(r.text, /^      trunk-branches: '\["master"\]'$/m);
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
    // A caller, or — until a final release carries ci-light.yml — that release's own full copy (#724).
    assert.match(r.stdout, /trunk: wrote master \(from \.github\/project\.yml\) into: concurrency group, cancel-in-progress, (dedupe guard's if:|trunk-branches input)/);
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

test('ci-node quick and full run only the scripts package.json declares; a declared one that fails still fails (#526, #724)', (t) => {
  if (spawnSync('npm', ['--version']).status !== 0) return t.skip('no npm on this machine');
  const text = read('ci-node.yml');
  const cmd = (k) => (text.match(new RegExp(`^      ${k}: (.+)$`, 'm')) || [])[1];
  const quick = cmd('quick');
  const full = cmd('full');
  assert.ok(quick && full, 'the call carries one-line quick and full commands');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-build-'));
  const run = (pkg, script) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    return spawnSync('/bin/bash', ['-eo', 'pipefail', '-c', script], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, npm_config_update_notifier: 'false' } });
  };
  try {
    for (const script of [quick, full]) assert.strictEqual(run({ name: 'x' }, script).status, 0, `${script}: no scripts declared is green`);
    let r = run({ name: 'x', scripts: { build: 'echo BUILT-OK' } }, full);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /BUILT-OK/);
    assert.notStrictEqual(run({ name: 'x', scripts: { build: 'exit 3' } }, full).status, 0, 'a declared build that fails still fails the job');
    assert.notStrictEqual(run({ name: 'x', scripts: { test: 'exit 3' } }, full).status, 0, 'a declared test that fails still fails the job');
    assert.notStrictEqual(run({ name: 'x', scripts: { lint: 'exit 3' } }, quick).status, 0, 'a declared lint that fails still fails the job');
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

// #721: the reusable-workflow caller names its trunk refs in the `trunk-branches` input (no guard `if:` of its
// own), and pins the handbook by tag — the version its stamp records.
test('ci-call: trunk-branches rewritten instead of a guard if:, nothing missed; the pin follows the stamp (#721)', () => {

  const body = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'ci-call.yml'), 'utf8');
  const r = tt.substituteTrunk(body, tt.protectedRefs({ trunk: 'dev', exposure: 'live' }));
  assert.deepStrictEqual(r.missed, []);
  assert.deepStrictEqual(r.changes, []); // main + dev is the template's own pair
  assert.match(r.text, /^      trunk-branches: '\["main","dev"\]'$/m);
  const m = tt.substituteTrunk(body, tt.protectedRefs({ trunk: 'master' }));
  assert.deepStrictEqual(m.missed, []);
  assert.ok(m.changes.includes('trunk-branches input'), m.changes.join(', '));
  const one = m.text;
  assert.match(one, /^      trunk-branches: '\["master"\]'$/m);
  assert.match(one, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/master' \}\}/);
  // The pin: a real version replaces the token; v0 (no tag) leaves it, and says so.
  assert.match(body, /ci-light\.yml@HANDBOOK_TAG$/m);
  assert.match(tt.pinHandbookTag(body, 'v1.9.0').text, /ci-light\.yml@v1\.9\.0$/m);
  assert.deepStrictEqual(tt.pinHandbookTag(body, 'v0'), { text: body, pinned: null, unpinned: true });
  assert.deepStrictEqual(tt.pinHandbookTag('no token here', 'v1.9.0'), { text: 'no token here', pinned: null });
  // renderForRepo applies both, so `colab update` reads a fresh copy as pristine at its stamped version.
  assert.match(tt.renderForRepo('ci-call', body, { trunk: 'master' }, 'v1.9.0'), /ci-light\.yml@v1\.9\.0$/m);
  assert.strictEqual(tt.renderForRepo('ci-call', body, null), body);
});

// #724: the release window. A copy is stamped with the latest FINAL, which can trail the working tree's
// caller; until a final carries ci-light.yml the copy is that release's own template, never a dead pin.
test('templateBodyAt: a caller pinned at a release without ci-light.yml is that release\'s own template (#724)', () => {
  const caller = read('ci-node.yml');
  const full = '# CI (Node) — TEMPLATE. Copy me into your repo at .github/workflows/ci.yml.\njobs:\n  dedupe:\n';
  const shown = [];
  const git = (carriesIt, old) => ({
    hasGit: true,
    carries: (v, p) => { assert.strictEqual(p, '.github/workflows/ci-light.yml'); return carriesIt; },
    show: (v, p) => { shown.push(`${v}:${p}`); return old; },
  });
  // The release carries the reusable workflow: the caller, as is.
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-node.yml', version: 'v1.21.0', ...git(true, full) }), { body: caller });
  // It does not: that release's own full copy — "copied from X" and "runs at X" stay one fact.
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-node.yml', version: 'v1.20.3', ...git(false, full) }), { body: full, fallback: 'v1.20.3' });
  assert.deepStrictEqual(shown, ['v1.20.3:templates/ci-node.yml']);
  // No such template at that release (ci-call before #721), or it is a caller too: nothing runnable to write.
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-call.yml', version: 'v1.20.3', ...git(false, null) }), { body: caller, unrunnable: 'v1.20.3' });
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-node.yml', version: 'v1.20.3', ...git(false, caller) }), { body: caller, unrunnable: 'v1.20.3' });
  // Not a caller, an untagged handbook, or no git (a registry install ships its own release): untouched.
  const never = { hasGit: true, carries: () => assert.fail('asked git'), show: () => assert.fail('asked git') };
  assert.deepStrictEqual(tt.templateBodyAt({ raw: full, rel: 'ci-node-heavy.yml', version: 'v1.20.3', ...never }), { body: full });
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-node.yml', version: 'v0', ...never }), { body: caller });
  assert.deepStrictEqual(tt.templateBodyAt({ raw: caller, rel: 'ci-node.yml', version: 'v1.20.3', ...never, hasGit: false }), { body: caller });
});
