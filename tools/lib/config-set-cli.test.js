'use strict';
/**
 * End-to-end tests for #561 — `colab config set <tuning-key>` and the TUNING-ONLY class of
 * `colab ship`, on a repo that does NOT declare `autonomy: auto-trunk`. The acceptance cases:
 *   - a tuning-only diff ships with no issue;
 *   - a diff touching one tuning key and one authority key is refused the class;
 *   - a malformed value is refused by `config set` and by the class.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is the logging stub from ship-docs-only.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_config_set_S';
const NO_AUTONOMY = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nship-batch: 1\n';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

function fixture(yml = NO_AUTONOMY) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-config-set-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'config-set test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  // Backdated, so a trunk-direct unit's --since window (whole seconds) never includes this commit.
  execFileSync('git', ['commit', '-q', '-m', 'chore: fixture'], {
    cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
  });
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin, ghLog, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const mainLog = (fx) => fx.g(fx.work, 'log', '--format=%s', 'main');
const BR = 'chore/tune-ship-batch';

test('#561: config set commits one tuning value on a short branch, touching no checkout', () => {
  const fx = fixture();
  const r = colab(fx, ['config', 'set', 'ship-batch', '2', '--evidence', 'batch-stats: 9 lone waits in 30d', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /ship-batch: 1 → 2/);
  assert.match(r.out, /tuning-only \(ship-batch\)/);
  // The main checkout is still on trunk, clean, and its file unchanged.
  assert.strictEqual(fx.g(fx.work, 'branch', '--show-current'), 'main');
  assert.strictEqual(fx.g(fx.work, 'status', '--porcelain'), '');
  assert.match(fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8'), /ship-batch: 1/);
  // The branch is on origin, one commit on trunk, the descriptor alone changed, evidence in the body.
  assert.strictEqual(fx.g(fx.work, 'rev-parse', `refs/remotes/origin/${BR}^`), fx.g(fx.work, 'rev-parse', 'main'));
  assert.strictEqual(fx.g(fx.work, 'diff', '--name-only', `main...${BR}`), '.github/project.yml');
  assert.match(fx.g(fx.work, 'show', `${BR}:.github/project.yml`), /ship-batch: 2/);
  const msg = fx.g(fx.work, 'log', '-1', '--format=%B', BR);
  assert.match(msg, /^chore\(project\): ship-batch 1 → 2/);
  assert.match(msg, /Evidence: batch-stats: 9 lone waits in 30d/);
});

test('#561: a tuning-only diff ships with no issue on a non-auto-trunk repo', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['config', 'set', 'ship-batch', '2', '--evidence', 'measured', '--repo', fx.work]).code, 0);
  const dry = colab(fx, ['ship', '--branch', BR, '--repo', fx.work, '--dry', '--json']);
  const j = JSON.parse(dry.out);
  assert.strictEqual(j.autonomyGate.via, 'tuning', dry.out + dry.err);
  assert.deepStrictEqual(j.autonomyGate.tuning.keys, ['ship-batch']);
  assert.deepStrictEqual(j.issues, []);
  const r = colab(fx, ['ship', '--branch', BR, '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /autonomy granted\s+tuning-only \(ship-batch\) — autonomy exception \(#561\)/);
  assert.match(fx.g(fx.work, 'show', 'main:.github/project.yml'), /ship-batch: 2/);
  assert.match(mainLog(fx), /chore\(project\): ship-batch 1 → 2/);
  assert.match(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Evidence: measured/);
  assert.doesNotMatch(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Closes #/);
});

test('#561: a diff touching one tuning key and one authority key is refused the class', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'chore/tune-mixed');
  fs.writeFileSync(path.join(fx.work, '.github', 'project.yml'), NO_AUTONOMY.replace('ship-batch: 1', 'ship-batch: 2') + 'autonomy: auto-trunk\n');
  fx.g(fx.work, 'commit', '-q', '-am', 'chore(project): ship-batch 2, and autonomy');
  fx.g(fx.work, 'checkout', '-q', 'main');
  const r = colab(fx, ['ship', '--branch', 'chore/tune-mixed', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.match(r.err, /Nor the tuning-only class \(#561\): .*autonomy/);
  assert.doesNotMatch(mainLog(fx), /autonomy/);
});

test('#561: a malformed value is refused by config set, and by the class', () => {
  const fx = fixture();
  const r = colab(fx, ['config', 'set', 'ship-batch', '9', '--evidence', 'x', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /malformed tuning value: ship-batch is 9/);
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${BR}`], { cwd: fx.work }).status, 1);

  fx.g(fx.work, 'checkout', '-q', '-b', 'chore/tune-bad');
  fs.writeFileSync(path.join(fx.work, '.github', 'project.yml'), NO_AUTONOMY.replace('ship-batch: 1', 'ship-batch: 9'));
  fx.g(fx.work, 'commit', '-q', '-am', 'chore(project): ship-batch 9');
  fx.g(fx.work, 'checkout', '-q', 'main');
  const s = colab(fx, ['ship', '--branch', 'chore/tune-bad', '--repo', fx.work]);
  assert.strictEqual(s.code, 1, s.out + s.err);
  assert.match(s.err, /Nor the tuning-only class \(#561\): malformed tuning value/);
});

test('#561: config set refuses an authority key and requires evidence', () => {
  const fx = fixture();
  const a = colab(fx, ['config', 'set', 'autonomy', 'auto-trunk', '--evidence', 'x', '--repo', fx.work]);
  assert.strictEqual(a.code, 1);
  assert.match(a.err, /grants authority or changes what deploys/);
  const e = colab(fx, ['config', 'set', 'ship-batch', '2', '--repo', fx.work]);
  assert.strictEqual(e.code, 1);
  assert.match(e.err, /--evidence/);
  // A machine-local key still goes to the machine config, as before.
  assert.strictEqual(colab(fx, ['config', 'set', 'portRange', '47000-47100']).code, 0);
});
