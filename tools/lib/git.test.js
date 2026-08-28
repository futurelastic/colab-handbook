'use strict';
/**
 * Tests for tools/lib/git.js — `worktreeListDetailed` (#67), `resolveWorktreePathForBranch` and
 * `gitFailureLine` (#286/#287), the dirty-tree readings (#86), `ghRunForSha` (#92), and
 * `ghRunForCommit` (#293).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `worktreeListDetailed` is the ground-truth read `colab worktrees` reconciles its own records
 * against (tools/colab: `unrecordedWorktrees`). Getting the porcelain parse wrong in either
 * direction is exactly the failure #67 is about — a real worktree the parse drops is invisible
 * again, just one function lower — so this is built against real git, like landed.test.js, rather
 * than against a hand-written porcelain fixture that could quietly stop matching git's actual
 * output.
 *
 * `ghRunForSha` is the CI verdict `colab ship`'s gate reads, judged by the branch's CURRENT remote
 * head sha rather than by "the newest run" (#92). `git ls-remote` runs for real against a bare `origin` on disk (no network). `gh run list` is
 * network-bound and cannot run for real in a test, so a fake `gh` is placed first on PATH,
 * printing canned JSON from a file the test writes before each call. The property under test is
 * "given these {headSha,status,conclusion} rows, does ghRunForSha read the right one" — not gh's
 * own behaviour, which is out of scope here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const git = require('./git.js');
const { worktreeListDetailed, dirtyTracked, dirtyUntracked, dirtyAny } = git;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// realpath, not just mkdtemp: on macOS `/tmp` is a symlink to `/private/tmp`, so git (which
// resolves paths for real) and a bare os.tmpdir() string disagree on what "the same path" is
// unless both sides are normalised the same way.
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  TMP.push(dir);
  return dir;
}

function repo() {
  const dir = tmp('git-test-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'git test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'README'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: base');
  return { dir, g };
}

test('main checkout only: one entry, branch main, not detached', () => {
  const r = repo();
  const rows = worktreeListDetailed(r.dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(path.resolve(rows[0].path), path.resolve(r.dir));
  assert.strictEqual(rows[0].branch, 'main');
  assert.strictEqual(rows[0].detached, false);
  assert.strictEqual(rows[0].bare, false);
});

test('a linked worktree is a second entry with its OWN path and branch', () => {
  const r = repo();
  const wtDir = tmp('git-test-wt-');
  fs.rmdirSync(wtDir); // `git worktree add` refuses an existing empty dir on some git versions; start clean
  r.g('worktree', 'add', '-b', 'feat/thing', wtDir);

  const rows = worktreeListDetailed(r.dir);
  assert.strictEqual(rows.length, 2);
  const linked = rows.find((w) => path.resolve(w.path) !== path.resolve(r.dir));
  assert.ok(linked, 'linked worktree missing from the parse');
  assert.strictEqual(path.resolve(linked.path), path.resolve(wtDir));
  assert.strictEqual(linked.branch, 'feat/thing');
  assert.strictEqual(linked.detached, false);
});

test('a detached worktree reports branch: null, detached: true — never a guessed branch name', () => {
  const r = repo();
  const sha = r.g('rev-parse', 'HEAD').trim();
  const wtDir = tmp('git-test-wt-');
  fs.rmdirSync(wtDir);
  r.g('worktree', 'add', '--detach', wtDir, sha);

  const rows = worktreeListDetailed(r.dir);
  const linked = rows.find((w) => path.resolve(w.path) !== path.resolve(r.dir));
  assert.ok(linked);
  assert.strictEqual(linked.branch, null);
  assert.strictEqual(linked.detached, true);
});

test('a non-repo path returns [] rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-notrepo-'));
  TMP.push(dir);
  assert.deepStrictEqual(worktreeListDetailed(dir), []);
});

// --- resolveWorktreePathForBranch (#286) ---------------------------------------
//
// `colab ship`'s B0 used to trust a session's own `wtPath` record, which can be null or stale
// while a live worktree of that branch still exists on disk — and then mint a SECOND checkout of
// the same branch, which git refuses ("already checked out at …"). This is the ground-truth read
// that replaces it: built on `worktreeListDetailed` (already tested above against real git), not
// a fresh porcelain parse.

test('#286: a branch checked out in a linked worktree resolves to that worktree\'s path', () => {
  const r = repo();
  const wtDir = tmp('git-test-wt-');
  fs.rmdirSync(wtDir);
  r.g('worktree', 'add', '-b', 'feat/thing', wtDir);

  const found = git.resolveWorktreePathForBranch(r.dir, 'feat/thing');
  assert.strictEqual(path.resolve(found), path.resolve(wtDir));
});

test('#286: a branch not checked out anywhere resolves to null — the only safe case for an ephemeral checkout', () => {
  const r = repo();
  r.g('branch', 'feat/never-checked-out');
  assert.strictEqual(git.resolveWorktreePathForBranch(r.dir, 'feat/never-checked-out'), null);
});

test('#286: the main checkout itself resolves for its own current branch', () => {
  const r = repo();
  assert.strictEqual(path.resolve(git.resolveWorktreePathForBranch(r.dir, 'main')), path.resolve(r.dir));
});

// --- gitFailureLine (#287) ------------------------------------------------------
//
// `stderr.split('\n')[0]` on a failed `git worktree add` keeps git's generic progress line
// ("Preparing worktree (checking out '<branch>')") and discards the `fatal:` line beneath it —
// the only line naming what actually went wrong, including (on a checkout collision) the path of
// the worktree already holding the branch.

test('#287: prefers the fatal: line over a leading progress line', () => {
  const stderr = "Preparing worktree (checking out 'feat/x')\nfatal: 'feat/x' is already checked out at '/repo/wt1'";
  assert.strictEqual(git.gitFailureLine(stderr), "fatal: 'feat/x' is already checked out at '/repo/wt1'");
});

test('#287: falls back to the last non-empty line when there is no fatal: line', () => {
  const stderr = 'Preparing worktree (new branch \'x\')\nhint: something else\n';
  assert.strictEqual(git.gitFailureLine(stderr), "hint: something else");
});

test('#287: a single-line stderr returns that line', () => {
  assert.strictEqual(git.gitFailureLine('fatal: not a git repository'), 'fatal: not a git repository');
});

test('#287: empty/undefined stderr does not throw', () => {
  assert.strictEqual(git.gitFailureLine(''), '');
  assert.strictEqual(git.gitFailureLine(undefined), '');
});

// --- dirty readings (#86) -----------------------------------------------------
//
// The regression these pin is a DATA-LOSS one, so they are written against real git rather than a
// porcelain fixture: the bug was a disagreement about what `git status` actually emits, and a
// hand-written fixture would have agreed with the buggy reading.

test('#86 REGRESSION: a never-added file is invisible to dirtyTracked but caught by dirtyUntracked', () => {
  const r = repo();
  // The exact shape of a session's first hour: new module + new test, neither staged. There is no
  // copy in the index, in a commit, or on a remote — a teardown here destroys them outright.
  fs.writeFileSync(path.join(r.dir, 'checklist.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(r.dir, 'checklist.test.js'), '// tests\n');

  assert.strictEqual(dirtyTracked(r.dir), '', 'tracked reading must stay clean — this is the blind spot');
  const untracked = dirtyUntracked(r.dir);
  assert.match(untracked, /checklist\.js/);
  assert.match(untracked, /checklist\.test\.js/);
  assert.strictEqual(untracked.split('\n').length, 2);
});

test('#86: dirtyAny is the union — tracked edits AND untracked files', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.dir, 'README'), 'base\nedited\n');
  fs.writeFileSync(path.join(r.dir, 'brand-new.js'), 'x\n');

  assert.match(dirtyTracked(r.dir), /README/);
  assert.match(dirtyUntracked(r.dir), /brand-new\.js/);
  assert.strictEqual(dirtyAny(r.dir).split('\n').length, 2);
});

test('#86: IGNORED files stay excluded — build output must not block a teardown', () => {
  const r = repo();
  fs.writeFileSync(path.join(r.dir, '.gitignore'), 'node_modules/\n.env\ndist/\n');
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'chore: ignore');
  fs.mkdirSync(path.join(r.dir, 'node_modules'));
  fs.writeFileSync(path.join(r.dir, 'node_modules', 'pkg.js'), 'x\n');
  fs.writeFileSync(path.join(r.dir, '.env'), 'SECRET=1\n');

  // A worktree post-create hook legitimately produces these. Counting them would make every
  // worktree permanently un-removable without --force, which is how a safety gate gets disabled.
  assert.strictEqual(dirtyUntracked(r.dir), '');
  assert.strictEqual(dirtyAny(r.dir), '');
});

test('#86: -uall names the FILES in a new directory, not the collapsed directory', () => {
  const r = repo();
  fs.mkdirSync(path.join(r.dir, 'newmod'));
  fs.writeFileSync(path.join(r.dir, 'newmod', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(r.dir, 'newmod', 'b.js'), 'b\n');

  // Default porcelain would emit a single `?? newmod/`. The gate is about to delete these, and a
  // directory name does not tell a human which of their new sources is at stake.
  const untracked = dirtyUntracked(r.dir);
  assert.match(untracked, /newmod\/a\.js/);
  assert.match(untracked, /newmod\/b\.js/);
});

test('#86: a clean tree reads clean on all three', () => {
  const r = repo();
  assert.strictEqual(dirtyTracked(r.dir), '');
  assert.strictEqual(dirtyUntracked(r.dir), '');
  assert.strictEqual(dirtyAny(r.dir), '');
});

test('#86: a path git cannot read degrades to clean, so a husk stays removable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-notrepo-'));
  TMP.push(dir);
  fs.writeFileSync(path.join(dir, 'orphan.txt'), 'x\n');
  // Deliberate, not fail-open-by-accident: `git status` failing where the directory exists means a
  // worktree that is no longer a worktree (#62's husk), and refusing there would strand it forever.
  assert.strictEqual(dirtyAny(dir), '');
});

// --- ghRunForSha (#92) ---------------------------------------------------------

/**
 * A repo with a real bare `origin`, one commit pushed to `main`. Returns the repo's work dir, its
 * HEAD sha, and `withFakeGh(runs, fn)` which points PATH at a `gh` stub returning `runs` as
 * `gh run list --json headSha,status,conclusion` would, for the duration of `fn`.
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ghrun-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ghrun test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'f.txt'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const runsFile = path.join(root, 'runs.json');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ncat "${runsFile}"\n`, { mode: 0o755 });
  // a `gh` that always fails, for the "gh run list failed" case
  const failBin = path.join(root, 'bin-fail');
  fs.mkdirSync(failBin);
  fs.writeFileSync(path.join(failBin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  function withFakeGh(runs, binDir, fn) {
    if (runs !== null) fs.writeFileSync(runsFile, JSON.stringify(runs));
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath}`;
    try { return fn(); } finally { process.env.PATH = prevPath; }
  }

  return { work, sha, withFakeGh: (runs, fn) => withFakeGh(runs, bin, fn), withFailingGh: (fn) => withFakeGh([], failBin, fn) };
}

test('a cancelled sibling of a passing run on the SAME sha still reads green (#92, the deadlock case)', () => {
  const fx = fixture();
  // gh returns newest-first: the cancelled duplicate is row 0, the passing original is row 1 —
  // exactly the shape measured on the issue (two runs racing on one push, cancel-in-progress kills one).
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'cancelled' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'success', sha: fx.sha, createdAt: null, databaseId: null, runCount: 2 });
});

test('a stale run on an OLD sha does not count as green for the current head', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  // runCount is 0 here (not 1): the one row in the fixture is for a DIFFERENT sha, so `forSha`
  // (filtered to the current head) is empty — runCount counts siblings AT this sha, not gh's raw
  // row count.
  assert.deepStrictEqual(result, { status: 'none', conclusion: null, sha: fx.sha, createdAt: null, databaseId: null, runCount: 0 });
});

test('a failed sibling of a passing run on the SAME sha reads red, not green (#146/#162)', () => {
  const fx = fixture();
  // Two workflows on one push: the cheap one passed, the test suite failed. `find` used to
  // short-circuit on the first success in the array and never look at the failure sitting right
  // next to it — any-green where the gate's contract requires all-green.
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
    { headSha: fx.sha, status: 'completed', conclusion: 'failure' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'failure', sha: fx.sha, createdAt: null, databaseId: null, runCount: 2 });
});

test('a failed sibling wins regardless of array order — success listed first still reads red', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'failure' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'failure', sha: fx.sha, createdAt: null, databaseId: null, runCount: 2 });
});

test('a timed_out sibling of a passing run on the SAME sha reads red, not green (#165)', () => {
  const fx = fixture();
  // #146 closed any-green for `failure` specifically; #165 is the same shape one conclusion value
  // over — a `timed_out` sibling must be caught by the same all-green contract.
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
    { headSha: fx.sha, status: 'completed', conclusion: 'timed_out' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'timed_out', sha: fx.sha, createdAt: null, databaseId: null, runCount: 2 });
});

test('an action_required sibling of a passing run on the SAME sha reads red, not green (#165)', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'action_required' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'action_required', sha: fx.sha, createdAt: null, databaseId: null, runCount: 2 });
});

test('the sha has runs but none succeeded — surfaces the most informative one, not a false none', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'failure' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'failure', sha: fx.sha, createdAt: null, databaseId: null, runCount: 1 });
});

test('a run still in flight for the sha is preferred over a finished-but-not-successful one', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'in_progress', conclusion: null },
    { headSha: fx.sha, status: 'completed', conclusion: 'cancelled' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result.status, 'in_progress');
  assert.strictEqual(result.sha, fx.sha);
  assert.strictEqual(result.runCount, 2);
});

// --- runCount (#176) — the sample size a caller reports alongside its verdict ----------------

test('runCount is 1 for a single run at the sha — the ordinary, un-duplicated case', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result.runCount, 1);
});

test('runCount counts every sibling workflow at the sha, not just the one whose conclusion is picked', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result.runCount, 3);
});

test('a branch absent on origin returns null rather than a misleading verdict', () => {
  const fx = fixture();
  const result = fx.withFakeGh([{ headSha: fx.sha, status: 'completed', conclusion: 'success' }],
    () => git.ghRunForSha(fx.work, 'no-such-branch'));
  assert.strictEqual(result, null);
});

test('gh failing returns null, distinct from "no runs for this sha"', () => {
  const fx = fixture();
  const result = fx.withFailingGh(() => git.ghRunForSha(fx.work, 'main'));
  assert.strictEqual(result, null);
});

// --- ghRunForCommit (#293) — the same verdict, for a sha that is NOT necessarily the branch's
// current remote head (the merge-base a feature branch was cut from, almost always trunk history).

test('#293: verdict for an explicit historical sha, not the branch\'s current head', () => {
  const fx = fixture();
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'failure' },
  ], () => git.ghRunForCommit(fx.work, 'main', fx.sha));
  assert.deepStrictEqual(result, { status: 'completed', conclusion: 'failure', sha: fx.sha, createdAt: null, databaseId: null, runCount: 1 });
});

test('#293: ghRunForSha and ghRunForCommit agree at the SAME sha — same allowlist, same picks', () => {
  const fx = fixture();
  const runs = [
    { headSha: fx.sha, status: 'completed', conclusion: 'cancelled' },
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ];
  const viaSha = fx.withFakeGh(runs, () => git.ghRunForSha(fx.work, 'main'));
  const viaCommit = fx.withFakeGh(runs, () => git.ghRunForCommit(fx.work, 'main', fx.sha));
  assert.deepStrictEqual(viaCommit, viaSha);
});

test('#293: no sha given returns null — this function never resolves one itself', () => {
  const fx = fixture();
  const result = fx.withFakeGh([{ headSha: fx.sha, status: 'completed', conclusion: 'success' }],
    () => git.ghRunForCommit(fx.work, 'main', null));
  assert.strictEqual(result, null);
});

test('#293: a sha with no matching run reports status: none, runCount: 0', () => {
  const fx = fixture();
  const otherSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const result = fx.withFakeGh([
    { headSha: fx.sha, status: 'completed', conclusion: 'success' },
  ], () => git.ghRunForCommit(fx.work, 'main', otherSha));
  assert.deepStrictEqual(result, { status: 'none', conclusion: null, sha: otherSha, createdAt: null, databaseId: null, runCount: 0 });
});

test('#293: gh failing returns null for ghRunForCommit too', () => {
  const fx = fixture();
  const result = fx.withFailingGh(() => git.ghRunForCommit(fx.work, 'main', fx.sha));
  assert.strictEqual(result, null);
});

// --- GraphQL rate-limit → REST fallback (#164) -----------------------------
//
// `colab ship`'s post-merge writes (release the tracker claim, post the release comment, post the
// ship comment) all go through `gh issue edit`/`gh issue comment`, which is GraphQL under the
// hood — so a GraphQL-only quota exhaustion took out all three at once even though REST `core`
// still had budget (verified by hand on the same token, in the same minute, per the issue). The
// fix is a same-transport-first, REST-on-rate-limit-only fallback: `isGraphqlRateLimit` reads the
// `GraphQL:`-prefixed stderr line `gh` itself produces on that specific failure, and
// `ghIssueComment`/`ghIssueRelease` retry over `gh api` only when that reads true — never on a
// generic failure (network down, bad issue number, ...), where retrying a different transport
// would just be masking a real error as if it were a quota problem.
//
// A dispatching fake `gh` (not the fixed-JSON one above) is needed here because these functions
// make MULTIPLE distinct calls in sequence (GraphQL attempt, then a REST attempt per sub-write) —
// the fixture's single-response stub can't represent that. `FAKE_GH_BEHAVIOR` selects the canned
// outcome per call shape; `FAKE_GH_CALLS` (one JSON array of argv per line) is asserted against so
// a test can tell WHICH transport actually got called, not just the final return value.

function ghFallbackFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ghfallback-'));
  TMP.push(root);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const callsFile = path.join(root, 'calls.jsonl');
  fs.writeFileSync(callsFile, '');

  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.FAKE_GH_CALLS) fs.appendFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(args) + '\\n');
const behavior = process.env.FAKE_GH_BEHAVIOR || 'ok';
function fail(msg) { process.stderr.write(msg + '\\n'); process.exit(1); }
function ok(out) { if (out) process.stdout.write(out); process.exit(0); }
const isGraphqlOp = (args[0] === 'issue' && (args[1] === 'comment' || args[1] === 'edit'));
const isApi = args[0] === 'api';
if (isGraphqlOp) {
  if (behavior === 'graphql-rate-limit-then-rest-ok' || behavior === 'graphql-rate-limit-both-fail') {
    return fail('GraphQL: API rate limit exceeded for installation ID 123. (' + (args[1] === 'comment' ? 'addComment' : 'updateIssue') + ')');
  }
  if (behavior === 'generic-fail') return fail('HTTP 404: Not Found');
  return ok();
}
if (isApi && args.includes('user')) return ok('octofake\\n');
if (isApi) {
  if (behavior === 'graphql-rate-limit-both-fail') return fail('HTTP 403: API rate limit exceeded (rest)');
  return ok();
}
fail('fake gh: unhandled invocation ' + JSON.stringify(args));
`;
  fs.writeFileSync(path.join(bin, 'gh'), script, { mode: 0o755 });

  function withBehavior(behavior, fn) {
    fs.writeFileSync(callsFile, '');
    const prevPath = process.env.PATH;
    const prevBehavior = process.env.FAKE_GH_BEHAVIOR;
    const prevCalls = process.env.FAKE_GH_CALLS;
    process.env.PATH = `${bin}:${prevPath}`;
    process.env.FAKE_GH_BEHAVIOR = behavior;
    process.env.FAKE_GH_CALLS = callsFile;
    try { return fn(); }
    finally {
      process.env.PATH = prevPath;
      if (prevBehavior === undefined) delete process.env.FAKE_GH_BEHAVIOR; else process.env.FAKE_GH_BEHAVIOR = prevBehavior;
      if (prevCalls === undefined) delete process.env.FAKE_GH_CALLS; else process.env.FAKE_GH_CALLS = prevCalls;
    }
  }

  function calls() {
    return fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  return { repo: root, withBehavior, calls };
}

test('isGraphqlRateLimit: true only for a GraphQL-prefixed rate-limit line', () => {
  assert.strictEqual(git.isGraphqlRateLimit('GraphQL: API rate limit exceeded for installation ID 123. (addComment)'), true);
  assert.strictEqual(git.isGraphqlRateLimit('HTTP 403: API rate limit exceeded (rest)'), false, 'a REST rate limit is not a GraphQL one');
  assert.strictEqual(git.isGraphqlRateLimit('GraphQL: Something else went wrong. (addComment)'), false, 'GraphQL failure that is not a rate limit');
  assert.strictEqual(git.isGraphqlRateLimit(''), false);
  assert.strictEqual(git.isGraphqlRateLimit(undefined), false);
});

test('ghIssueComment: GraphQL succeeds → posts once, never touches REST', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('ok', () => git.ghIssueComment(fx.repo, 164, 'hello'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fx.calls().length, 1);
  assert.deepStrictEqual(fx.calls()[0].slice(0, 2), ['issue', 'comment']);
});

test('ghIssueComment: GraphQL rate-limited → falls back to REST and succeeds', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('graphql-rate-limit-then-rest-ok', () => git.ghIssueComment(fx.repo, 164, 'hello'));
  assert.strictEqual(r.ok, true, r.stderr);
  const calls = fx.calls();
  assert.strictEqual(calls.length, 2, 'GraphQL attempt then one REST retry');
  assert.deepStrictEqual(calls[0].slice(0, 2), ['issue', 'comment']);
  assert.strictEqual(calls[1][0], 'api');
  assert.ok(calls[1].some((a) => String(a).includes('/issues/164/comments')), 'hit the REST comments endpoint');
});

test('ghIssueComment: a non-rate-limit GraphQL failure is NOT retried over REST', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('generic-fail', () => git.ghIssueComment(fx.repo, 164, 'hello'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fx.calls().length, 1, 'no REST fallback attempted for an unrelated error');
});

test('ghIssueRelease: GraphQL succeeds → one call, both label+assignee in it', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('ok', () => git.ghIssueRelease(fx.repo, 164));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fx.calls().length, 1);
  assert.deepStrictEqual(fx.calls()[0].slice(0, 2), ['issue', 'edit']);
});

test('ghIssueRelease: GraphQL rate-limited → REST label delete + REST assignee delete both succeed', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('graphql-rate-limit-then-rest-ok', () => git.ghIssueRelease(fx.repo, 164));
  assert.strictEqual(r.ok, true, r.stderr);
  const calls = fx.calls();
  // GraphQL attempt, then `gh api user` to resolve the login, then the two REST deletes.
  assert.deepStrictEqual(calls[0].slice(0, 2), ['issue', 'edit']);
  const apiCalls = calls.slice(1).filter((c) => c[0] === 'api');
  assert.ok(apiCalls.some((c) => c.includes('user')), 'resolved the login via gh api user');
  assert.ok(apiCalls.some((c) => c.some((a) => String(a).includes('/labels/in-progress'))), 'deleted the label over REST');
  assert.ok(apiCalls.some((c) => c.some((a) => String(a).includes('/assignees'))), 'removed the assignee over REST');
});

test('ghIssueRelease: rate-limited on GraphQL AND REST → fails, reporting both sub-writes', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('graphql-rate-limit-both-fail', () => git.ghIssueRelease(fx.repo, 164));
  assert.strictEqual(r.ok, false);
  assert.match(r.stderr, /label removal/);
  assert.match(r.stderr, /assignee removal/);
});

test('ghIssueRelease: a non-rate-limit GraphQL failure is NOT retried over REST', () => {
  const fx = ghFallbackFixture();
  const r = fx.withBehavior('generic-fail', () => git.ghIssueRelease(fx.repo, 164));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fx.calls().length, 1, 'no REST fallback attempted for an unrelated error');
});
