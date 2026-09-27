'use strict';
/**
 * #389: a force-claim onto an UNRECORDED worktree wrote a `pending` stub with `path: null`; `ship`'s
 * dry run passed on it; the real ship pushed trunk and only then refused its own `status: merged`
 * write — skipping evidence, claim release and teardown.
 *
 * Three pinned behaviours:
 *   1. `claim --force --worktree <name> --branch <b>` onto a worktree git already has, with no colab
 *      record, attaches the real directory (status running) instead of stubbing a null path.
 *   2. `ship --dry` (prose and --json) FAILS on a record the post-push flip would refuse — the
 *      precondition is measured before anything irreversible.
 *   3. The zero-claim refusal no longer says "another machine" when the branch is checked out here.
 *
 * `COLAB_HOME` is redirected per test; no network (a local bare `origin`).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const records = require('./records');

const COLAB = path.resolve(__dirname, '..', 'colab');
const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-389-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab 389 test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  return { root, work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-389-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const statePath = (fx) => path.join(fx.home, 'state.json');
const readState = (fx) => JSON.parse(fs.readFileSync(statePath(fx), 'utf8'));
const writeState = (fx, st) => fs.writeFileSync(statePath(fx), JSON.stringify(st, null, 2) + '\n');

const BRANCH = 'fix/thing-389';
const WT = 'thing-389';

/** A worktree with one commit, then its record and claim removed — what a wrap's release leaves. */
function unrecordedWorktree() {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', BRANCH, '--issues', '389', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err + r.out);
  const wtPath = readState(fx).worktrees[WT].path;
  fs.writeFileSync(path.join(wtPath, 'thing.txt'), 'x\n');
  fx.g(wtPath, 'add', '-A');
  fx.g(wtPath, 'commit', '-q', '-m', 'fix: thing (#389)');
  const st = readState(fx);
  delete st.worktrees[WT];
  st.claims = {};
  writeState(fx, st);
  return { fx, wtPath: fs.realpathSync(wtPath) };
}

// --- unit ---------------------------------------------------------------------

test('flipProblems: a pending null-path stub cannot take status merged; a real record can', () => {
  assert.match(records.flipProblems('w', { branch: 'fix/a-1', path: null, status: 'pending' }, { status: 'merged' }).join(''),
    /path is null while status is "merged"/);
  assert.deepStrictEqual(records.flipProblems('w', { branch: 'fix/a-1', path: '/tmp/w', status: 'running' }, { status: 'merged' }), []);
  // A problem the record ALREADY carried is not the flip's doing — same rule as the state guard.
  assert.deepStrictEqual(records.flipProblems('w', { branch: 'fix/a-1', path: null, status: 'running' }, { status: 'merged' }), []);
});

// --- end-to-end ---------------------------------------------------------------

test('claim --force --worktree onto an unrecorded worktree records its real path', () => {
  const { fx, wtPath } = unrecordedWorktree();
  const r = colab(fx, ['claim', '389', '--worktree', WT, '--branch', BRANCH, '--force', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.match(r.out, /attached to the directory git already has/);
  const wt = readState(fx).worktrees[WT];
  assert.strictEqual(fs.realpathSync(wt.path), wtPath);
  assert.strictEqual(wt.status, 'running');
  assert.strictEqual(wt.branch, BRANCH);

  const dry = colab(fx, ['ship', '--worktree', WT, '--repo', fx.work, '--dry', '--json']);
  const rep = JSON.parse(dry.out);
  const row = rep.checks.find((c) => /record writable/.test(c.name));
  assert.ok(row && row.ok, JSON.stringify(rep.checks, null, 1));
});

test('without --branch, the worktree is found by its directory name', () => {
  const { fx, wtPath } = unrecordedWorktree();
  const r = colab(fx, ['claim', '389', '--worktree', WT, '--force', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err + r.out);
  const wt = readState(fx).worktrees[WT];
  assert.strictEqual(fs.realpathSync(wt.path), wtPath);
  assert.strictEqual(wt.branch, BRANCH, 'the branch actually checked out there is recorded');
});

test('a worktree that does not exist yet still gets the pending stub', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '5', '--worktree', 'later-5', '--repo', fx.work]).code, 0);
  const wt = readState(fx).worktrees['later-5'];
  assert.strictEqual(wt.path, null);
  assert.strictEqual(wt.status, 'pending');
});

test('ship --dry fails on a record the post-push flip would refuse (prose and --json)', () => {
  const { fx } = unrecordedWorktree();
  // The pre-fix shape, written directly: a pending stub with no path, and a claim onto it.
  const st = readState(fx);
  st.worktrees[WT] = { name: WT, repo: fs.realpathSync(fx.work), branch: BRANCH, path: null, ports: [], host: 'test', status: 'pending', created: new Date().toISOString() };
  st.claims[`${fs.realpathSync(fx.work)}#389`] = { issue: '#389', repo: fs.realpathSync(fx.work), worktree: WT, branch: BRANCH, host: 'test', created: new Date().toISOString() };
  writeState(fx, st);

  const json = colab(fx, ['ship', '--worktree', WT, '--repo', fx.work, '--dry', '--json']);
  const rep = JSON.parse(json.out);
  assert.strictEqual(rep.ok, false);
  const row = rep.checks.find((c) => /record writable/.test(c.name));
  assert.ok(row && !row.ok, JSON.stringify(rep.checks, null, 1));
  assert.match(row.detail, /path is null while status is "merged"/);

  const prose = colab(fx, ['ship', '--worktree', WT, '--repo', fx.work, '--dry']);
  assert.match(prose.out, /✗\s+worktree record writable \(#389\)/);
  assert.match(prose.out, /NOT READY/);
  assert.ok(!/→ READY/.test(prose.out), `dry run read as ready:\n${prose.out}`);
});

test('zero-claim refusal names this machine when the branch is checked out here', () => {
  const { fx, wtPath } = unrecordedWorktree();
  const prose = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry']);
  assert.notStrictEqual(prose.code, 0);
  assert.match(prose.err, /IS checked out on this machine/);
  assert.ok(prose.err.includes(wtPath) || prose.err.includes(path.basename(wtPath)));
  assert.ok(!/lives on ANOTHER MACHINE/.test(prose.err), prose.err);
  assert.match(prose.err, new RegExp(`--worktree ${WT} --branch ${BRANCH.replace('/', '\\/')}`));

  const json = JSON.parse(colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry', '--json']).out);
  const row = json.checks.find((c) => /registry-gap/.test(c.name));
  assert.ok(row && !row.ok);
  assert.match(row.detail, /checked out on this machine/);
  assert.ok(!/another machine/.test(row.detail), row.detail);
});
