'use strict';
/**
 * Subprocess/CLI tests for the cure rule (#281): its wiring into `colab ship`'s trunk-CI-green
 * precondition (both the prose table and `--dry --json`), alongside the pre-existing ci-grant
 * wiring (#105) which this feature must leave undisturbed.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-ci-grant.test.js, copied rather than extracted into a shared harness (extracting
 * one would touch a passing test file for a reason unrelated to it — same call #98's/#105's files
 * already made about their own fixtures).
 *
 * WHY THIS FILE CANNOT EXERCISE THE CURE RULE ACTUALLY FIRING END TO END. Identical reason to
 * ship-ci-grant.test.js's own banner: `shipCiCheck` only ever consults the cure rule when the RAW
 * verdict is HUMAN_GATED — a real `gh run list` that succeeded and reported a non-success
 * conclusion for a real commit. Against this fixture's local-bare `origin` (not a real GitHub
 * repository), `gh run list` always FAILS outright, so the raw verdict is always SELF_CLEARING
 * ("gh run list failed"), and neither door is ever consulted. That is not a coverage hole: the pure
 * resolution logic (containment, evidence, anti-stacking, workflow-file exclusion) is fully covered
 * without a live `gh` in tools/lib/ci-cure.test.js, on purpose. What THIS file proves is the WIRING:
 * a failed/absent/self-clearing case never reads as cured, `ciCure` stays additive and null on the
 * ordinary path, the pre-existing ciGrant/ship-dry-json contracts survive untouched, and the two
 * doors' JSON fields never both fire on the same row.
 *
 * #101/#100: a real `gh` binary is placed first on PATH so `isGhUsable()` reads true regardless of
 * whether THIS machine has `gh` authenticated — every actual `gh` subcommand still fails for real
 * against this fixture's local-bare origin. Same wiring `withFakeGh` in tools/lib/git.test.js uses.
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

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME — copied from
 *  ship-ci-grant.test.js's fixture(), on purpose (see file banner). */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-cure-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ci-cure test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-ci-cure-test', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function addCommitBranch(fx, branch, file = 'g.txt') {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

// --- ship --dry --json: ciCure is additive, null on the ordinary/self-clearing path -----------

test('ship --dry --json: the "trunk CI green" row is SELF_CLEARING against this fixture (gh run list always fails), and neither ciGrant nor ciCure is ever consulted', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-1');

  const r = colab(fx, ['ship', '--branch', 'feat/clean-1', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'self-clearing');
  assert.strictEqual(body.ciGrant, null);
  assert.strictEqual(body.ciCure, null);
});

test('ship --dry --json: ciCure is present in the payload (additive) and does not disturb any other precondition row or ciGrant', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-2');

  const r = colab(fx, ['ship', '--branch', 'feat/clean-2', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const names = body.checks.map((c) => c.name);
  for (const n of ['branch resolves', 'not an integration line', 'declared base', 'autonomy granted',
    'no new migrations', 'trunk checkout ready', 'no hand-merge conflict', 'trunk CI green']) {
    assert.ok(names.includes(n), `missing check "${n}" in ${JSON.stringify(names)}`);
  }
  assert.ok('ciCure' in body, 'ciCure must be present in the JSON payload, additive');
  assert.ok('ciGrant' in body, 'ciGrant must still be present — #281 does not remove #105');
  assert.strictEqual(body.migrationGrant, null); // untouched by this feature
});

// --- prose path: unaffected, never claims an override that was never consulted ------------------

test('ship (real path, prose table): the "trunk CI green" row prints ✗ with the self-clearing detail, unaffected by cure-rule wiring', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-3');
  colab(fx, ['claim', '55', '--branch', 'feat/clean-3', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/clean-3', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /✗\s+trunk CI green/);
  assert.doesNotMatch(r.out, /PRECONDITION OVERRIDDEN/); // never claims a cure or a grant that was never consulted
});

test('regression: the JSON and prose paths still agree on the CI row (both read not-ok) on the identical fixture, cure rule included', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/clean-4');
  colab(fx, ['claim', '55', '--branch', 'feat/clean-4', '--repo', fx.work]);

  const jr = colab(fx, ['ship', '--branch', 'feat/clean-4', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(jr.out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');

  const pr = colab(fx, ['ship', '--branch', 'feat/clean-4', '--repo', fx.work, '--dry']);
  assert.strictEqual(ci.ok, false);
  assert.match(pr.out, /✗\s+trunk CI green/);
});

// --- computeAntiStacking's widened trailer scan does not break ci-grant CREATE's own refusal ---

test('ci-grant CREATE still refuses on this fixture exactly as before #281 (computeAntiStacking extraction is a pure refactor)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCommitBranch(fx, 'feat/x-1');
  const r = colab(fx, ['ci-grant', '1', '--branch', 'feat/x-1', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /Granted/);
  assert.match(r.err, /could not read #1 from the tracker — refusing to write a grant blind/);
});
