'use strict';
/**
 * #503: only runs that VERIFY the code count toward a sha's CI verdict. The measured case: CI green at
 * trunk's head, then `Release (auto)` (workflow_run-triggered, ~20–30 min: cut a candidate, publish,
 * deploy to staging) still in progress at the same sha — ship read the sha as "still running" and four
 * green, graded candidates waited behind the release lane.
 *
 * Unit half: tools/lib/verify-runs.js + git.summarizeRunsForCommit's opt-in. CLI half: the real
 * `colab trunk-ci` / `colab ship --dry` on a fixture repo, fake `gh` answering `run list` — the same
 * shape as trunk-ci-verb.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const vr = require('./verify-runs');
const git = require('./git');

const SHA = 'a'.repeat(40);
const r = (workflowName, event, conclusion, id, status = 'completed') =>
  ({ headSha: SHA, status, conclusion, createdAt: `2026-10-05T15:1${id % 10}:00Z`, databaseId: id, workflowName, event });

// ---- unit: the policy --------------------------------------------------------------------------

test('#503 default: push / pull_request / merge_group count; workflow_run, schedule, dispatch, release are set aside', () => {
  const p = vr.parsePolicy({});
  for (const ev of ['push', 'pull_request', 'pull_request_target', 'merge_group']) assert.strictEqual(vr.setAsideReason(r('CI', ev), p), null, ev);
  for (const ev of ['workflow_run', 'schedule', 'workflow_dispatch', 'release', 'deployment', 'repository_dispatch']) {
    assert.strictEqual(vr.setAsideReason(r('X', ev), p), `event: ${ev}`, ev);
  }
});

test('#503 a row with no event field is counted — absence never excludes', () => {
  assert.strictEqual(vr.setAsideReason({ workflowName: 'CI' }, vr.parsePolicy({})), null);
  assert.strictEqual(vr.setAsideReason({ workflowName: 'CI', event: null }, vr.parsePolicy({})), null);
});

test('#503 ship-gate-workflows: exactly the named workflows count, whatever their trigger', () => {
  const p = vr.parsePolicy({ 'ship-gate-workflows': ['CI', 'Nightly'] });
  assert.strictEqual(vr.setAsideReason(r('Nightly', 'schedule'), p), null);
  assert.strictEqual(vr.setAsideReason(r('CI', 'push'), p), null);
  assert.strictEqual(vr.setAsideReason(r('Lint', 'push'), p), 'not in ship-gate-workflows');
});

test('#503 ship-ignore-workflows sets a push-triggered workflow aside, and wins over the gate list', () => {
  const p = vr.parsePolicy({ 'ship-ignore-workflows': ['Deploy'] });
  assert.strictEqual(vr.setAsideReason(r('Deploy', 'push'), p), 'ship-ignore-workflows');
  assert.strictEqual(vr.setAsideReason(r('CI', 'push'), p), null);
  const both = vr.parsePolicy({ 'ship-gate-workflows': ['CI', 'Deploy'], 'ship-ignore-workflows': 'Deploy' });
  assert.strictEqual(vr.setAsideReason(r('Deploy', 'push'), both), 'ship-ignore-workflows');
});

test('#503 an invalid key is a problem and is ignored by the reader (default rule applies)', () => {
  for (const bad of [[], 'x'.length, [''], [3], {}]) {
    const p = vr.parsePolicy({ 'ship-gate-workflows': bad });
    assert.strictEqual(p.valid, false, JSON.stringify(bad));
    assert.strictEqual(p.gate, null);
    assert.ok(p.problems[0].includes('ship-gate-workflows'));
  }
  const p = vr.parsePolicy({ 'ship-gate-workflows': [], 'ship-ignore-workflows': ['Deploy'] });
  assert.strictEqual(vr.setAsideReason(r('Release', 'workflow_run'), p), 'event: workflow_run');
});

// ---- unit: the summarizer opt-in ---------------------------------------------------------------

test('#503 the measured case: CI green + Release (auto) in progress → green with the policy, in_progress without', () => {
  const rows = [r('Release (auto)', 'workflow_run', null, 2, 'in_progress'), r('CI', 'push', 'success', 1)];
  const before = git.summarizeRunsForCommit(rows, SHA);
  assert.strictEqual(before.status, 'in_progress', 'without the opt-in nothing changes');
  assert.strictEqual(before.setAside, undefined);
  const after = git.summarizeRunsForCommit(rows, SHA, { verifying: vr.parsePolicy({}) });
  assert.strictEqual(after.status, 'completed');
  assert.strictEqual(after.conclusion, 'success');
  assert.strictEqual(after.runCount, 1);
  assert.deepStrictEqual(after.setAside, [{ workflowName: 'Release (auto)', status: 'in_progress', conclusion: null, databaseId: 2, why: 'event: workflow_run' }]);
});

test('#503 a failed release run does not turn the sha red', () => {
  const rows = [r('Release (auto)', 'workflow_run', 'failure', 2), r('CI', 'push', 'success', 1)];
  const s = git.summarizeRunsForCommit(rows, SHA, { verifying: vr.parsePolicy({}) });
  assert.strictEqual(s.conclusion, 'success');
});

test('#503 a red verifying run is still red, whatever is set aside beside it', () => {
  const rows = [r('Release (auto)', 'schedule', 'success', 2), r('CI', 'push', 'failure', 1)];
  const s = git.summarizeRunsForCommit(rows, SHA, { verifying: vr.parsePolicy({}) });
  assert.strictEqual(s.conclusion, 'failure');
});

test('#503 only post-CI runs at the sha → none (the verifying run has not appeared), never green', () => {
  const s = git.summarizeRunsForCommit([r('Release (auto)', 'workflow_run', 'success', 2)], SHA, { verifying: vr.parsePolicy({}) });
  assert.strictEqual(s.status, 'none');
  assert.strictEqual(s.setAside.length, 1);
});

test('#503 setAsideNote names each run and why; empty when nothing was set aside', () => {
  assert.strictEqual(vr.setAsideNote(undefined), '');
  assert.strictEqual(vr.setAsideNote([]), '');
  const n = vr.setAsideNote([{ workflowName: 'Release (auto)', status: 'in_progress', conclusion: null, databaseId: 9, why: 'event: workflow_run' }]);
  assert.match(n, /set aside 1 run that does not verify the code/);
  assert.match(n, /Release \(auto\) \(in_progress, run 9; event: workflow_run\)/);
});

// ---- CLI: trunk-ci and ship --dry read the same policy -----------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture(extraYml = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-verify-runs-'));
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
  g(work, 'config', 'user.name', 'colab verify-runs test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), BASE_YML + extraYml);
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
  const rowsFile = path.join(root, 'rows.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${rowsFile}"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const runEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-503', COLAB_SESSION_NAME: '', COLAB_TRUNK_CI_TTL: '0' };
  return { work, sha, runEnv, setRows: (rows) => fs.writeFileSync(rowsFile, JSON.stringify(rows)) };
}

function trunkCi(fx) {
  const res = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(res.stdout);
}
function shipRow(fx) {
  const res = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(res.stdout).checks.find((c) => c.name === 'trunk CI green');
}
const row = (sha, workflowName, event, conclusion, id, status = 'completed') =>
  ({ headSha: sha, status, conclusion, createdAt: `2026-10-05T15:1${id % 10}:00Z`, databaseId: id, workflowName, event });

test('#503 CLI: CI green + Release (auto) in progress → trunk-ci GREEN, ship row ok, both name the set-aside run', () => {
  const fx = fixture();
  fx.setRows([row(fx.sha, 'Release (auto)', 'workflow_run', null, 2, 'in_progress'), row(fx.sha, 'CI', 'push', 'success', 1)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN', JSON.stringify(t));
  assert.match(t.detail, /set aside 1 run .*Release \(auto\).*event: workflow_run/);
  assert.strictEqual(t.setAside[0].workflowName, 'Release (auto)');
  const s = shipRow(fx);
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  assert.strictEqual(s.detail, t.detail, 'one function, one detail');
});

test('#503 CLI: ship-gate-workflows makes a dispatch-triggered workflow count again', () => {
  const fx = fixture('ship-gate-workflows: [CI, Release (auto)]\n');
  fx.setRows([row(fx.sha, 'Release (auto)', 'workflow_run', 'failure', 2), row(fx.sha, 'CI', 'push', 'success', 1)]);
  assert.strictEqual(trunkCi(fx).verdict, 'RED');
});

test('#503 CLI: ship-ignore-workflows sets a push-triggered deploy aside', () => {
  const fx = fixture('ship-ignore-workflows: [Deploy]\n');
  fx.setRows([row(fx.sha, 'Deploy', 'push', null, 2, 'in_progress'), row(fx.sha, 'CI', 'push', 'success', 1)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.verdict, 'GREEN', JSON.stringify(t));
  assert.match(t.detail, /Deploy \(in_progress, run 2; ship-ignore-workflows\)/);
});
