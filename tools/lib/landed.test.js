'use strict';
/**
 * Tests for the "has this branch landed?" rule (tools/lib/landed.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The corpus is FIXED and SYNTHETIC: every case builds a throwaway repository in a temp dir with
 * real git, so the rule is measured against git's actual behaviour rather than against a mock that
 * agrees with whatever we believed when we wrote it. Eyeballing live worktrees is how the wrong
 * rule survived — the repo this ships in had seven shipped branches all reporting 2–4 commits ahead
 * of the base that already contained them.
 *
 * Each git-backed case asserts TWO things: the verdict, and the raw signals — so a case that exists
 * to prove the naive rule fails will itself fail if it ever stops being that case (e.g. a squash
 * fixture that quietly turns into a fast-forward proves nothing about squashes).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { classify, landedState, hasCargo, resolveBranchRef, CONTAINED, DIVERGED, UNKNOWN } = require('./landed.js');

// --- fixture builder --------------------------------------------------------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landed-test-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Identity and hooks are set locally: the machine's global config must not decide whether a test
  // can commit, and a global `core.hooksPath` (this handbook installs one) would run the repo's
  // pre-commit guard inside a fixture that is not a real project.
  g('init', '-q', '-b', 'dev', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'landed test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'commit.gpgsign', 'false');
  const write = (f, s) => { fs.writeFileSync(path.join(dir, f), s); };
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); };
  write('README', 'base\n');
  commit('chore: base');
  return { dir, g, write, commit };
}

/** Like `repo()`, but with a real bare `origin` the work tree can push branches to (#189). */
function repoWithOrigin() {
  const r = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'landed-origin-'));
  TMP.push(bare);
  execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
  r.g('remote', 'add', 'origin', bare);
  r.g('push', '-q', 'origin', 'dev');
  return r;
}

// --- the case the naive commit-count rule gets wrong ------------------------

test('squash-merged branch reads as landed, though its commits are still "ahead"', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/thing-1');
  r.write('thing.txt', 'one\n'); r.commit('feat: thing');
  r.write('thing.txt', 'one\ntwo\n'); r.commit('fix: more thing');
  r.g('checkout', '-q', 'dev');
  r.g('merge', '--squash', 'feat/thing-1');
  r.commit('feat: thing (#1)');

  const v = landedState(r.dir, 'dev', 'feat/thing-1');
  assert.strictEqual(v.state, 'landed');
  // The fixture must really be the trap: commits ahead, so a count-only rule says "unshipped".
  assert.ok(v.commitsAhead > 0, 'fixture invalid: squash left no commits ahead');
  assert.strictEqual(v.containment, CONTAINED);
  assert.strictEqual(hasCargo(v), false);
});

test('THE HOLE: squash-merged AND the base advanced afterwards is still landed', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/thing-2');
  r.write('thing.txt', 'one\n'); r.commit('feat: thing');
  r.write('thing.txt', 'one\ntwo\n'); r.commit('fix: more thing');
  r.g('checkout', '-q', 'dev');
  r.g('merge', '--squash', 'feat/thing-2');
  r.commit('feat: thing (#2)');
  r.write('unrelated.txt', 'later work\n'); r.commit('feat: something else');

  const v = landedState(r.dir, 'dev', 'feat/thing-2');
  // Both naive signals fire — this is exactly the state the two-signal rule cannot resolve.
  assert.ok(v.commitsAhead > 0 && v.diffEmpty === false, 'fixture invalid: the hole is not reproduced');
  assert.deepStrictEqual(classify({ commitsAhead: v.commitsAhead, diffEmpty: v.diffEmpty, containment: UNKNOWN }).state,
    'unknown', 'the two-signal rule is supposed to be stuck here');
  // The content test resolves it.
  assert.strictEqual(v.state, 'landed');
  assert.strictEqual(v.method, 'content');
});

// --- the mirror case --------------------------------------------------------

test('zero commits ahead but a non-empty diff (the base moved on) is landed', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'chore/idle-3');
  r.g('checkout', '-q', 'dev');
  r.write('later.txt', 'trunk moved\n'); r.commit('feat: later work');

  const v = landedState(r.dir, 'dev', 'chore/idle-3');
  assert.strictEqual(v.commitsAhead, 0);
  assert.strictEqual(v.diffEmpty, false, 'fixture invalid: the branch should differ from the moved base');
  assert.strictEqual(v.state, 'landed');
});

// --- genuine cargo ----------------------------------------------------------

test('unmerged work is cargo', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/unmerged-4');
  r.write('new.txt', 'not shipped\n'); r.commit('feat: unmerged');

  const v = landedState(r.dir, 'dev', 'feat/unmerged-4');
  assert.strictEqual(v.state, 'cargo');
  assert.strictEqual(v.containment, DIVERGED);
  assert.strictEqual(hasCargo(v), true);
});

test('a branch with no commits at all has nothing to ship', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'chore/empty-5');
  const v = landedState(r.dir, 'dev', 'chore/empty-5');
  assert.strictEqual(v.state, 'landed');
  assert.strictEqual(v.commitsAhead, 0);
});

test('a fast-forward merge is landed too (the easy case must not regress)', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feat/ff-6');
  r.write('ff.txt', 'x\n'); r.commit('feat: ff');
  r.g('checkout', '-q', 'dev');
  r.g('merge', '--ff-only', 'feat/ff-6');
  assert.strictEqual(landedState(r.dir, 'dev', 'feat/ff-6').state, 'landed');
});

// --- the base is not necessarily trunk (project.yml `integration:`) ---------

test('the verdict is relative to the BASE: landed on its line, cargo against trunk', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'v2');            // a declared integration line
  r.write('v2.txt', 'line work\n'); r.commit('feat: line groundwork');
  r.g('checkout', '-q', '-b', 'feat/on-line-7');
  r.write('feature.txt', 'on the line\n'); r.commit('feat: on the line');
  r.g('checkout', '-q', 'v2');
  r.g('merge', '--squash', 'feat/on-line-7');
  r.commit('feat: on the line (#7)');

  assert.strictEqual(landedState(r.dir, 'v2', 'feat/on-line-7').state, 'landed');
  // Against trunk the same branch is full of cargo — which is why asking the wrong base is not a
  // cosmetic error: it would invite shipping the whole line into trunk as one squash commit.
  assert.strictEqual(landedState(r.dir, 'dev', 'feat/on-line-7').state, 'cargo');
});

// --- the documented limit ---------------------------------------------------

test('work the base REWROTE is unknown, never landed', () => {
  const r = repo();
  r.write('shared.txt', 'original\n'); r.commit('chore: seed');
  r.g('checkout', '-q', '-b', 'feat/rewritten-8');
  r.write('shared.txt', 'branch version\n'); r.commit('feat: branch edit');
  r.g('checkout', '-q', 'dev');
  r.write('shared.txt', 'trunk rewrote this differently\n'); r.commit('feat: trunk edit');

  const v = landedState(r.dir, 'dev', 'feat/rewritten-8');
  assert.strictEqual(v.containment, UNKNOWN, 'fixture invalid: the merge was expected to conflict');
  assert.strictEqual(v.state, 'unknown');
  // The asymmetry that matters: unknown must never let a caller tear the branch down.
  assert.strictEqual(hasCargo(v), true);
});

test('a missing ref is unknown, not landed', () => {
  const r = repo();
  const v = landedState(r.dir, 'dev', 'feat/never-existed-9');
  assert.strictEqual(v.state, 'unknown');
  assert.strictEqual(hasCargo(v), true);
});

// --- #189: a bare branch name resolves against origin when only the remote has it ------------
//
// Measured cost: `colab landed --branch <name>` reported `ref not found` for every branch a sweep
// of stale REMOTE branches turned up, because the bare form — the one every other surface in this
// toolchain hands over — was never checked against `origin/<name>`. The same branch answered fine
// as `origin/<name>`. These four cases are the narrowed scope from the issue: local-ref-present is
// unchanged, remote-only now resolves (and says so), a genuine absence stays honestly unanswered,
// and an already-`origin/`-qualified name is never re-guessed.

test('#189: bare name with a local ref resolves locally — unchanged, no fallback reported', () => {
  const r = repoWithOrigin();
  r.g('checkout', '-q', '-b', 'feat/both-10');
  r.write('both.txt', 'x\n'); r.commit('feat: both');
  r.g('push', '-q', 'origin', 'feat/both-10');
  r.g('checkout', '-q', 'dev');

  const v = landedState(r.dir, 'dev', 'feat/both-10');
  assert.strictEqual(v.branch, 'feat/both-10', 'a local ref must win — never silently switched to origin/...');
  assert.strictEqual(v.state, 'cargo');
  assert.ok(!/resolved/.test(v.why), 'why must not claim a resolution that never happened');
});

test('#189: bare name with only a remote ref now answers, and names the ref that answered', () => {
  const r = repoWithOrigin();
  r.g('checkout', '-q', '-b', 'feat/remote-only-11');
  r.write('remote.txt', 'x\n'); r.commit('feat: remote only');
  r.g('push', '-q', 'origin', 'feat/remote-only-11');
  r.g('checkout', '-q', 'dev');
  r.g('branch', '-D', 'feat/remote-only-11'); // simulate "pushed elsewhere, never fetched/kept here"

  const v = landedState(r.dir, 'dev', 'feat/remote-only-11');
  assert.strictEqual(v.branch, 'origin/feat/remote-only-11',
    'facts.branch must be the ref that actually answered, not the bare name asked for');
  assert.match(v.why, /resolved "feat\/remote-only-11" → "origin\/feat\/remote-only-11"/,
    'the why must say the answer came from the remote ref');
  assert.strictEqual(v.state, 'cargo');
  assert.strictEqual(v.containment, DIVERGED);
});

test('#189: a genuinely missing ref keeps its honest not-found answer, even with origin configured', () => {
  const r = repoWithOrigin();
  const v = landedState(r.dir, 'dev', 'feat/never-existed-12');
  assert.strictEqual(v.state, 'unknown');
  assert.strictEqual(v.method, 'none');
  assert.match(v.why, /ref not found: feat\/never-existed-12/);
  assert.strictEqual(v.branch, 'feat/never-existed-12', 'no fallback fired — the name must stay as given');
  assert.strictEqual(hasCargo(v), true);
});

test('#189: an explicit origin/ prefix is used as-is — no further guessing', () => {
  const r = repoWithOrigin();
  r.g('checkout', '-q', '-b', 'feat/explicit-13');
  r.write('explicit.txt', 'x\n'); r.commit('feat: explicit');
  r.g('push', '-q', 'origin', 'feat/explicit-13');
  r.g('checkout', '-q', 'dev');

  const v = landedState(r.dir, 'dev', 'origin/feat/explicit-13');
  assert.strictEqual(v.branch, 'origin/feat/explicit-13', 'already remote-qualified — must not be rewritten');
  assert.ok(!/resolved/.test(v.why), 'no fallback should be reported for a name that already names a remote');
  assert.strictEqual(v.state, 'cargo');
});

test('#189: resolveBranchRef — the pure resolution rule directly', () => {
  const r = repoWithOrigin();
  r.g('checkout', '-q', '-b', 'feat/pure-14');
  r.write('pure.txt', 'x\n'); r.commit('feat: pure');
  r.g('push', '-q', 'origin', 'feat/pure-14');
  r.g('checkout', '-q', 'dev');
  r.g('branch', '-D', 'feat/pure-14');

  assert.deepStrictEqual(resolveBranchRef(r.dir, 'feat/pure-14'),
    { ok: true, ref: 'origin/feat/pure-14', viaRemote: true });
  assert.deepStrictEqual(resolveBranchRef(r.dir, 'dev'),
    { ok: true, ref: 'dev', viaRemote: false });
  assert.deepStrictEqual(resolveBranchRef(r.dir, 'nothing-here'),
    { ok: false, ref: 'nothing-here', viaRemote: false });
  assert.deepStrictEqual(resolveBranchRef(r.dir, 'origin/nothing-here'),
    { ok: false, ref: 'origin/nothing-here', viaRemote: false });
});

// --- the pure rule ----------------------------------------------------------

test('classify: content containment wins over both naive signals', () => {
  assert.strictEqual(classify({ commitsAhead: 9, diffEmpty: false, containment: CONTAINED }).state, 'landed');
  assert.strictEqual(classify({ commitsAhead: 0, diffEmpty: true, containment: DIVERGED }).state, 'cargo');
});

test('classify: the two-signal fallback needs BOTH signals to call it cargo', () => {
  const two = (commitsAhead, diffEmpty) => classify({ commitsAhead, diffEmpty, containment: UNKNOWN }).state;
  assert.strictEqual(two(0, true), 'landed');   // nothing there
  assert.strictEqual(two(3, true), 'landed');   // squash-merged, base unmoved
  assert.strictEqual(two(0, false), 'landed');  // base moved on under an idle branch
  assert.strictEqual(two(3, false), 'unknown'); // ambiguous — NOT reported as cargo-free
});

test('classify: the fallback is labelled, so callers can see which hole is open', () => {
  assert.strictEqual(classify({ commitsAhead: 3, diffEmpty: true, containment: UNKNOWN }).method, 'two-signal');
  assert.strictEqual(classify({ commitsAhead: 3, diffEmpty: true, containment: CONTAINED }).method, 'content');
});

test('classify: absent or malformed facts are unknown, never landed', () => {
  // The pure half is exported so a vendoring repo can feed it facts it gathered itself. A fact
  // that failed to compute arrives as undefined/null, and `undefined > 0` is false — so without a
  // guard, "I could not measure this" would read as a confident "landed" and invite a teardown.
  const bad = [
    {},
    { commitsAhead: undefined, diffEmpty: undefined, containment: UNKNOWN },
    { commitsAhead: null, diffEmpty: null, containment: UNKNOWN },
    { commitsAhead: 3, diffEmpty: undefined, containment: UNKNOWN },
    { commitsAhead: undefined, diffEmpty: true, containment: UNKNOWN },
    { commitsAhead: '3', diffEmpty: true, containment: UNKNOWN },   // string, not number
    { commitsAhead: -1, diffEmpty: true, containment: UNKNOWN },
    { commitsAhead: 1.5, diffEmpty: true, containment: UNKNOWN },
    { commitsAhead: 3, diffEmpty: 'false', containment: UNKNOWN },  // string, not boolean
  ];
  for (const facts of bad) {
    const v = classify(facts);
    assert.strictEqual(v.state, 'unknown', `expected unknown for ${JSON.stringify(facts)}`);
    assert.ok(hasCargo(v), 'an unmeasurable branch must keep its cargo');
  }
});

test('classify: a content answer still wins even when the two-signal facts are absent', () => {
  // containment is authoritative — merge-tree answered, so the missing fallback facts are moot.
  assert.strictEqual(classify({ containment: CONTAINED }).state, 'landed');
  assert.strictEqual(classify({ containment: DIVERGED }).state, 'cargo');
});
