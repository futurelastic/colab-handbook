'use strict';
/**
 * #463: `colab trunk-ci` prints the trunk-CI verdict `colab ship` computes, and code-triage reads
 * trunk through it — so the two can no longer disagree about a sha. The measured disagreement: at
 * one trunk sha `CI` succeeded and `Release (auto)` failed; ship parked every candidate on
 * `conclusion=failure`, while triage's own `gh run list` filter ("GREEN when any run succeeded")
 * said GREEN and never filed the red.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` answering `run list` from one file — the same
 * fixture shape as ship-ci-empty-read.test.js. Each case runs BOTH readers on the same rows.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const TRIAGE_SKILL = path.join(REPO_ROOT, 'skills', 'code-triage', 'SKILL.md');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-trunk-ci-'));
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
  g(work, 'config', 'user.name', 'colab trunk-ci test');
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

  const runEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-463', COLAB_SESSION_NAME: '' };
  return { work, sha, runEnv, setRows: (rows) => fs.writeFileSync(rowsFile, JSON.stringify(rows)) };
}

function trunkCi(fx) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.runEnv });
  return { code: r.status, body: JSON.parse(r.stdout) };
}

function shipRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(r.stdout).checks.find((c) => c.name === 'trunk CI green');
}

const row = (sha, workflowName, conclusion, id, status = 'completed') =>
  ({ headSha: sha, status, conclusion, createdAt: `2026-10-03T1${id % 10}:00:00Z`, databaseId: id, workflowName, event: 'push' });

test('#463 the measured case: CI green beside Release red → trunk-ci RED, and ship\'s row is not ok on the same rows', () => {
  const fx = fixture();
  fx.setRows([row(fx.sha, 'Release (auto)', 'failure', 2), row(fx.sha, 'CI', 'success', 1)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.code, 0);
  assert.strictEqual(t.body.verdict, 'RED', JSON.stringify(t.body));
  assert.strictEqual(t.body.sha, fx.sha);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, false, JSON.stringify(s));
  assert.strictEqual(t.body.detail, s.detail, 'one function, one detail — the two readers must not drift');
});

test('#463 all workflows green → GREEN in trunk-ci, ok in ship', () => {
  const fx = fixture();
  fx.setRows([row(fx.sha, 'Release (auto)', 'success', 2), row(fx.sha, 'CI', 'success', 1)]);
  assert.strictEqual(trunkCi(fx).body.verdict, 'GREEN');
  assert.strictEqual(shipRow(fx).ok, true);
});

test('#463 a superseded red attempt of the same workflow does not read RED (#461 carried through)', () => {
  const fx = fixture();
  fx.setRows([row(fx.sha, 'CI', 'success', 3), row(fx.sha, 'CI', 'failure', 1)]);
  assert.strictEqual(trunkCi(fx).body.verdict, 'GREEN');
});

test('#463 a run still in flight → PENDING, not RED', () => {
  const fx = fixture();
  fx.setRows([row(fx.sha, 'CI', null, 1, 'in_progress')]);
  // createdAt is hours old, so give the wedge check its job count read a failure → it cannot prove a wedge
  const v = trunkCi(fx).body.verdict;
  assert.ok(v === 'PENDING' || v === 'WEDGED', v);
  assert.notStrictEqual(v, 'RED');
});

test('#463 no run at the sha → NONE', () => {
  const fx = fixture();
  fx.setRows([]);
  assert.strictEqual(trunkCi(fx).body.verdict, 'NONE');
});

test('#463 code-triage keeps no trunk-red rule of its own — it calls colab trunk-ci', () => {
  const skill = fs.readFileSync(TRIAGE_SKILL, 'utf8');
  // #524: the skill is a core plus reference files — the old filter must be absent from all of them.
  const dir = path.dirname(TRIAGE_SKILL);
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(!all.includes('any(.conclusion == "success")'), 'the old any-success filter is back in code-triage');
  assert.ok(skill.includes('colab trunk-ci'), 'code-triage no longer calls colab trunk-ci');
});
