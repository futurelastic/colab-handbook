'use strict';
/**
 * End-to-end tests for three close-path holes in `colab ship` (group:ship-cmdship-internals):
 *
 *   #319 — a claim with NO worktree was never released by ship (B3/E2 teardown ran only through
 *          `cmdWorktreeRm`, keyed by worktree name), and a claim with neither worktree nor branch was
 *          invisible to `resolveShipSession` altogether.
 *   #302 — a branchless trunk-direct unit had no close path: `ship` needed --worktree/--branch,
 *          refused --branch <trunk>, and `landedState` answers `unknown` when base === branch.
 *          `colab ship --direct` is that path.
 *   #324 — a branch that exists ONLY on origin, carries no issue number and has no local claim read
 *          as a legit zero and shipped; it now refuses unless --adopt, which records the adoption.
 *
 * Real CLI, real repo, real bare `origin`. `gh` is a generous stub (same shape as
 * ship-plan-journal.test.js) that additionally LOGS every call, so a test can assert what was
 * released/closed rather than only the exit code.
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

const SESSION = 'https://claude.ai/code/session_close_paths_S';
const OTHER = 'https://claude.ai/code/session_close_paths_OTHER';

function fixture({ yml = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-close-paths-'));
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
  g(work, 'config', 'user.name', 'close paths test');
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

// =================================================================================================
// #319 — ship releases every claim it carried, and sees its own session's unattached claim
// =================================================================================================

test('#319: a --branch claim with NO worktree is released by a merge ship (it used to outlive it)', () => {
  const fx = fixture();
  commitOnBranch(fx, 'fix/x-70', 'x.txt', 'fix: x');
  assert.strictEqual(colab(fx, ['claim', '70', '--branch', 'fix/x-70', '--repo', fx.work]).code, 0);
  const r = colab(fx, ['ship', '--branch', 'fix/x-70', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(hasClaim(fx, 70), false, 'claim #70 must be released by ship itself');
  assert.match(ghLog(fx), /issue edit 70 --remove-assignee @me --remove-label in-progress/);
  assert.deepStrictEqual(Object.keys(places(fx)), [], 'the checkout hold goes with the last claim');
});

test('#319: the same claim shape is released by an evidence-close (zero-diff) ship', () => {
  const fx = fixture();
  fx.g(fx.work, 'branch', 'docs/decision-71');
  colab(fx, ['claim', '71', '--branch', 'docs/decision-71', '--repo', fx.work]);
  const r = colab(fx, ['ship', '--branch', 'docs/decision-71', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /evidence-close/);
  assert.strictEqual(hasClaim(fx, 71), false);
});

test('#319: the #317 shape — an unattached claim of THIS session, named by the branch, is adopted: Closes #N + released', () => {
  const fx = fixture();
  colab(fx, ['claim', '72', '--repo', fx.work]); // no worktree, no branch
  commitOnBranch(fx, 'fix/y-72', 'y.txt', 'fix: y');
  const r = colab(fx, ['ship', '--branch', 'fix/y-72', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /issues: #72/);
  assert.match(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Closes #72/);
  assert.strictEqual(hasClaim(fx, 72), false);
  assert.deepStrictEqual(Object.keys(places(fx)), [], 'no place record may remain for the checkout');
});

test('#319: an unattached claim held by a DIFFERENT session is not adopted — #153 still refuses', () => {
  const fx = fixture();
  colab(fx, ['claim', '73', '--repo', fx.work], { session: OTHER });
  commitOnBranch(fx, 'fix/z-73', 'z.txt', 'fix: z');
  const r = colab(fx, ['ship', '--branch', 'fix/z-73', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /registry has nothing/);
  assert.strictEqual(hasClaim(fx, 73), true);
});

test('#319: a same-session unattached claim the branch does NOT name is reported, not closed, not released', () => {
  const fx = fixture();
  colab(fx, ['claim', '74', '--repo', fx.work]);
  commitOnBranch(fx, 'chore/tidy', 't.txt', 'chore: tidy');
  const r = colab(fx, ['ship', '--branch', 'chore/tidy', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /#74/);
  assert.match(r.out + r.err, /#74 is claimed by this session with no worktree and no branch/);
  assert.strictEqual(hasClaim(fx, 74), true);
});

// =================================================================================================
// #302 — colab ship --direct
// =================================================================================================

function directUnit(fx, num, { push = true, file = `d${num}.txt` } = {}) {
  colab(fx, ['claim', String(num), '--repo', fx.work]);
  fs.writeFileSync(path.join(fx.work, file), 'direct\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `feat: direct unit (#${num})`);
  if (push) fx.g(fx.work, 'push', '-q', 'origin', 'main');
}

test('#302: ship --direct closes a pushed trunk-direct unit with evidence and releases its claim + hold', () => {
  const fx = fixture();
  directUnit(fx, 60);
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /evidence-close \(trunk-direct\)/);
  assert.match(ghLog(fx), /issue close 60 --reason completed/);
  assert.match(ghLog(fx), /issue comment 60 .*trunk-direct/s);
  assert.strictEqual(hasClaim(fx, 60), false);
  assert.deepStrictEqual(Object.keys(places(fx)), []);
});

test('#302: ship --direct --dry reports READY and changes nothing', () => {
  const fx = fixture();
  directUnit(fx, 61);
  const r = colab(fx, ['ship', '--direct', '--dry', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /READY/);
  assert.doesNotMatch(ghLog(fx), /issue close/);
  assert.strictEqual(hasClaim(fx, 61), true);
});

test('#302: ship --direct --dry --json has the evidence-close shape with no branch', () => {
  const fx = fixture();
  directUnit(fx, 62);
  const r = colab(fx, ['ship', '--direct', '--dry', '--json', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.direct, true);
  assert.strictEqual(j.mode, 'evidence-close');
  assert.strictEqual(j.branch, null);
  assert.strictEqual(j.worktree, null);
  assert.deepStrictEqual(j.issues, [62]);
});

test('#302: an UNPUSHED trunk-direct unit is refused — nothing closed', () => {
  const fx = fixture();
  directUnit(fx, 63, { push: false });
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.doesNotMatch(ghLog(fx), /issue close/);
  assert.strictEqual(hasClaim(fx, 63), true);
});

test('#302: the evidence gate is unchanged — no evidence comment leaves the issue open AND keeps its claim for the re-run', () => {
  const fx = fixture();
  directUnit(fx, 64);
  fs.writeFileSync(path.join(fx.root, 'no-evidence'), '');
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#64 left OPEN/);
  assert.doesNotMatch(ghLog(fx), /issue close 64/);
  assert.strictEqual(hasClaim(fx, 64), true, 'a re-run must still find the claim');
});

test('#302: ship --direct refuses a blank session identity', () => {
  const fx = fixture();
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work], { session: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--session/);
});

test('#302: another session\'s unattached claim is never closed — "nothing to close"', () => {
  const fx = fixture();
  colab(fx, ['claim', '65', '--repo', fx.work], { session: OTHER });
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /nothing to close/);
  assert.match(r.out, /1 other session/);
  assert.strictEqual(hasClaim(fx, 65), true);
});

test('#302: a same-session claim that carries a branch is excluded, with the command that ships it', () => {
  const fx = fixture();
  fx.g(fx.work, 'branch', 'fix/b-66');
  colab(fx, ['claim', '66', '--branch', 'fix/b-66', '--repo', fx.work]);
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /--branch fix\/b-66/);
  assert.match(r.out, /nothing to close/);
  assert.strictEqual(hasClaim(fx, 66), true);
});

test('#302: writes: isolated vetoes trunk-direct', () => {
  const fx = fixture({ yml: 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\nwrites: isolated\n' });
  directUnit(fx, 67);
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /vetoes trunk-direct/);
  assert.doesNotMatch(ghLog(fx), /issue close/);
});

test('#302: the autonomy gate is unchanged — absent autonomy refuses a unit that is not docs-only', () => {
  const fx = fixture({ yml: 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n' });
  directUnit(fx, 68, { file: 'd68.js' }); // #345: a .txt unit would be docs-only and close
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.doesNotMatch(ghLog(fx), /issue close/);
});

test('#302: --direct cannot be combined with --branch', () => {
  const fx = fixture();
  const r = colab(fx, ['ship', '--direct', '--branch', 'fix/x-1', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /cannot be combined with --branch/);
});

test('#302: a bare ship and a --branch <trunk> ship both point at --direct', () => {
  const fx = fixture();
  const bare = colab(fx, ['ship', '--repo', fx.work]);
  assert.notStrictEqual(bare.code, 0);
  assert.match(bare.err, /--direct/);
  const trunk = colab(fx, ['ship', '--branch', 'main', '--repo', fx.work]);
  assert.notStrictEqual(trunk.code, 0);
  assert.match(trunk.err, /colab ship --direct/);
});

// =================================================================================================
// #324 — remote-only, digit-less, unclaimed ⇒ refuse unless --adopt
// =================================================================================================

function pushFromAnotherMachine(fx, branch) {
  const other = path.join(fx.root, 'other');
  execFileSync('git', ['clone', '-q', fx.origin, other], { encoding: 'utf8' });
  fx.g(other, 'config', 'user.email', 'other@example.invalid');
  fx.g(other, 'config', 'user.name', 'other machine');
  fx.g(other, 'config', 'core.hooksPath', path.join(fx.root, '.nohooks'));
  fx.g(other, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(other, 'p.txt'), 'parser\n');
  fx.g(other, 'add', '-A');
  fx.g(other, 'commit', '-q', '-m', 'chore: bump parser');
  fx.g(other, 'push', '-q', 'origin', branch);
  fx.g(fx.work, 'fetch', '-q', 'origin');
  return fx.g(other, 'rev-parse', 'HEAD');
}

test('#324: a remote-only branch with no issue number and no local claim is REFUSED — and no local ref is created', () => {
  const fx = fixture();
  pushFromAnotherMachine(fx, 'chore/bump-parser');
  const mainBefore = fx.g(fx.work, 'rev-parse', 'main');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /only on origin/i);
  assert.match(r.err, /--adopt/);
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/chore/bump-parser'], { cwd: fx.work }).status, 1);
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main'), mainBefore);
});

test('#324: --dry --json reports the same refusal as a human-gated row', () => {
  const fx = fixture();
  pushFromAnotherMachine(fx, 'chore/bump-parser');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--dry', '--json', '--repo', fx.work]);
  const j = JSON.parse(r.out);
  const row = j.checks.find((c) => c.name === 'issues resolved (not zero-by-registry-gap)');
  assert.ok(row, JSON.stringify(j.checks));
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
  assert.match(row.detail, /ONLY on origin/);
  assert.strictEqual(j.ok, false);
});

test('#324: --adopt ships it and the squash records the adoption', () => {
  const fx = fixture();
  const sha = pushFromAnotherMachine(fx, 'chore/bump-parser');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--adopt', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const body = fx.g(fx.work, 'log', '-1', '--format=%B', 'main');
  assert.match(body, new RegExp(`Colab-Adopted: origin/chore/bump-parser @ ${sha}`));
  assert.match(r.out, /adopted from origin\/chore\/bump-parser/);
});

test('#367: on a PUBLIC repo the Colab-Adopted: trailer keeps branch + sha but drops the host', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.root, 'public'), '');
  const sha = pushFromAnotherMachine(fx, 'chore/bump-parser');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--adopt', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const body = fx.g(fx.work, 'log', '-1', '--format=%B', 'main');
  assert.match(body, new RegExp(`^Colab-Adopted: origin/chore/bump-parser @ ${sha}$`, 'm'));
  assert.doesNotMatch(body, /^Machine:/m);
});

test('#367: on a PRIVATE repo the Colab-Adopted: trailer still names the host (#324 unchanged)', () => {
  const fx = fixture();
  const sha = pushFromAnotherMachine(fx, 'chore/bump-parser');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--adopt', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const body = fx.g(fx.work, 'log', '-1', '--format=%B', 'main');
  assert.match(body, new RegExp(`^Colab-Adopted: origin/chore/bump-parser @ ${sha} on \\S+ \\(machine `, 'm'));
  assert.match(body, /^Machine: /m);
});

test('#324: a LOCAL digit-less unclaimed branch is still a legit zero — unchanged', () => {
  const fx = fixture();
  commitOnBranch(fx, 'chore/local-tidy', 'l.txt', 'chore: local tidy');
  const r = colab(fx, ['ship', '--branch', 'chore/local-tidy', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /Nothing contradicts it/);
  assert.doesNotMatch(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Colab-Adopted/);
});

test('#324: a local branch with a local claim is unchanged — Closes #N, no adoption', () => {
  const fx = fixture();
  commitOnBranch(fx, 'fix/a-80', 'a.txt', 'fix: a');
  colab(fx, ['claim', '80', '--branch', 'fix/a-80', '--repo', fx.work]);
  const r = colab(fx, ['ship', '--branch', 'fix/a-80', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const body = fx.g(fx.work, 'log', '-1', '--format=%B', 'main');
  assert.match(body, /Closes #80/);
  assert.doesNotMatch(body, /Colab-Adopted/);
});

test('#324: --adopt on a branch it does not apply to is ignored, loudly, and records nothing', () => {
  const fx = fixture();
  commitOnBranch(fx, 'chore/local-two', 'l2.txt', 'chore: local two');
  const r = colab(fx, ['ship', '--branch', 'chore/local-two', '--adopt', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /--adopt ignored/);
  assert.doesNotMatch(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Colab-Adopted/);
});

// =================================================================================================
// #343 — remote-only detection survives a git DWIM checkout that already made the local ref
// =================================================================================================

test('#343: a branch DWIM-created locally by `git checkout <b>` from origin is still REFUSED without --adopt', () => {
  const fx = fixture();
  pushFromAnotherMachine(fx, 'chore/bump-parser');
  fx.g(fx.work, 'checkout', '-q', 'chore/bump-parser'); // DWIM: creates refs/heads/chore/bump-parser from origin
  fx.g(fx.work, 'checkout', '-q', 'main');
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/chore/bump-parser'], { cwd: fx.work }).status, 0, 'precondition: DWIM made the local ref');
  const mainBefore = fx.g(fx.work, 'rev-parse', 'main');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /came from origin/);
  assert.match(r.err, /--adopt/);
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main'), mainBefore);
});

test('#343: --dry --json reports the DWIM-created branch as the same human-gated refusal', () => {
  const fx = fixture();
  pushFromAnotherMachine(fx, 'chore/bump-parser');
  fx.g(fx.work, 'switch', '-q', 'chore/bump-parser');
  fx.g(fx.work, 'switch', '-q', 'main');
  const j = JSON.parse(colab(fx, ['ship', '--branch', 'chore/bump-parser', '--dry', '--json', '--repo', fx.work]).out);
  const row = j.checks.find((c) => c.name === 'issues resolved (not zero-by-registry-gap)');
  assert.ok(row, JSON.stringify(j.checks));
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
  assert.match(row.detail, /came from origin/);
});

test('#343: --adopt ships a DWIM-created branch and records the adoption', () => {
  const fx = fixture();
  const sha = pushFromAnotherMachine(fx, 'chore/bump-parser');
  fx.g(fx.work, 'checkout', '-q', 'chore/bump-parser');
  fx.g(fx.work, 'checkout', '-q', 'main');
  const r = colab(fx, ['ship', '--branch', 'chore/bump-parser', '--adopt', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), new RegExp(`Colab-Adopted: origin/chore/bump-parser @ ${sha}`));
});

test('#343: a branch made here with `checkout -b` and pushed is still a legit zero — the reflog says HEAD, not origin', () => {
  const fx = fixture();
  commitOnBranch(fx, 'chore/local-pushed', 'lp.txt', 'chore: local pushed');
  fx.g(fx.work, 'push', '-q', '-u', 'origin', 'chore/local-pushed');
  const r = colab(fx, ['ship', '--branch', 'chore/local-pushed', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /Nothing contradicts it/);
  assert.doesNotMatch(fx.g(fx.work, 'log', '-1', '--format=%B', 'main'), /Colab-Adopted/);
});

// =================================================================================================
// #344 — gh usability is the ACTIVE credential, not the aggregate `gh auth status`
// =================================================================================================

function ciRow(fx) {
  commitOnBranch(fx, 'chore/gh-probe', 'g.txt', 'chore: gh probe');
  const j = JSON.parse(colab(fx, ['ship', '--branch', 'chore/gh-probe', '--dry', '--json', '--repo', fx.work]).out);
  const row = j.checks.find((c) => /CI green$/.test(c.name));
  assert.ok(row, JSON.stringify(j.checks));
  return row;
}

test('#344: a broken INACTIVE account (`gh auth status` exit 1) with a working active credential — gh is usable, CI reads green', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.root, 'auth-broken'), '');
  const row = ciRow(fx);
  assert.strictEqual(row.ok, true, JSON.stringify(row));
  assert.doesNotMatch(row.detail, /gh not usable/);
});

test('#344: no working credential at all — the refusal names the credential, not "no auth / no origin"', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.root, 'auth-broken'), '');
  fs.writeFileSync(path.join(fx.root, 'no-credential'), '');
  const row = ciRow(fx);
  assert.strictEqual(row.ok, false);
  assert.match(row.detail, /gh not usable \(gh has no working credential/);
  assert.doesNotMatch(row.detail, /no origin/);
});

test('#344: gh fine but no origin remote — the refusal says so, and does not blame auth', () => {
  const fx = fixture();
  commitOnBranch(fx, 'chore/gh-probe', 'g.txt', 'chore: gh probe');
  fx.g(fx.work, 'remote', 'remove', 'origin');
  const j = JSON.parse(colab(fx, ['ship', '--branch', 'chore/gh-probe', '--dry', '--json', '--repo', fx.work]).out);
  const row = j.checks.find((c) => /CI green$/.test(c.name));
  assert.ok(row, JSON.stringify(j.checks));
  assert.strictEqual(row.ok, false);
  assert.match(row.detail, /gh not usable \(no origin remote\)/);
});
