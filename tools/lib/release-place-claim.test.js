'use strict';
/**
 * Regression tests for #305: `colab release` must give back the checkout place-claim its own
 * no-worktree claim took at `colab claim`, and must NOT give back one it does not own.
 *
 * THE BUG. `cmdClaim` acquires a checkout place-claim for any claim without `--worktree`
 * (`takingPlace`), and `cmdRelease` only ever did `delete st.claims[key]` — it never touched
 * `st.places`. So every session following the documented no-worktree pattern (`colab claim N
 * --session …` → `colab release N`) left the hold permanently held after release, until its
 * process died or a human ran `colab place release` with COLAB_HUMAN=1. Measured live: an ops
 * session released #1480 on GitHub cleanly, and 45 minutes later `colab places --json` still
 * showed the checkout held with a live pid, blocking a sibling session's `colab claim 1481`.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Driven against the real CLI, following `release-pending.test.js`'s pattern, because the property
 * under test is end-to-end wiring (`cmdRelease` → `state.mutate` → `place.releaseOwnedBy` → what
 * `colab places` prints) — `place.test.js` unit-tests the primitive in isolation, and the primitive
 * was never the problem here: nothing called it. `COLAB_HOME` is redirected per test, so the
 * developer's real state.json is never read or written.
 *
 * MOST TESTS NEED NO `gh` AT ALL: the fixture repo has no `origin` remote, so `isGhUsable` is
 * false and the claim/release run local-only. The one test that needs a FAILING gh builds a real
 * remote plus the fake-gh-on-PATH harness, exactly as `release-pending.test.js` does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_017PlaceRelease';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: free\n';

/**
 * A real repo with NO remote (so `isGhUsable` is false and no gh is ever invoked) and a private
 * COLAB_HOME. `realpath` matters on macOS, where /tmp is a symlink to /private/tmp: a claim keyed
 * on the literal mkdtemp path would not match what `git.mainRepoRoot` resolves it to.
 */
function fixture({ withOrigin = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-place-release-')));
  TMP.push(root);
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'place release test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), YML);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');

  let origin = null;
  if (withOrigin) {
    origin = path.join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
    g('remote', 'add', 'origin', origin);
    g('push', '-q', 'origin', 'main');
  }
  return { root, work, home, origin, g };
}

// #317: the agent-anchor env vars are neutralised for the same reason #237 neutralised
// COLAB_HUMAN above — a green test must never depend on WHO ran the suite. `place.resolveAnchor`
// adopts CLAUDE_PID as a `'verified'` anchor when it is alive and an ancestor of the invocation,
// and `ownsAnchor` then treats every hold taken under it as the caller's own. Run this file from
// inside an agent session with those vars set and every child `colab` here shares ONE verified
// anchor, so two fixtures pretending to be different sessions become one writer and the
// different-holder refusals below silently stop being exercised — while the same file stays green
// on CI, where the vars are unset. Measured exactly that: 9 tests across 3 files passed on a
// runner and failed on an agent's machine. Tests that WANT the verified-anchor path set CLAUDE_PID
// explicitly through `extraEnv`.
function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      COLAB_HOME: fx.home,
      COLAB_SESSION: '',
      COLAB_SESSION_NAME: '',
      COLAB_HUMAN: '', // never inherited — a green test must not depend on the developer's shell
      CLAUDE_PID: '',
      CLAUDECODE: '',
      AI_AGENT: '',
      ...extraEnv,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const readState = (fx) => JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
const places = (fx) => Object.values(readState(fx).places || {});

// --- The live incident, end to end ----------------------------------------------------------

test('a no-worktree claim releases its checkout place-claim on the LAST release — not before (#305)', () => {
  const fx = fixture();

  // (a) two issues, one session, no worktree: TWO claims, ONE hold.
  assert.strictEqual(colab(fx, ['claim', '901', '902', '--repo', fx.work, '--session', SESSION]).code, 0);
  assert.strictEqual(places(fx).length, 1, 'one hold covers the checkout, not one per issue');
  assert.strictEqual(places(fx)[0].session, SESSION);

  // (b) THE TRAP. Releasing the first must NOT drop the hold — #902 is still held here, and the
  // checkout is still being written to. A fix that passes (c) but fails this is not a fix.
  const first = colab(fx, ['release', '901', '--repo', fx.work]);
  assert.strictEqual(first.code, 0, first.err);
  assert.strictEqual(places(fx).length, 1, 'sibling claim #902 still holds the checkout');
  assert.match(first.out, /place-claim KEPT/);

  // (c) the last release gives it back, with no human flag and no `colab place release`.
  const last = colab(fx, ['release', '902', '--repo', fx.work]);
  assert.strictEqual(last.code, 0, last.err);
  assert.deepStrictEqual(places(fx), [], 'the leak #305 reported is cured');
  assert.match(last.out, /released the checkout place-claim/);
});

test('the freed checkout is immediately re-claimable by a sibling session — the blocked case (#305)', () => {
  // What the leak actually cost: `colab claim 1481` from a second session was refused with
  // "held by session … (pid … is alive)" long after the first session had released #1480.
  const fx = fixture();
  const other = 'https://claude.ai/code/session_017Sibling';
  assert.strictEqual(colab(fx, ['claim', '1480', '--repo', fx.work, '--session', SESSION]).code, 0);
  assert.strictEqual(colab(fx, ['release', '1480', '--repo', fx.work]).code, 0);

  const sibling = colab(fx, ['claim', '1481', '--repo', fx.work, '--session', other]);
  assert.strictEqual(sibling.code, 0, `sibling must not be blocked: ${sibling.err}`);
  assert.strictEqual(places(fx)[0].session, other);
});

// --- The four shapes that must NOT release ---------------------------------------------------

test('a WORKTREE claim releases no place-claim — it never held the checkout (#305)', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '903', '--repo', fx.work, '--worktree', 'wt-903',
    '--session', SESSION]).code, 0);
  assert.deepStrictEqual(places(fx), [], 'a worktree claim takes no checkout hold to begin with');

  // A hold taken separately by somebody else must survive this release untouched.
  assert.strictEqual(colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work,
    '--session', 'https://claude.ai/code/session_017Foreign']).code, 0);
  const r = colab(fx, ['release', '903', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(places(fx).length, 1, 'cmdWorktreeRm owns a worktree claim\'s hold, not this');
  assert.strictEqual(places(fx)[0].session, 'https://claude.ai/code/session_017Foreign');
});

test('a hold owned by a DIFFERENT session survives, is named, and exits 0 (#305)', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '904', '--repo', fx.work, '--session', SESSION]).code, 0);

  // The scenario an ambient --session check would get wrong: this session died, a later one took
  // the checkout as clear ground, and only now is the stale claim swept. The hold is the LATER
  // session's; releasing the old claim must touch nothing.
  const st = readState(fx);
  const key = Object.keys(st.places)[0];
  st.places[key].session = 'https://claude.ai/code/session_017Later';
  st.places[key].sessionName = 'later-session';
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify(st));

  const r = colab(fx, ['release', '904', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(places(fx).length, 1, 'never delete a hold this claim cannot prove is its own');
  assert.strictEqual(places(fx)[0].session, 'https://claude.ai/code/session_017Later');
  assert.match(r.out, /left alone — held by a different session \("later-session"\)/);
});

test('a state with no `places` key at all releases cleanly instead of throwing (#305)', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '905', '--repo', fx.work, '--session', SESSION]).code, 0);
  const st = readState(fx);
  delete st.places; // the shape release-pending.test.js's own fixture writes
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify(st));

  const r = colab(fx, ['release', '905', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /Cannot (read|convert)/);
  assert.doesNotMatch(r.out, /released the checkout place-claim/);
});

test('a claim whose GitHub release FAILS keeps both the claim and the hold (#305, #164)', () => {
  // #164 keeps the claim as `releasePending` so a retry can find it. The hold that makes that
  // claim safe has to be kept in the same breath — dropping it under a claim that still stands
  // is the same local/remote disagreement #164 exists to prevent, arriving from the other side.
  const fx = fixture({ withOrigin: true });
  const ghBin = path.join(fx.root, 'bin');
  fs.mkdirSync(ghBin);
  fs.writeFileSync(path.join(ghBin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
function fail(m) { process.stderr.write(m + '\\n'); process.exit(1); }
function ok(o) { if (o) process.stdout.write(o); process.exit(0); }
if (args[0] === '--version') return ok('gh version 2.0.0 (fake)\\n');
if (args[0] === 'auth' && args[1] === 'status') return ok('Logged in (fake)\\n');
if (args[0] === 'issue' && args[1] === 'view') return fail('GraphQL: API rate limit exceeded for installation ID 123. (issue)');
if (args[0] === 'issue') return fail('GraphQL: API rate limit exceeded for installation ID 123. (updateIssue)');
if (args[0] === 'api' && args.includes('user')) return ok('octofake\\n');
if (args[0] === 'api') return fail('HTTP 403: API rate limit exceeded (rest)');
fail('fake gh: unhandled ' + JSON.stringify(args));
`, { mode: 0o755 });
  const env = { PATH: `${ghBin}:${process.env.PATH}` };

  assert.strictEqual(colab(fx, ['claim', '906', '--repo', fx.work, '--session', SESSION], env).code, 0);
  assert.strictEqual(places(fx).length, 1);

  const r = colab(fx, ['release', '906', '--repo', fx.work], env);
  assert.strictEqual(r.code, 0, r.err);
  const st = readState(fx);
  const claim = Object.values(st.claims).find((c) => String(c.issue).includes('906'));
  assert.ok(claim && claim.releasePending, 'the claim survives as releasePending (#164)');
  assert.strictEqual(Object.keys(st.places || {}).length, 1, 'so the hold survives with it');
});

// --- #306's wrong-shape session does not break #305's fix ------------------------------------

// --- #312: the OTHER claim-deletion sites, and #317's read-time lapse ---------------------------
//
// `cmdRelease` was the site somebody noticed in production; `grep -n "delete st.claims" tools/colab`
// found seven. Three of them dropped a claim and kept the checkout hold — the same end state,
// reached by a different command.

/** Rewrite every claim's `created` so doctor's age predicate (default ttl 24h) fires. */
function backdateClaims(fx, hours) {
  const p = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const when = new Date(Date.now() - hours * 3_600_000).toISOString();
  for (const c of Object.values(st.claims)) c.created = when;
  fs.writeFileSync(p, JSON.stringify(st, null, 2));
}

test('#312: `doctor --prune` reaping a stale worktree-less claim frees the checkout hold it took', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '911', '--repo', fx.work, '--session', SESSION]).code, 0);
  assert.strictEqual(places(fx).length, 1);
  backdateClaims(fx, 48);

  // The holder is ALIVE here (the hold anchors on this test's own shell), which is exactly why
  // doctor's own stale-PLACE prune (pass 1b, keyed on holder liveness) cannot cover this: it runs
  // earlier in the same mutate and correctly leaves a live-anchor hold alone. #312's guess that
  // 1b "may already cover it" is wrong, and this is the measurement.
  const doc = colab(fx, ['doctor', '--prune']);
  assert.strictEqual(doc.code, 0, doc.err);
  assert.match(doc.out, /Released 1 checkout place-claim\(s\) whose claim was pruned/);
  assert.deepStrictEqual(places(fx), [], 'the hold must not outlive the claim doctor just reaped');
});

test('#312: `doctor --prune` keeps the hold while a SIBLING no-worktree claim of that session remains', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '921', '--repo', fx.work, '--session', SESSION]).code, 0);
  assert.strictEqual(colab(fx, ['claim', '922', '--repo', fx.work, '--session', SESSION]).code, 0);
  // Age out only ONE of the two claims.
  const p = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const key = Object.keys(st.claims).find((k) => k.endsWith('#921'));
  st.claims[key].created = new Date(Date.now() - 48 * 3_600_000).toISOString();
  fs.writeFileSync(p, JSON.stringify(st, null, 2));

  const doc = colab(fx, ['doctor', '--prune']);
  assert.strictEqual(doc.code, 0, doc.err);
  assert.strictEqual(places(fx).length, 1, '#922 is still claimed here and still writing to this checkout');
  assert.doesNotMatch(doc.out, /Released 1 checkout place-claim/);
});

test('#312: `doctor --prune` never touches a hold belonging to a DIFFERENT session', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '931', '--repo', fx.work, '--session', SESSION]).code, 0);
  // Retarget the hold at a session this claim does not name — a LATER session re-took the checkout
  // and this is a stale claim being swept. Ownership is proved from the claim record, so it must
  // touch nothing.
  const p = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const pk = Object.keys(st.places)[0];
  st.places[pk].session = 'a-later-session';
  fs.writeFileSync(p, JSON.stringify(st, null, 2));
  backdateClaims(fx, 48);

  const doc = colab(fx, ['doctor', '--prune']);
  assert.strictEqual(doc.code, 0, doc.err);
  assert.strictEqual(places(fx).length, 1, "a later session's hold is not this claim's to give back");
  assert.strictEqual(places(fx)[0].session, 'a-later-session');
});

test('#317: releasing a claim whose hold has a DEAD anchor leaves no record, whatever session it names', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '941', '--repo', fx.work, '--session', SESSION]).code, 0);
  // A corpse held by somebody else entirely: read-time lapse clears it before ownership is asked.
  const p = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const pk = Object.keys(st.places)[0];
  st.places[pk].session = 'someone-long-gone';
  st.places[pk].pid = 999999999;
  st.places[pk].pidKind = 'anchor';
  fs.writeFileSync(p, JSON.stringify(st, null, 2));

  const rel = colab(fx, ['release', '941', '--repo', fx.work]);
  assert.strictEqual(rel.code, 0, rel.err);
  assert.deepStrictEqual(places(fx), [], 'a dead anchor lapses at read time (#317), it does not wait for doctor');
});

test('#317: an UNPROVABLE hold is NOT lapsed by a release — #288 still fails closed', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '951', '--repo', fx.work, '--session', SESSION]).code, 0);
  const p = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  const pk = Object.keys(st.places)[0];
  st.places[pk].session = 'someone-unprovable';
  st.places[pk].pidKind = 'invocation'; // never probed — liveness null, not false
  fs.writeFileSync(p, JSON.stringify(st, null, 2));

  const rel = colab(fx, ['release', '951', '--repo', fx.work]);
  assert.strictEqual(rel.code, 0, rel.err);
  assert.strictEqual(places(fx).length, 1, 'unprovable is not dead — it stays until a human says otherwise');
});

test('#312: `claims --sync --prune` reaping a claim GitHub no longer shows frees its checkout hold', () => {
  // The prune path has only the STORED claim record to work from — no ambient identity, and none
  // should be reached for. A no-worktree claim pruned here used to leave its hold behind with
  // nothing on disk pointing at it: unreachable even by `colab release`, which needs the claim it
  // had just deleted.
  const fx = fixture({ withOrigin: true });
  const ghBin = path.join(fx.root, 'bin');
  fs.mkdirSync(ghBin);
  fs.writeFileSync(path.join(ghBin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
function ok(o) { if (o) process.stdout.write(o); process.exit(0); }
if (args[0] === '--version') return ok('gh version 2.0.0 (fake)\\n');
if (args[0] === 'auth' && args[1] === 'status') return ok('Logged in (fake)\\n');
if (args[0] === 'api' && args.includes('user')) return ok('octofake\\n');
// the claim write succeeds, the tie-break read sees no competing claim …
if (args[0] === 'issue' && args[1] === 'view') return ok(JSON.stringify({ comments: [] }));
// … and the reconcile read says GitHub shows nothing assigned+in-progress any more.
if (args[0] === 'issue' && args[1] === 'list') return ok('[]');
return ok('');
`, { mode: 0o755 });
  const env = { PATH: `${ghBin}:${process.env.PATH}` };

  assert.strictEqual(colab(fx, ['claim', '961', '--repo', fx.work, '--session', SESSION], env).code, 0);
  assert.strictEqual(places(fx).length, 1);

  const sync = colab(fx, ['claims', '--sync', '--prune'], { ...env, PWD: fx.work });
  assert.strictEqual(sync.code, 0, sync.err);
  assert.match(sync.out, /freed its checkout hold/, sync.out);
  assert.deepStrictEqual(places(fx), [], 'the hold must not outlive the claim the reconcile pruned');
});

test('a claim minted with a wrong-SHAPE session still releases its own hold (#305 x #306)', () => {
  // cmdClaim writes ONE `session` value into both the claim and the place record, so a wrong
  // value is wrong in both — and matches itself. This is why #305 is immune to #306, and why the
  // holds already stranded on disk by the live incident are cured too. Note `cmdRelease` takes no
  // --session flag at all: ownership is proved from the claim record, never from the ambient shell.
  const fx = fixture();
  const claimed = colab(fx, ['claim', '907', '--repo', fx.work, '--session', 'ops-coding-dashboard-1480']);
  assert.strictEqual(claimed.code, 0, claimed.err);
  assert.match(claimed.err, /does not look like a session URL/, 'warned at write time (#306)');
  assert.strictEqual(places(fx).length, 1);

  const r = colab(fx, ['release', '907', '--repo', fx.work], { COLAB_SESSION: SESSION });
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(places(fx), [], 'wrong matches wrong — the hold is still given back');
});
