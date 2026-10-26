'use strict';
/**
 * End-to-end tests for #668: `colab ship` run from a shell whose cwd is INSIDE the worktree it tears
 * down. Teardown stops the processes a worktree owns by cwd (#22), and the calling shell matched
 * that test — so ship SIGTERMed its own caller mid-teardown and died with the merge landed and the
 * claim, label, claim ref and evidence left behind. Two halves, one test each:
 *
 *   1. the caller (this command's ancestors) is never stopped: the wrapping shell survives, ship
 *      exits 0, and every teardown step ran;
 *   2. a tail that IS interrupted (here: killed outright from a pre-remove hook) is finished by
 *      re-running the same `colab ship` — no second squash, one 🚢 comment.
 *
 * Real CLI, real repo, real bare `origin`, a `gh` stub that logs every call — the fixture shape of
 * ship-container-close.test.js. Run: `node --test tools/lib/*.test.js`.
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

const SESSION = 'https://claude.ai/code/session_ship_cwd_inside_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const BRANCH = 'fix/thing-80';

function fixture({ preRemove } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-cwd-')));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship cwd test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  if (preRemove) {
    fs.mkdirSync(path.join(work, '.colab', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(work, '.colab', 'hooks', 'pre-remove'), preRemove(root), { mode: 0o755 });
  }
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo PRIVATE; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    // CLOSED once origin/main carries `Closes #N` — GitHub's auto-close, simulated
    `  if git -C "${origin}" log main --format=%B 2>/dev/null | grep -q "Closes #$3\\b"; then`,
    '    echo \'{"state":"CLOSED","labels":[],"comments":[]}\'; exit 0',
    '  fi',
    '  echo \'{"state":"OPEN","labels":[],"comments":[]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, COLAB_HOME: home,
    COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
  };
  return { root, origin, work, home, ghLog, g, env };
}

function colab(fx, args, cwd = fx.work) {
  const r = spawnSync('node', [COLAB, ...args], { cwd, encoding: 'utf8', env: fx.env });
  return { code: r.status, signal: r.signal, out: r.stdout || '', err: r.stderr || '' };
}
const ghLog = (fx) => (fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : '');
const stateOf = (fx) => JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
const claimRefs = (fx) => fx.g(fx.origin, 'for-each-ref', '--format=%(refname)', 'refs/claims/');
const closesOnMain = (fx) => fx.g(fx.origin, 'log', 'main', '--format=%B').split('\n').filter((l) => /Closes #80\b/.test(l)).length;
const shipComments = (fx) => ghLog(fx).split('\n').filter((l) => /^issue comment 80 --body 🚢 Shipped/.test(l)).length;

/** Cut the worktree (claiming #80), commit the work in it, and return its path. */
function worktreeWithWork(fx) {
  const r = colab(fx, ['worktree', 'new', BRANCH, '--issues', '80', '--session', SESSION, '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const wt = Object.values(stateOf(fx).worktrees).find((w) => w.branch === BRANCH);
  assert.ok(wt && fs.existsSync(wt.path), 'the worktree exists on disk');
  fs.writeFileSync(path.join(wt.path, 'thing.txt'), 'the fix\n');
  fx.g(wt.path, 'add', '-A');
  fx.g(wt.path, 'commit', '-q', '-m', 'fix: the thing (#80)');
  return wt;
}

test('#668: ship run from a shell inside the worktree finishes every teardown step and exits 0', () => {
  const fx = fixture();
  const wt = worktreeWithWork(fx);
  // The shell IS the caller whose cwd is inside the worktree — the process #22's teardown used to stop.
  const r = spawnSync('sh', ['-c', `cd "${wt.path}" && node "${COLAB}" ship --branch ${BRANCH}; echo "ship-exit=$?"`],
    { cwd: fx.work, encoding: 'utf8', env: fx.env });
  const all = (r.stdout || '') + (r.stderr || '');
  assert.strictEqual(r.signal, null, `the wrapping shell was killed (${r.signal}) — teardown stopped its own caller\n${all}`);
  assert.strictEqual(r.status, 0, all);
  assert.match(r.stdout, /ship-exit=0/, all);
  assert.match(r.stdout, /left running pid \d+ .*it runs this command/, all);
  assert.ok(!fs.existsSync(wt.path), 'the worktree directory is gone');
  assert.strictEqual(stateOf(fx).worktrees[wt.name], undefined, 'the worktree record is gone');
  assert.strictEqual(Object.values(stateOf(fx).claims).filter((c) => String(c.issue).endsWith('80')).length, 0, 'the claim is released');
  assert.strictEqual(claimRefs(fx), '', 'the claim ref is deleted from origin');
  assert.strictEqual(closesOnMain(fx), 1, 'merged exactly once');
  assert.strictEqual(shipComments(fx), 1, 'the 🚢 evidence comment is posted');
});

test('#668: a tail killed mid-teardown is finished by re-running colab ship — no second squash, one 🚢', () => {
  // First run only: the pre-remove hook kills its parent — the `colab ship` process — outright.
  const fx = fixture({
    preRemove: (root) => `#!/bin/sh\nM="${root}/killed-once"\nif [ ! -f "$M" ]; then : > "$M"; kill -9 $PPID; sleep 5; fi\nexit 0\n`,
  });
  const wt = worktreeWithWork(fx);
  const first = colab(fx, ['ship', '--branch', BRANCH]);
  assert.strictEqual(first.signal, 'SIGKILL', first.out + first.err);
  assert.strictEqual(closesOnMain(fx), 1, 'the merge landed before the kill');
  const rec = stateOf(fx).worktrees[wt.name];
  assert.ok(rec && rec.status === 'merged' && rec.mergedSha, 'the record says merged and names the merge');
  assert.strictEqual(shipComments(fx), 0, 'no evidence was posted before the kill');

  const second = colab(fx, ['ship', '--branch', BRANCH]);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.match(second.out, /→ RESUME: fix\/thing-80 is already merged into main/);
  assert.doesNotMatch(second.out, /B1: squash-merging/);
  assert.strictEqual(closesOnMain(fx), 1, 'no second squash');
  assert.ok(!fs.existsSync(wt.path), 'the worktree directory is gone');
  assert.strictEqual(stateOf(fx).worktrees[wt.name], undefined, 'the worktree record is gone');
  assert.strictEqual(claimRefs(fx), '', 'the claim ref is deleted from origin');
  assert.strictEqual(shipComments(fx), 1, 'exactly one 🚢 comment');
  assert.match(ghLog(fx), /🚢 Shipped to main by colab ship — \w+ — finished by a re-run/);
});

test('#668: a merged worktree kept with --keep-worktree resumes teardown without a second 🚢', () => {
  const fx = fixture();
  const wt = worktreeWithWork(fx);
  const first = colab(fx, ['ship', '--branch', BRANCH, '--keep-worktree']);
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(shipComments(fx), 1);
  assert.ok(stateOf(fx).worktrees[wt.name].shipTailAt, 'the kept record is stamped');
  const second = colab(fx, ['ship', '--branch', BRANCH]);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.match(second.out, /→ RESUME/);
  assert.ok(!fs.existsSync(wt.path), 'the worktree directory is gone');
  assert.strictEqual(shipComments(fx), 1, 'no second 🚢 comment');
  assert.strictEqual(closesOnMain(fx), 1, 'no second squash');
});

test('#668: a record written before #668 (no mergedSha) resumes from the newest Closes commit on the target', () => {
  const fx = fixture({
    preRemove: (root) => `#!/bin/sh\nM="${root}/killed-once"\nif [ ! -f "$M" ]; then : > "$M"; kill -9 $PPID; sleep 5; fi\nexit 0\n`,
  });
  const wt = worktreeWithWork(fx);
  assert.strictEqual(colab(fx, ['ship', '--branch', BRANCH]).signal, 'SIGKILL');
  const file = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete st.worktrees[wt.name].mergedSha;
  delete st.worktrees[wt.name].mergedTarget;
  fs.writeFileSync(file, JSON.stringify(st, null, 2));

  const second = colab(fx, ['ship', '--branch', BRANCH]);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.match(second.out, /→ RESUME: .*the newest commit on the target naming its issues/);
  assert.strictEqual(closesOnMain(fx), 1, 'no second squash');
  assert.ok(!fs.existsSync(wt.path), 'the worktree directory is gone');
  assert.strictEqual(shipComments(fx), 1, 'exactly one 🚢 comment');
});
