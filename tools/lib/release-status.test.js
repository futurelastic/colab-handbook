'use strict';
/**
 * Tests for `colab release-status` (#81) — merged-but-UNRELEASED lag on tag-gated repos.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Real CLI, real repos with a real bare `origin` on disk (no network) — same posture as
 * colab-base.test.js and ship-dry-json.test.js. The property under test is the MEASUREMENT
 * GOTCHA the command exists to get right: on a dual-trunk repo, tags live on `main`, not on the
 * trunk, so the lag must be computed against `main` regardless of what the checkout has on disk.
 *
 * `COLAB_HOME` is redirected per test, so the developer's real state.json / repos.txt is never
 * read or written.
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

function g(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

function homeDir(root) {
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function colab(home, args) {
  const r = spawnSync('node', [COLAB, ...args], { encoding: 'utf8', env: { ...process.env, COLAB_HOME: home } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/**
 * A dual-trunk tag-gated repo (trunk `dev`, tags on `main`) with:
 *   v1.0.0 on main · then a promoted `feat:` commit on main (unreleased, no fix) · then a
 *   `fix:` commit still on dev only (unpromoted, flagged).
 */
function dualTrunkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-relstatus-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'dev', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab release-status test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n');
  fs.writeFileSync(work + '/f.txt', 'base\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'dev');
  g(work, 'checkout', '-q', '-b', 'main');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  g(work, 'push', '-q', 'origin', 'v1.0.0');

  g(work, 'checkout', '-q', 'dev');
  fs.writeFileSync(work + '/feat.txt', 'feature\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'feat: add feature');
  g(work, 'checkout', '-q', 'main');
  g(work, 'merge', '-q', '--no-ff', 'dev', '-m', 'release: dev -> main');
  g(work, 'push', '-q', 'origin', 'main');

  g(work, 'checkout', '-q', 'dev');
  fs.writeFileSync(work + '/hotfix.txt', 'urgent\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'fix: urgent bug');
  g(work, 'push', '-q', 'origin', 'dev');
  g(work, 'checkout', '-q', 'main'); // the main checkout is on trunk at rest, always

  return { root, work };
}

test('dual-trunk: an unpromoted fix flags the repo, an unreleased feat does not', () => {
  const fx = dualTrunkFixture();
  const home = homeDir(fx.root);
  const r = colab(home, ['release-status', '--repo', fx.work, '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err); // flagged -> non-zero, same posture as `update`
  const body = JSON.parse(r.out);
  const row = body.rows[0];
  assert.strictEqual(row.applicable, true);
  assert.strictEqual(row.dualTrunk, true);
  assert.strictEqual(row.unpromoted.commits, 1);
  assert.strictEqual(row.unpromoted.fixFlag, true);
  assert.match(row.unpromoted.subjects[0], /^fix: urgent bug$/);
  assert.strictEqual(row.unreleased.tag, 'v1.0.0');
  assert.strictEqual(row.unreleased.commits, 1);
  assert.strictEqual(row.unreleased.fixFlag, false);
  assert.strictEqual(row.flag, true);
  assert.strictEqual(row.semverSuggestion.bump, 'minor'); // the unreleased gap is feat-only
});

test('the lag is measured against main, NOT the trunk checkout\'s HEAD (the whole point of #81)', () => {
  // Regression guard for the measurement gotcha: run the command with `dev` checked out (a stale
  // `git describe` from there would answer a different, wrong question). Assert the numbers match
  // the previous test exactly regardless of what is checked out when the command runs.
  const fx = dualTrunkFixture();
  const home = homeDir(fx.root);
  g(fx.work, 'checkout', '-q', 'dev');
  const r = colab(home, ['release-status', '--repo', fx.work, '--json']);
  const row = JSON.parse(r.out).rows[0];
  assert.strictEqual(row.unreleased.tag, 'v1.0.0');
  assert.strictEqual(row.unreleased.commits, 1);
  assert.strictEqual(row.unpromoted.commits, 1);
});

test('single-trunk tag-gated (trunk: main): no unpromoted gap, docs-only commit does not flag or suggest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-relstatus-single-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab release-status test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'tier: A\ntrunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n');
  fs.writeFileSync(work + '/f.txt', 'base\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  g(work, 'push', '-q', 'origin', 'v0.1.0');
  fs.writeFileSync(work + '/d.txt', 'docs\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'docs: readme');
  g(work, 'push', '-q', 'origin', 'main');

  const home = homeDir(root);
  const r = colab(home, ['release-status', '--repo', work, '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err); // nothing flagged
  const row = JSON.parse(r.out).rows[0];
  assert.strictEqual(row.dualTrunk, false);
  assert.strictEqual(row.unpromoted, null);
  assert.strictEqual(row.unreleased.tag, 'v0.1.0');
  assert.strictEqual(row.unreleased.commits, 1);
  assert.strictEqual(row.flag, false);
  assert.strictEqual(row.semverSuggestion.bump, null); // docs-only: no user-facing change
});

test('a non-tag-gated repo is reported n-a with a reason, never silently dropped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-relstatus-na-'));
  TMP.push(root);
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab release-status test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture');

  const home = homeDir(root);
  const r = colab(home, ['release-status', '--repo', work, '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const row = JSON.parse(r.out).rows[0];
  assert.strictEqual(row.applicable, false);
  assert.match(row.reason, /not tag-gated/);
});

test('fleet mode sweeps colab update\'s own registry (repos.txt), one row per entry', () => {
  const fx = dualTrunkFixture();
  const home = homeDir(fx.root);
  fs.writeFileSync(path.join(home, 'repos.txt'), `${fx.work}\n`);
  const r = colab(home, ['release-status', '--json']);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.rows.length, 1);
  assert.strictEqual(body.rows[0].flag, true);
  assert.strictEqual(body.summary.flagged, 1);
});

test('breaking-change commit (!) since the last tag suggests a major bump', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-relstatus-major-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab release-status test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'tier: A\ntrunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n');
  fs.writeFileSync(work + '/f.txt', 'base\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  g(work, 'push', '-q', 'origin', 'v1.0.0');
  fs.writeFileSync(work + '/api.txt', 'v2\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'feat!: drop the old API shape');
  g(work, 'push', '-q', 'origin', 'main');

  const home = homeDir(root);
  const r = colab(home, ['release-status', '--repo', work, '--json']);
  const row = JSON.parse(r.out).rows[0];
  assert.strictEqual(row.semverSuggestion.bump, 'major');
  assert.strictEqual(row.unreleased.fixFlag, true); // breaking counts as flag-worthy too
  assert.strictEqual(r.code, 1);
});

// ---- #443: the newest candidate names trunk's head --------------------------------------------

/**
 * A `released` public-tool repo (deploy: none — not tag-gated, candidates automatic) with v1.0.0
 * final and one `fix:` commit on main, plus a `gh` stub answering `run list` from a file.
 */
function publicToolFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-relstatus-head-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab release-status test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'trunk: main\nexposure: released\nproduction: null\ndeploy: none\nstack: node\n');
  fs.writeFileSync(work + '/f.txt', 'base\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  fs.writeFileSync(work + '/fix.txt', 'fix\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'fix: a bug');
  g(work, 'push', '-q', 'origin', 'main', '--tags');
  const runsFile = path.join(root, 'runs.json');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${runsFile}"; exit 0; fi`,
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const setRuns = (rows) => fs.writeFileSync(runsFile, JSON.stringify(rows));
  const status = () => {
    const r = spawnSync('node', [COLAB, 'release-status', '--repo', work, '--json'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: homeDir(root) },
    });
    return { code: r.status, body: JSON.parse(r.stdout), err: r.stderr };
  };
  return { root, work, setRuns, status };
}

test('#443: a green head untagged for longer than one CI cycle is flagged "head not a candidate"', () => {
  const fx = publicToolFixture();
  const green = (min) => ({ status: 'completed', conclusion: 'success', event: 'push', workflowName: 'CI',
    createdAt: new Date(Date.now() - (min + 4) * 60000).toISOString(), updatedAt: new Date(Date.now() - min * 60000).toISOString() });

  fx.setRuns([green(60)]); // green an hour ago, a 4-minute cycle
  const late = fx.status();
  const row = late.body.rows[0];
  assert.strictEqual(row.applicable, true, 'automatic candidates make a deploy: none repo assessable');
  assert.strictEqual(row.tagGated, false);
  assert.strictEqual(row.headCandidate.state, 'untagged');
  assert.match(row.headCandidate.detail, /head not a candidate/);
  assert.strictEqual(row.flag, true);
  assert.strictEqual(late.code, 1);

  fx.setRuns([green(1)]); // inside one cycle — the release run may still be tagging it
  const pending = fx.status();
  assert.strictEqual(pending.body.rows[0].headCandidate.state, 'pending');
  assert.strictEqual(pending.body.rows[0].flag, false, 'a fix under a pending head is not lag on a non-tag-gated repo');
  assert.strictEqual(pending.code, 0);

  fx.setRuns([green(60)]);
  g(fx.work, 'tag', '-a', 'v1.0.1-rc.1', '-m', 'v1.0.1-rc.1 — release candidate (colab release cut)');
  const named = fx.status();
  assert.strictEqual(named.body.rows[0].headCandidate.state, 'named');
  assert.strictEqual(named.code, 0);
});
