'use strict';
/**
 * #493: a trunk run whose suite the CI guard skipped on a tree-already-green citation is green, and
 * `colab ship` / `colab trunk-ci` name the run it relied on. A citation that cannot be read stays
 * green and says so; a cited head whose tree provably differs from trunk's reads red (HUMAN_GATED).
 * An ordinary green run's detail is byte-identical to before.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` — the fixture shape of trunk-ci-verb.test.js,
 * plus `gh api` answers for the commit's check runs and one check run's annotations.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const tg = require('./tree-green');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const URL = 'https://github.com/o/r/actions/runs/77';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-tree-green-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = new Date(Date.now() - 60 * 60000).toISOString();
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab tree-green test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();
  // The branch commit the squash came from: a DIFFERENT sha with the SAME tree as trunk's head.
  const sameTree = g(work, 'commit-tree', `${sha}^{tree}`, '-m', 'feat: same tree').trim();

  g(work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(work, 'g.txt'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: x');
  const otherTree = g(work, 'rev-parse', 'HEAD').trim();
  g(work, 'checkout', '-q', 'main');

  const rowsFile = path.join(root, 'rows.json');
  const checksFile = path.join(root, 'checks.json');
  const annFile = path.join(root, 'ann.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // `gh api <url> --jq <prog>`: the fixture files hold what the jq program would print.
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${rowsFile}"; exit 0; fi`,
    `if [ "$1" = "api" ]; then case "$2" in`,
    `  */commits/*/check-runs*) [ -f "${checksFile}" ] && cat "${checksFile}" && exit 0;;`,
    `  */check-runs/*/annotations) [ -f "${annFile}" ] && cat "${annFile}" && exit 0;;`,
    'esac; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const runEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-493', COLAB_SESSION_NAME: '' };
  const put = (f, v) => (v === undefined ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, JSON.stringify(v)));
  return {
    work, sha, sameTree, otherTree, runEnv,
    setRows: (v) => put(rowsFile, v), setChecks: (v) => put(checksFile, v), setAnn: (v) => put(annFile, v),
  };
}

function trunkCi(fx) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(r.stdout);
}
function shipRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(r.stdout).checks.find((c) => c.name === 'trunk CI green');
}

const greenRun = (sha) => [{ headSha: sha, status: 'completed', conclusion: 'success', createdAt: '2026-10-05T10:00:00Z', databaseId: 900, workflowName: 'CI', event: 'push' }];
// One workflow run (suite 5): the guard succeeded with one annotation, the suite skipped.
const skipChecks = [
  { id: 11, name: 'Already tested at this sha or tree?', status: 'completed', conclusion: 'success', suite: 5, annotations: 1 },
  { id: 12, name: 'Test', status: 'completed', conclusion: 'skipped', suite: 5, annotations: 0 },
  { id: 13, name: 'Secret scan', status: 'completed', conclusion: 'skipped', suite: 5, annotations: 0 },
];
const ann = (head) => [{ title: 'tree-already-green', level: 'notice', message: `${URL} tree=abc head=${head} branch=feat/x-1` }];

test('#493 a cited tree-skip run → GREEN in both readers, naming the run, tree verified locally', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(skipChecks);
  fx.setAnn(ann(fx.sameTree));
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN', JSON.stringify(t));
  assert.match(t.detail, /tree already green \(#493\): suite skipped, relied on https:\/\/github\.com\/o\/r\/actions\/runs\/77 \(feat\/x-1@[0-9a-f]{7}, tree verified locally\)/);
  assert.deepStrictEqual(t.cited, [URL]);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  assert.strictEqual(s.detail, t.detail, 'one function, one detail');
});

test('#493 the cited head is not local → still GREEN, said to be unverified', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(skipChecks);
  fx.setAnn(ann('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN');
  assert.match(t.detail, /tree not verified locally/);
});

test('#493 citation unreadable (annotations call fails, or no notice) → GREEN, "cited run unreadable"', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(skipChecks);
  fx.setAnn(undefined);
  let t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN');
  assert.match(t.detail, /cited run unreadable/);
  fx.setAnn([{ title: 'something else', message: 'x' }]);
  t = trunkCi(fx);
  assert.match(t.detail, /cited run unreadable/);
  assert.strictEqual(shipRow(fx).ok, true);
});

test('#493 the cited head\'s tree provably differs → RED, ship row HUMAN_GATED and not ok', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(skipChecks);
  fx.setAnn(ann(fx.otherTree));
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'RED', JSON.stringify(t));
  assert.strictEqual(t.class, 'human-gated');
  assert.match(t.detail, /trunk is untested at this sha/);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, false);
});

test('#493 an ordinary green run (or an unreadable check-runs list) → detail byte-identical to before', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(undefined); // the read fails
  const base = trunkCi(fx);
  assert.strictEqual(base.verdict, 'GREEN');
  assert.strictEqual(base.detail, `1 run at main@${fx.sha.slice(0, 7)}: success`);
  assert.strictEqual(base.cited, undefined);
  // every job ran — no skip shape, so no extra read and no note
  fx.setChecks([{ id: 11, name: 'guard', status: 'completed', conclusion: 'skipped', suite: 5, annotations: 0 },
    { id: 12, name: 'Test', status: 'completed', conclusion: 'success', suite: 5, annotations: 0 }]);
  assert.strictEqual(trunkCi(fx).detail, base.detail);
});

test('#493 tree-green.js: the pure readers', () => {
  assert.deepStrictEqual(tg.treeSkipCheckRuns(skipChecks), [11]);
  assert.strictEqual(tg.treeSkipCheckRuns(null), null);
  // two workflows: one skipped on a citation, one ran in full
  assert.deepStrictEqual(tg.treeSkipCheckRuns([...skipChecks, { id: 20, status: 'completed', conclusion: 'success', suite: 6, annotations: 0 }]), [11]);
  // no annotation → the #418 sha skip's shape is not a citation to look for
  assert.deepStrictEqual(tg.treeSkipCheckRuns(skipChecks.map((c) => ({ ...c, annotations: 0 }))), []);
  // a job still running is not a skip shape
  assert.deepStrictEqual(tg.treeSkipCheckRuns([skipChecks[0], { ...skipChecks[1], status: 'in_progress', conclusion: null }]), []);
  assert.deepStrictEqual(tg.parseCitation(ann('bbb222')), { url: URL, runId: '77', tree: 'abc', head: 'bbb222', branch: 'feat/x-1' });
  assert.strictEqual(tg.parseCitation([{ title: 'tree-already-green', message: 'garbage' }]), null);
  assert.strictEqual(tg.parseCitation(null), null);
  assert.strictEqual(tg.citationNote([], 0), '');
  assert.strictEqual(tg.parseTreeReuse({}).declared, false);
  assert.deepStrictEqual([tg.parseTreeReuse({ 'tree-reuse': 'off' }).valid, tg.parseTreeReuse({ 'tree-reuse': 'off' }).off], [true, true]);
  assert.strictEqual(tg.parseTreeReuse({ 'tree-reuse': false }).valid, true);
  const bad = tg.parseTreeReuse({ 'tree-reuse': 'on' });
  assert.deepStrictEqual([bad.valid, bad.off], [false, true]);
});

test('#570 a docs-only skip run → GREEN, named as docs-only with its base, never "cited run unreadable"', () => {
  const fx = fixture();
  fx.setRows(greenRun(fx.sha));
  fx.setChecks(skipChecks);
  fx.setAnn([{ title: 'docs-only-skip', level: 'notice', message: `base=${fx.sha} files=3 run=${URL}` }]);
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN', JSON.stringify(t));
  assert.match(t.detail, new RegExp(`docs-only \\(#570\\): suite skipped, 3 path\\(s\\) since ${fx.sha.slice(0, 7)}, whose green run is https://github\\.com/o/r/actions/runs/77$`));
  assert.doesNotMatch(t.detail, /unreadable|tree already green/);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  assert.strictEqual(s.detail, t.detail, 'one function, one detail');
});

test('#570 tree-green.js: parseDocsSkip', () => {
  assert.deepStrictEqual(tg.parseDocsSkip([{ title: 'docs-only-skip', message: `base=abc123 files=2 run=${URL}` }]), { base: 'abc123', files: 2, url: URL });
  assert.strictEqual(tg.parseDocsSkip([{ title: 'docs-only-skip', message: 'garbage' }]), null);
  assert.strictEqual(tg.parseDocsSkip(ann('bbb222')), null);
  assert.strictEqual(tg.parseDocsSkip(null), null);
  assert.strictEqual(tg.citationNote([], 0, []), '');
});
