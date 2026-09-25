'use strict';
/**
 * #368 — what `colab ship` B3 does with the shipped branch.
 *
 * Default (#17) is still KEEP; the exception is a Refs-only ship (closes nothing, references at
 * least one issue), which DELETES the branch local + remote, because its issue stays open and a
 * kept ref would read as live work on that issue indefinitely. `--keep-branch` keeps it;
 * `--delete-branch` still forces deletion anywhere; both together are refused.
 *
 * Two layers: the pure decision (tools/lib/shipped-branch.js), then real ships through the CLI
 * against a real bare `origin` with a logging `gh` stub — fixture copied from
 * ship-close-paths.test.js on purpose, same as every ship-*.test.js here.
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

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const SESSION = 'https://claude.ai/code/session_shipped_branch_S';
const OTHER = 'https://claude.ai/code/session_shipped_branch_OTHER';

function fixture({ yml = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-shipped-branch-'));
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
  g(work, 'config', 'user.name', 'shipped branch test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    // #344: `auth-broken` = the aggregate `gh auth status` exits 1 (a broken INACTIVE account) while the
    // active credential works; `no-credential` = the active credential is broken too (`api user` fails).
    `if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ -f "${path.join(root, 'auth-broken')}" ]; then echo "X token in keyring is invalid (fixture)" >&2; exit 1; fi`,
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "api" ] && [ "$2" = "user" ] && [ -f "${path.join(root, 'no-credential')}" ]; then echo "HTTP 401: Bad credentials (fixture)" >&2; exit 1; fi`,
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    // #367: the forge's visibility — PRIVATE unless the test drops a `public` marker.
    `if [ "$1" = "repo" ] && [ "$2" = "view" ]; then if [ -f "${path.join(root, 'public')}" ]; then echo PUBLIC; else echo PRIVATE; fi; exit 0; fi`,
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    // an open issue carrying ONE comment colab did not write — unless the test drops a `no-evidence` marker
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    `  if [ -f "${path.join(root, 'no-evidence')}" ]; then echo '{"state":"OPEN","labels":[],"comments":[]}'; exit 0; fi`,
    '  echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, ghLog, g };
}

function colab(fx, args, { session = SESSION, env = {} } = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: session, COLAB_SESSION_NAME: '', COLAB_HUMAN: '', ...env,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function claims(fx) {
  const p = path.join(fx.home, 'state.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')).claims || {};
}
function places(fx) {
  const p = path.join(fx.home, 'state.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')).places || {};
}
function hasClaim(fx, num) { return Object.values(claims(fx)).some((c) => String(c.issue).replace(/^#/, '') === String(num)); }
function ghLog(fx) { return fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : ''; }
function commitOnBranch(fx, branch, file, msg) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), `${branch}\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', msg);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

const { shippedBranchDisposition, conflictingFlags } = require('./shipped-branch');

/** Commit on a branch, claim it, THEN push it — the order `colab worktree new` itself uses. Pushing
 *  first makes the claim refuse: a remote branch carrying #N that this machine never claimed IS
 *  someone else's claim record (#325). */
function claimedPushedBranch(fx, branch, num, file, msg) {
  commitOnBranch(fx, branch, file, msg);
  const c = colab(fx, ['claim', String(num), '--branch', branch, '--repo', fx.work]);
  assert.strictEqual(c.code, 0, c.out + c.err);
  fx.g(fx.work, 'push', '-q', '-u', 'origin', branch);
}
function localHas(fx, branch) {
  try { fx.g(fx.work, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); return true; } catch (_) { return false; }
}
function originHas(fx, branch) {
  try { fx.g(fx.origin, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); return true; } catch (_) { return false; }
}

// =================================================================================================
// the decision
// =================================================================================================

test('decision: a Closes ship keeps the branch (the #17 default is unchanged)', () => {
  const d = shippedBranchDisposition({ closeIssues: [5], refsIssues: [] });
  assert.strictEqual(d.delete, false);
  assert.strictEqual(d.reason, 'default');
});

test('decision: a Refs-only ship deletes, and says which open issue it spares', () => {
  const d = shippedBranchDisposition({ closeIssues: [], refsIssues: [23] });
  assert.strictEqual(d.delete, true);
  assert.strictEqual(d.reason, 'refs-only');
  assert.match(d.detail, /#23/);
});

test('decision: a MIXED ship (one closed, one referenced) keeps — only a ship that closes nothing is Refs-only', () => {
  assert.strictEqual(shippedBranchDisposition({ closeIssues: [5], refsIssues: [23] }).delete, false);
});

test('decision: a ship naming no issue at all keeps (not Refs-only — there is nothing it is spared for)', () => {
  assert.strictEqual(shippedBranchDisposition({ closeIssues: [], refsIssues: [] }).delete, false);
});

test('decision: --keep-branch keeps a Refs-only ship; --delete-branch deletes a Closes ship', () => {
  const k = shippedBranchDisposition({ closeIssues: [], refsIssues: [23], keepBranch: true });
  assert.strictEqual(k.delete, false);
  assert.strictEqual(k.reason, 'flag-keep');
  const d = shippedBranchDisposition({ closeIssues: [5], refsIssues: [], deleteBranch: true });
  assert.strictEqual(d.delete, true);
  assert.strictEqual(d.reason, 'flag-delete');
});

test('decision: both flags together is a conflict', () => {
  assert.strictEqual(conflictingFlags({ deleteBranch: true, keepBranch: true }), true);
  assert.strictEqual(conflictingFlags({ deleteBranch: true }), false);
  assert.strictEqual(conflictingFlags({ keepBranch: true }), false);
});

// =================================================================================================
// real ships
// =================================================================================================

test('#368: a Refs-only ship deletes the shipped branch, local AND origin, and says why', () => {
  const fx = fixture();
  claimedPushedBranch(fx, 'feat/slice-23', 23, 's.txt', 'feat: interim slice');
  const r = colab(fx, ['ship', '--branch', 'feat/slice-23', '--repo', fx.work, '--refs', '23']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Refs #23/);
  assert.match(r.out, /deleting branch feat\/slice-23: Refs-only ship \(#23 stays open\)/);
  assert.strictEqual(localHas(fx, 'feat/slice-23'), false, 'local branch must be gone');
  assert.strictEqual(originHas(fx, 'feat/slice-23'), false, 'origin ref must be gone — it is the one every other machine reads as live');
});

test('#368: a Closes ship still keeps the branch (default unchanged)', () => {
  const fx = fixture();
  claimedPushedBranch(fx, 'fix/done-24', 24, 'd.txt', 'fix: done');
  const r = colab(fx, ['ship', '--branch', 'fix/done-24', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /keeping branch fix\/done-24 \(default;/);
  assert.strictEqual(localHas(fx, 'fix/done-24'), true);
  assert.strictEqual(originHas(fx, 'fix/done-24'), true);
});

test('#368: --keep-branch keeps a Refs-only branch', () => {
  const fx = fixture();
  claimedPushedBranch(fx, 'feat/slice-25', 25, 's.txt', 'feat: interim slice');
  const r = colab(fx, ['ship', '--branch', 'feat/slice-25', '--repo', fx.work, '--refs', '25', '--keep-branch']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /keeping branch feat\/slice-25 \(--keep-branch \(overrides the Refs-only delete/);
  assert.strictEqual(originHas(fx, 'feat/slice-25'), true);
});

test('#368: --dry names the Refs-only delete in its plan line and changes nothing', () => {
  const fx = fixture();
  claimedPushedBranch(fx, 'feat/slice-26', 26, 's.txt', 'feat: interim slice');
  const r = colab(fx, ['ship', '--branch', 'feat/slice-26', '--repo', fx.work, '--refs', '26', '--dry']);
  assert.match(r.out, /delete branch \(local\+remote\) — Refs-only ship, #368/);
  assert.strictEqual(originHas(fx, 'feat/slice-26'), true);
  const k = colab(fx, ['ship', '--branch', 'feat/slice-26', '--repo', fx.work, '--refs', '26', '--keep-branch', '--dry']);
  assert.match(k.out, /keep branch/);
});

test('#368: --delete-branch with --keep-branch is refused before anything runs', () => {
  const fx = fixture();
  claimedPushedBranch(fx, 'feat/slice-27', 27, 's.txt', 'feat: interim slice');
  const r = colab(fx, ['ship', '--branch', 'feat/slice-27', '--repo', fx.work, '--delete-branch', '--keep-branch']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--delete-branch and --keep-branch contradict each other/);
  assert.strictEqual(fx.g(fx.work, 'log', '-1', '--format=%s', 'main'), 'chore: fixture', 'nothing merged');
  assert.strictEqual(originHas(fx, 'feat/slice-27'), true);
});

test('#368: a Refs-only ship with --keep-worktree cannot delete, and says what is left and how to clear it', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/slice-28', '--issues', '28', '--repo', fx.work]).code, 0);
  const wt = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8')).worktrees;
  const wtPath = Object.values(wt).find((w) => w.branch === 'feat/slice-28').path;
  fs.writeFileSync(path.join(wtPath, 's.txt'), 'slice\n');
  fx.g(wtPath, 'add', '-A');
  fx.g(wtPath, 'commit', '-q', '-m', 'feat: interim slice');
  fx.g(wtPath, 'push', '-q', 'origin', 'feat/slice-28');
  const r = colab(fx, ['ship', '--branch', 'feat/slice-28', '--repo', fx.work, '--refs', '28', '--keep-worktree']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /feat\/slice-28 NOT deleted: its worktree was kept .* still-open #28 and will read as live work/);
  assert.doesNotMatch(r.out + r.err, /still-open [^\n]*#368/);
  assert.strictEqual(originHas(fx, 'feat/slice-28'), true);
});
