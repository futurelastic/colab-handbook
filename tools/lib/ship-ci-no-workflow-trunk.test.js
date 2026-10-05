'use strict';
/**
 * #482: a trunk with NO repo-owned workflow file reads `none`, and that `none` does not block a
 * branch whose own run at its remote head is green — the adoption branch that adds CI to a freshly
 * adopted repo lands on its own green run. A trunk that HAS workflows but no run at its sha is a
 * real gap and still blocks.
 *
 * Real CLI, real repo, real bare `origin`. The fake `gh` answers `run list --branch main` and
 * `run list --branch feat/x-1` from separate files; `--commit` reads (the #413 re-read) from a third.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(path.resolve(__dirname, '..', '..'), 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture({ trunkHasWorkflow, committedAgoMin = 60 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-no-wf-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = new Date(Date.now() - committedAgoMin * 60000).toISOString();
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab no-workflow test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  if (trunkHasWorkflow) fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();

  // The adoption branch: it is what adds CI.
  g(work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'on: [push, pull_request]\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: add ci');
  g(work, 'push', '-q', 'origin', 'feat/x-1');
  const branchSha = g(work, 'rev-parse', 'HEAD').trim();
  g(work, 'checkout', '-q', 'main');

  const trunkRows = path.join(root, 'trunk-rows.json');
  const branchRows = path.join(root, 'branch-rows.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  case " $* " in',
    `    *" --commit ${sha} "*|*" --branch main "*) cat "${trunkRows}"; exit 0 ;;`,
    `    *) cat "${branchRows}"; exit 0 ;;`,
    '  esac',
    'fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const setRows = (trunk, branch) => {
    fs.writeFileSync(trunkRows, JSON.stringify(trunk));
    fs.writeFileSync(branchRows, JSON.stringify(branch));
  };
  return { work, home, bin, sha, branchSha, setRows };
}

function trunkCiRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-482', COLAB_SESSION_NAME: '' },
  });
  const body = JSON.parse(r.stdout);
  return body.checks.find((c) => c.name === 'trunk CI green');
}

const run = (sha, conclusion, status = 'completed') => [{ headSha: sha, status, conclusion, createdAt: '2026-10-05T00:00:00Z', databaseId: 9, workflowName: 'CI', event: 'push' }];

test('#482 trunk with 0 workflow files + green branch run → the trunk CI row passes as none', () => {
  const fx = fixture({ trunkHasWorkflow: false });
  fx.setRows([], run(fx.branchSha, 'success'));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, /^none — main@\w+ has no repo-owned workflow/);
  assert.match(ci.detail, /feat\/x-1@\w+: success/);
});

test('#482 trunk with 0 workflow files, sha committed minutes ago → no grace wait, the branch run decides', () => {
  const fx = fixture({ trunkHasWorkflow: false, committedAgoMin: 1 });
  fx.setRows([], run(fx.branchSha, 'success'));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
});

test('#482 trunk with 0 workflow files + red branch run → still blocks, the reason names the branch run', () => {
  const fx = fixture({ trunkHasWorkflow: false });
  fx.setRows([], run(fx.branchSha, 'failure'));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'human-gated', JSON.stringify(ci));
  assert.match(ci.detail, /conclusion=failure/);
});

test('#482 trunk with 0 workflow files + branch run in flight → self-clearing, not passed', () => {
  const fx = fixture({ trunkHasWorkflow: false });
  fx.setRows([], run(fx.branchSha, null, 'in_progress'));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'self-clearing', JSON.stringify(ci));
});

test('#482 trunk with 0 workflow files + no branch run either → still blocks', () => {
  const fx = fixture({ trunkHasWorkflow: false });
  fx.setRows([], []);
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'human-gated', JSON.stringify(ci));
  assert.match(ci.detail, /has no run/);
});

test('#482 trunk WITH workflows but no run at its sha → still blocks as before, even with a green branch run', () => {
  const fx = fixture({ trunkHasWorkflow: true });
  fx.setRows([], run(fx.branchSha, 'success'));
  const ci = trunkCiRow(fx);
  assert.strictEqual(ci.ok, false);
  assert.strictEqual(ci.class, 'human-gated', JSON.stringify(ci));
  assert.match(ci.detail, /no run for main@/);
});
