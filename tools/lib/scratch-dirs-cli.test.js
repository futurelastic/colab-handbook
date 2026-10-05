'use strict';
/**
 * #488 — the configured scratch dirs never make a teardown refuse a worktree, and `colab worktree
 * new` hides them in the clone's shared info/exclude. Real CLI, real repo, real bare `origin`, a
 * linked worktree made with git directly (fixture shape from release-pending.test.js).
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

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-scratch-dirs-')));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'scratch dirs test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  fs.writeFileSync(path.join(work, 'README'), 'base\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'chore: fixture'); g(work, 'push', '-q', 'origin', 'main');
  // No gh at all: the commands under test must not need the tracker.
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
  return { root, work, home, bin, g };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, HOME: fx.home,
      COLAB_SESSION: 'sess-scratch', COLAB_SESSION_NAME: '', COLAB_PLANS_DIR: '', COLAB_BRIEFS_DIR: '', ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function linkedWorktree(fx, name, branch) {
  const wtPath = path.join(fx.root, name);
  fx.g(fx.work, 'worktree', 'add', '-q', '-b', branch, wtPath, 'origin/main');
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify({
    version: 1,
    worktrees: { [name]: { repo: fx.work, path: wtPath, branch, ports: [], session: null, sessionName: null, created: new Date().toISOString() } },
    claims: {}, ports: {}, solo: {},
  }));
  return wtPath;
}

test('worktree rm: plan and brief files in the configured dirs never make teardown refuse', () => {
  const fx = fixture();
  const wt = linkedWorktree(fx, 'scratch-1', 'chore/scratch-1');
  fs.mkdirSync(path.join(wt, '.plans')); fs.writeFileSync(path.join(wt, '.plans', 'issue-1.md'), 'plan\n');
  fs.mkdirSync(path.join(wt, '.briefs')); fs.writeFileSync(path.join(wt, '.briefs', 'b.md'), 'brief\n');
  const r = colab(fx, ['worktree', 'rm', 'scratch-1', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fs.existsSync(wt), false, 'the worktree directory must be gone');
});

test('worktree rm: a configured COLAB_PLANS_DIR is scratch too', () => {
  const fx = fixture();
  const wt = linkedWorktree(fx, 'scratch-2', 'chore/scratch-2');
  fs.mkdirSync(path.join(wt, 'tmp-plans')); fs.writeFileSync(path.join(wt, 'tmp-plans', 'issue-2.md'), 'plan\n');
  const r = colab(fx, ['worktree', 'rm', 'scratch-2', '--repo', fx.work], { COLAB_PLANS_DIR: 'tmp-plans' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fs.existsSync(wt), false);
});

test('worktree rm: a real untracked file still refuses — the scratch carve-out is narrow (contrast)', () => {
  const fx = fixture();
  const wt = linkedWorktree(fx, 'scratch-3', 'chore/scratch-3');
  fs.writeFileSync(path.join(wt, 'new-module.js'), 'x\n');
  const r = colab(fx, ['worktree', 'rm', 'scratch-3', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, 'unsaved real work must still block teardown');
  assert.strictEqual(fs.existsSync(path.join(wt, 'new-module.js')), true);
});

test('worktree new: hides the scratch dirs in the clone\'s shared info/exclude, idempotently', () => {
  const fx = fixture();
  const r1 = colab(fx, ['worktree', 'new', 'chore/scratch-4', '--repo', fx.work]);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  const r2 = colab(fx, ['worktree', 'new', 'chore/scratch-5', '--repo', fx.work]);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  const exclude = fs.readFileSync(path.join(fx.work, '.git', 'info', 'exclude'), 'utf8').split('\n');
  for (const line of ['/.plans/', '/.briefs/', '/.claude/plans/']) {
    assert.strictEqual(exclude.filter((l) => l === line).length, 1, `${line} exactly once`);
  }
  // and git really hides them in the main checkout
  fs.mkdirSync(path.join(fx.work, '.plans')); fs.writeFileSync(path.join(fx.work, '.plans', 'issue-4.md'), 'p\n');
  assert.strictEqual(fx.g(fx.work, 'status', '--porcelain', '-uall').includes('.plans'), false);
});
