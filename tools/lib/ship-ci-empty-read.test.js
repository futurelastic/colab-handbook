'use strict';
/**
 * #413: `colab ship`'s "trunk CI green" row must not class an EMPTY branch-filtered read of trunk's
 * head as HUMAN_GATED before it has re-read the same sha by commit, and must not class a sha
 * committed minutes ago (its run may not exist yet) as HUMAN_GATED either.
 *
 * Real CLI, real repo, real bare `origin` on disk. The fake `gh` answers `run list --branch …` and
 * `run list --commit …` from two separate files, so each test chooses what each read returns —
 * the measured incident was exactly the two disagreeing (branch read empty, the run existing).
 * Every other `gh` subcommand fails, as in ship-ci-cure.test.js; those degrade, never gate here.
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

/** `committedAgoMin` backdates trunk's head commit — the grace window reads its committer time. */
function fixture(committedAgoMin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-empty-read-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = new Date(Date.now() - committedAgoMin * 60000).toISOString();
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ci-empty-read test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();

  g(work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(work, 'g.txt'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: x');
  g(work, 'checkout', '-q', 'main');

  const branchRows = path.join(root, 'branch-rows.json');
  const commitRows = path.join(root, 'commit-rows.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  case " $* " in',
    `    *" --commit "*) cat "${commitRows}"; exit 0 ;;`,
    `    *" --branch "*) cat "${branchRows}"; exit 0 ;;`,
    '  esac',
    'fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const setRows = (byBranch, byCommit) => {
    fs.writeFileSync(branchRows, JSON.stringify(byBranch));
    fs.writeFileSync(commitRows, JSON.stringify(byCommit));
  };
  return { work, home, bin, sha, setRows };
}

function trunkCiRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-413', COLAB_SESSION_NAME: '' },
  });
  const body = JSON.parse(r.stdout);
  return body.checks.find((c) => c.name === 'trunk CI green');
}

const green = (sha) => [{ headSha: sha, status: 'completed', conclusion: 'success', createdAt: '2026-09-30T12:33:26Z', databaseId: 1, workflowName: 'CI', event: 'push' }];

test('#413 the measured incident: branch read empty, run exists by commit → green, and the detail says it was read by commit', () => {
  const fx = fixture(60);
  fx.setRows([], green(fx.sha));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, /by commit/);
});

test('#413 both reads empty on a sha committed minutes ago → SELF_CLEARING (the run may not exist yet)', () => {
  const fx = fixture(2);
  fx.setRows([], []);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'self-clearing', JSON.stringify(ci));
  assert.match(ci.detail, /no run yet/);
});

test('#413 both reads empty on an old sha → still HUMAN_GATED (CI not wired / never started)', () => {
  const fx = fixture(60);
  fx.setRows([], []);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'human-gated', JSON.stringify(ci));
  assert.match(ci.detail, /no run for main@/);
});

test('#413 the ordinary green branch read never pays for the by-commit read (its answer is not consulted)', () => {
  const fx = fixture(60);
  fx.setRows(green(fx.sha), [{ headSha: fx.sha, status: 'completed', conclusion: 'failure' }]);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.doesNotMatch(ci.detail, /by commit/);
});

// --- #451: trunk red ONLY from runs the repo does not own (event: dynamic) ----------------------

const dependabotRed = (sha) => [
  { headSha: sha, status: 'completed', conclusion: 'failure', createdAt: '2026-10-03T10:00:00Z', databaseId: 71, workflowName: 'Dependabot Updates', event: 'dynamic' },
  { headSha: sha, status: 'completed', conclusion: 'failure', createdAt: '2026-10-03T09:00:00Z', databaseId: 72, workflowName: 'Dependabot Updates', event: 'dynamic' },
];

test('#451 the measured case: only Dependabot runs at trunk, all red → trunk reads none (not red), the dropped runs named', () => {
  const fx = fixture(60);
  fx.setRows(dependabotRed(fx.sha), dependabotRed(fx.sha));
  const ci = trunkCiRow(fx);
  assert.doesNotMatch(ci.detail, /conclusion=failure/, JSON.stringify(ci));
  assert.match(ci.detail, /no run for main@/);
  assert.match(ci.detail, /excluded 2 runs from workflows this repo does not own \(event: dynamic, #451\)/);
  assert.match(ci.detail, /Dependabot Updates \(failure, run 71\)/);
});

test('#451 a Dependabot red beside the repo\'s own green → green, and the detail still says what it did not count', () => {
  const fx = fixture(60);
  fx.setRows([...dependabotRed(fx.sha), ...green(fx.sha)], []);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, /1 run at main@\w+: success — excluded 2 runs/);
});

test('#451 a repo-owned red still blocks, Dependabot rows or not', () => {
  const fx = fixture(60);
  const ownRed = [{ headSha: fx.sha, status: 'completed', conclusion: 'failure', createdAt: '2026-10-03T11:00:00Z', databaseId: 9, workflowName: 'CI', event: 'push' }];
  fx.setRows([...dependabotRed(fx.sha), ...ownRed], []);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'human-gated');
  assert.match(ci.detail, /conclusion=failure/);
});

// --- #461: a superseded attempt of the same workflow no longer vetoes its later success ----------

test('#461 the measured case: release skipped twice then success at trunk → green, superseded runs named', () => {
  const fx = fixture(60);
  const rows = [
    { headSha: fx.sha, status: 'completed', conclusion: 'success', createdAt: '2026-10-03T12:00:00Z', databaseId: 30, workflowName: 'release', event: 'workflow_run' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success', createdAt: '2026-10-03T11:55:00Z', databaseId: 29, workflowName: 'CI', event: 'push' },
    { headSha: fx.sha, status: 'completed', conclusion: 'skipped', createdAt: '2026-10-03T11:00:00Z', databaseId: 20, workflowName: 'release', event: 'workflow_run' },
    { headSha: fx.sha, status: 'completed', conclusion: 'skipped', createdAt: '2026-10-03T10:00:00Z', databaseId: 10, workflowName: 'release', event: 'workflow_run' },
  ];
  fx.setRows(rows, rows);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.doesNotMatch(ci.detail, /conclusion=skipped/);
  assert.match(ci.detail, /2 runs at main@\w+: all success — set aside 2 superseded runs \(a newer run of the same workflow decides, #461\): release \(skipped, run 20\), release \(skipped, run 10\)/);
});
