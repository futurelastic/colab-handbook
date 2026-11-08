'use strict';
/**
 * #694: the cure row of `colab ship --dry --json` on the shape that was refused. Every job on trunk's
 * red sha never started (no steps, a few seconds between its timestamps, as `gh run view --json jobs`
 * reports a job the runner service refused). The cure branch edits its workflows, its push CI is green,
 * and its `Release (auto)` dry run is green with the unmodified template's conditional steps skipped.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` — ci-cure.test.js covers the pure rules, this
 * covers the production read (`shipCureJobEvidence`) feeding them. The trunk row needs a failing read
 * that succeeds, which is why the fixture answers `gh run list` and `gh run view` itself, unlike
 * ship-ci-cure.test.js, whose local origin makes every read fail.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const { DRY_RUN_STEP } = require('./ci-cure.js');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const BRANCH = 'chore/self-hosted-runners-7';
const CI_ID = 501;
const REL_ID = 502;
const REL_NAME = 'Release (auto)';
const REL_JOB = 'Cut, finalize, publish';

const step = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });
const neverStarted = (name) => ({ name, status: 'completed', conclusion: 'failure',
  startedAt: '2026-10-03T17:01:30Z', completedAt: '2026-10-03T17:01:33Z', steps: [] });

/** A dry run of the unmodified template: the two conditional steps and the [publish] steps skipped. */
function templateDryRun(overrides = {}) {
  const conclusions = { 'Retry a refused cut once the CLI moved (#547)': 'skipped',
    'Start the heavy lane at the new candidate': 'skipped',
    'Read the npm target (colab release npm) [publish]': 'skipped',
    'Read the downloads target [publish]': 'skipped',
    'Publish GitHub Release (same run) [publish]': 'skipped', ...overrides };
  const names = ['Set up job', 'Run actions/checkout', DRY_RUN_STEP, 'Gate on the triggering CI run', 'Fetch the colab CLI',
    'Retry a refused cut once the CLI moved (#547)', 'Promote unattended (colab promote --auto)',
    'Cut a candidate (colab release cut --auto)', 'Start the heavy lane at the new candidate',
    'Heavy lane green at the candidate?', 'Finalize the newest clean candidate',
    'Read the npm target (colab release npm) [publish]', 'Read the downloads target [publish]',
    'Publish GitHub Release (same run) [publish]', 'Complete job'];
  return { name: REL_JOB, status: 'completed', conclusion: 'success',
    startedAt: '2026-10-03T18:00:00Z', completedAt: '2026-10-03T18:01:00Z',
    steps: names.map((n) => step(n, conclusions[n] || 'success')) };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-cure-never-started-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'colab cure test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('push', '-q', 'origin', 'main');
  const redSha = g('rev-parse', 'HEAD').trim();

  // The cure: it moves the workflow to a self-hosted runner, so it goes through the #321 carve-out.
  g('checkout', '-q', '-b', BRANCH);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\njobs:\n  test:\n    runs-on: self-hosted\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: move CI to self-hosted runners (#7)');
  g('push', '-q', 'origin', BRANCH);
  const head = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', 'main');

  const dir = path.join(root, 'gh-data');
  fs.mkdirSync(dir);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${dir}/runs.json"; exit 0; fi`,
    `if [ "$1" = "run" ] && [ "$2" = "view" ] && [ -f "${dir}/jobs-$3.json" ]; then cat "${dir}/jobs-$3.json"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const put = (name, v) => fs.writeFileSync(path.join(dir, name), JSON.stringify(v));
  const row = (id, sha, workflowName, workflowDatabaseId, event, conclusion) => ({ headSha: sha, status: 'completed', conclusion,
    createdAt: '2026-10-03T17:01:30Z', updatedAt: '2026-10-03T17:01:33Z', databaseId: id, workflowName, workflowDatabaseId, event });
  // Run ids: 1xx trunk's red runs, 2xx the branch's.
  put('runs.json', [
    row(101, redSha, 'CI', CI_ID, 'push', 'failure'),
    row(102, redSha, REL_NAME, REL_ID, 'workflow_run', 'failure'),
    row(201, head, 'CI', CI_ID, 'push', 'success'),
    row(202, head, REL_NAME, REL_ID, 'workflow_dispatch', 'success'),
  ]);
  put('jobs-101.json', { jobs: [neverStarted('Test')] });
  put('jobs-102.json', { jobs: [neverStarted(REL_JOB)] });
  put('jobs-201.json', { jobs: [{ name: 'Test', status: 'completed', conclusion: 'success',
    startedAt: '2026-10-03T18:00:00Z', completedAt: '2026-10-03T18:02:00Z',
    steps: [step('Set up job'), step('Run tests'), step('Complete job')] }] });
  put('jobs-202.json', { jobs: [templateDryRun()] });

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-694', COLAB_SESSION_NAME: '' };
  return { work, env, put };
}

function shipDry(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', BRANCH, '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.env });
  const doc = JSON.parse(r.stdout);
  return { row: doc.checks.find((c) => c.name === 'trunk CI green'), cure: doc.ciCure };
}

test('#694 ship --dry --json: every red job never started, workflows moved, CI and a template dry run green → the cure row passes', () => {
  const { row, cure } = shipDry(fixture());
  assert.equal(row.ok, true, row.detail);
  assert.equal(cure.ok, true, cure.reason);
  assert.equal(cure.via, 'workflow-carve-out');
  assert.deepEqual(cure.dryRun, { jobs: [REL_JOB] });
  assert.deepEqual(cure.carveOut.jobs.map((j) => [j.name, j.redDurationMs]), [['Test', 3000], [REL_JOB, 3000]]);
});

test('#694 ship --dry --json: the same branch with its dry run skipping an unlisted step → the cure row refuses', () => {
  const fx = fixture();
  fx.put('jobs-202.json', { jobs: [templateDryRun({ 'Finalize the newest clean candidate': 'skipped' })] });
  const { row, cure } = shipDry(fx);
  assert.equal(row.ok, false);
  assert.equal(cure.ok, false);
  assert.match(cure.reason, /Finalize the newest clean candidate.*not a publishing step/);
});
