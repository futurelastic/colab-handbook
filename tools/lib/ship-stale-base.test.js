'use strict';
/**
 * #395 end to end — `colab ship` refuses a branch whose CI verdict was measured on a head that
 * does not contain the base's CURRENT tip (`stale-base`), and passes once the base is synced in.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — the fixture/colab() shape of
 * ship-ci-run-count.test.js, except the `gh run list` stub reads its rows from a file the test
 * rewrites, because the shas it must answer for (a moved trunk, a synced branch head) only exist
 * after setup.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-stale-base-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const runsFile = path.join(root, 'runs.json');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship stale-base test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(runsFile, '[]');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat '${runsFile}'; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  /** Every listed sha gets one completed/success run (the stub filters nothing; colab filters by sha). */
  const greenAt = (...shas) => fs.writeFileSync(runsFile, JSON.stringify(shas.map((headSha) => ({
    headSha, status: 'completed', conclusion: 'success', createdAt: new Date().toISOString(), databaseId: 1, workflowName: 'ci',
  }))));
  return { root, work, home, bin, g, greenAt };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-stale-base-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Branch off main, commit, claim it, push it. Returns the head sha. */
function pushedBranch(fx, n, branch, { push = true } = {}) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, `b${n}.txt`), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `feat: branch work (#${n})`);
  const head = fx.g(fx.work, 'rev-parse', 'HEAD');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // Claim BEFORE the push, the real order (#325: a pushed branch this machine did not claim reads as
  // another machine's claim).
  const c = colab(fx, ['claim', String(n), '--branch', branch, '--repo', fx.work]);
  assert.strictEqual(c.code, 0, c.err + c.out);
  if (push) fx.g(fx.work, 'push', '-q', 'origin', branch);
  return head;
}

/** Another session lands on main: a new commit pushed to origin, local main fast-forwarded. */
function trunkMoves(fx) {
  fs.writeFileSync(path.join(fx.work, 'other.txt'), 'landed elsewhere\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: another branch landed');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  return fx.g(fx.work, 'rev-parse', 'HEAD');
}

const row = (body) => body.checks.find((c) => /branch run contains current base/.test(c.name));

test('the measured incident: branch green on a head cut before trunk moved — stale-base, not READY', () => {
  const fx = fixture();
  const head = pushedBranch(fx, 7, 'feat/stale-7');
  const tip = trunkMoves(fx);
  fx.greenAt(head, tip); // both individually green — the exact shape that combined red

  const r = colab(fx, ['ship', '--branch', 'feat/stale-7', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const s = row(body);
  assert.ok(s, `no #395 row in ${JSON.stringify(body.checks.map((c) => c.name))}`);
  assert.strictEqual(s.ok, false, JSON.stringify(s));
  assert.strictEqual(s.verdict, 'stale-base');
  assert.strictEqual(s.class, 'self-clearing');
  assert.match(s.detail, /1 commit\(s\) now on main/);
  assert.strictEqual(body.ok, false);
  const failing = body.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.deepStrictEqual(failing, [s.name], 'stale-base must be the ONLY failing row here');

  // The prose path (and therefore the real ship) refuses on the same row.
  const p = colab(fx, ['ship', '--branch', 'feat/stale-7', '--repo', fx.work, '--dry']);
  assert.match(p.out, /✗\s+branch run contains current base \(#395\)\s+stale-base:/);
  const real = colab(fx, ['ship', '--branch', 'feat/stale-7', '--repo', fx.work]);
  assert.notStrictEqual(real.code, 0);
  assert.match(real.err, /preconditions failed/);
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'origin/main'), tip, 'nothing pushed to trunk');
});

test('after B0 — trunk synced into the branch, pushed, its new run green — the row passes', () => {
  const fx = fixture();
  pushedBranch(fx, 8, 'feat/synced-8');
  const tip = trunkMoves(fx);
  fx.g(fx.work, 'checkout', '-q', 'feat/synced-8');
  fx.g(fx.work, 'merge', '-q', '--no-edit', 'main');
  fx.g(fx.work, 'push', '-q', 'origin', 'feat/synced-8');
  const synced = fx.g(fx.work, 'rev-parse', 'HEAD');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fx.greenAt(synced, tip);

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/synced-8', '--repo', fx.work, '--dry', '--json']).out);
  const s = row(body);
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  assert.strictEqual(s.verdict, 'fresh');
  assert.strictEqual(body.ok, true, JSON.stringify(body.checks.filter((c) => !c.ok)));
});

test('no branch run at the head (workflows that cannot fire for a branch ref) — nothing to be stale', () => {
  const fx = fixture();
  pushedBranch(fx, 9, 'feat/norun-9');
  const tip = trunkMoves(fx);
  fx.greenAt(tip); // trunk only

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/norun-9', '--repo', fx.work, '--dry', '--json']).out);
  const s = row(body);
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  assert.strictEqual(s.verdict, 'no-run');
  assert.strictEqual(body.ok, true, JSON.stringify(body.checks.filter((c) => !c.ok)));
});

test('a branch never pushed has no run to be stale', () => {
  const fx = fixture();
  pushedBranch(fx, 10, 'feat/local-10', { push: false });
  const tip = trunkMoves(fx);
  fx.greenAt(tip);

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/local-10', '--repo', fx.work, '--dry', '--json']).out);
  assert.strictEqual(row(body).verdict, 'no-run');
});

test('trunk has not moved since the branch was cut — the green run is fresh', () => {
  const fx = fixture();
  const head = pushedBranch(fx, 11, 'feat/fresh-11');
  fx.greenAt(head, fx.g(fx.work, 'rev-parse', 'main'));

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/fresh-11', '--repo', fx.work, '--dry', '--json']).out);
  assert.strictEqual(row(body).verdict, 'fresh');
  assert.strictEqual(body.ok, true, JSON.stringify(body.checks.filter((c) => !c.ok)));
});
