'use strict';
/**
 * Tests for #176's remainder — the trunk-CI-green detail line names its own sample size
 * ("N runs at <sha>: all success") instead of the bare singular ("run for <sha>: success") that
 * read identically whether one workflow ran or five. The fail-open half (#146/#162/#165, any-green
 * vs all-green) is already covered by tools/lib/git.test.js; this file is only the detail string.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-ci-grant.test.js, but with `gh run list` ALSO faked (that file deliberately does
 * not, because it exists to prove the human-only gate; this one needs a real green trunk to reach
 * `classifyCiRun`'s success branch at all).
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

/**
 * A clone with a real bare `origin`, a `main` trunk, private COLAB_HOME, and a `gh` stub whose
 * `run list` answers with `runs` (an array of `{headSha,status,conclusion}`) for ANY branch asked
 * — good enough here since the only branch ever queried is `main` (the CI check's `target`).
 */
function fixture(projectYml, runs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-runcount-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship ci run-count test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const trunkSha = g(work, 'rev-parse', 'HEAD').trim();

  const rows = runs.map((r) => ({ headSha: trunkSha, status: 'completed', conclusion: 'success', ...r }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat <<\'EOF\'',
    JSON.stringify(rows),
    'EOF',
    'exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g, trunkSha };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function shippableBranch(fx, issueNum, branch) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', String(issueNum), '--branch', branch, '--repo', fx.work]);
}

test('one green workflow at the sha reads "1 run … success", not the old bare singular', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK, [{}]);
  shippableBranch(fx, 4, 'feat/clean-4');
  const r = colab(fx, ['ship', '--branch', 'feat/clean-4', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const ci = body.checks.find((c) => /CI green/.test(c.name));
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, /^1 run at main@[0-9a-f]+: success$/);
});

test('three agreeing green workflows at the sha read "3 runs … all success" — the verdict names its own sample size', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK, [{}, {}, {}]);
  shippableBranch(fx, 5, 'feat/clean-5');
  const r = colab(fx, ['ship', '--branch', 'feat/clean-5', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const ci = body.checks.find((c) => /CI green/.test(c.name));
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, /^3 runs at main@[0-9a-f]+: all success$/);
});
