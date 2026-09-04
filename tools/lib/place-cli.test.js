'use strict';
/**
 * CLI-level tests for the two ship-grade REJECTs on #133/#136 (see the "Ship grade — REJECTED"
 * comment on #133): the plan's own oracle asked for "`--force` without `COLAB_HUMAN=1` refuses"
 * across every entry path that can take over a live place-claim, and for the documented
 * "degraded mode" (an unreadable state.json) to actually degrade instead of throwing a raw stack
 * trace. `tools/lib/place.test.js` unit-tests the primitive in isolation; this file drives the
 * real `colab` CLI (`cmdClaim`, `cmdSolo`, `cmdPlace`) against a real repo, because both defects
 * were WIRING bugs — the primitive itself was always correct, the CLI just didn't call its
 * COLAB_HUMAN gate on one of its two entry paths, and never caught `state.loadState()`'s throw.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `COLAB_HOME` is redirected per test, so the developer's real state.json is never read or written.
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

const SERIAL_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: serial\n';

/** A repo with a real bare `origin`, `writes: serial`, and a private COLAB_HOME. */
function fixture(projectYml = SERIAL_YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'place cli test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  return { root, origin, work, home, g };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    // #237: COLAB_HUMAN defaults to '' here (neutralised), never inherited from the ambient
    // shell — a developer with COLAB_HUMAN=1 exported would otherwise get green `solo` tests
    // that prove nothing, since eligibility now depends on it. Tests that need it pass it
    // explicitly via extraEnv, same as every other override on this line.
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', COLAB_HUMAN: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// --- Reject 1: --force stealing a live place-claim requires COLAB_HUMAN=1, on BOTH entry paths --

test('cmdPlace acquire --force on a live OTHER holder refuses without COLAB_HUMAN=1', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'sess-OTHER', '--session-name', 'other']);
  assert.strictEqual(acq.code, 0, acq.err);

  const stolen = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--force', '--session', 'sess-AGENT']);
  assert.notStrictEqual(stolen.code, 0, 'must refuse, not steal');
  assert.match(stolen.err, /COLAB_HUMAN=1/);

  // the hold must still belong to the original session — nothing was overwritten by the refused attempt
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, 'sess-OTHER');
});

test('cmdPlace acquire --force + COLAB_HUMAN=1 DOES take over a live OTHER holder', () => {
  const fx = fixture();
  colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'sess-OTHER', '--session-name', 'other']);
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--force', '--session', 'sess-AGENT'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, 'sess-AGENT');
});

test('cmdClaim --force on a writes:serial repo with a live OTHER place-claim refuses without COLAB_HUMAN=1 (the demonstrated ship-grade defect)', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'sess-OTHER', '--session-name', 'other']);
  assert.strictEqual(acq.code, 0, acq.err);

  const stolen = colab(fx, ['claim', '5', '--repo', fx.work, '--force', '--session', 'sess-AGENT']);
  assert.notStrictEqual(stolen.code, 0, 'must refuse, not silently steal the place-claim');
  assert.match(stolen.err, /COLAB_HUMAN=1/);

  // the place record must be untouched — this is the exact defect: exit 0, silent overwrite, no warning
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, 'sess-OTHER', 'a live place-claim must never be silently overwritten');
});

test('cmdClaim --force + COLAB_HUMAN=1 on a writes:serial repo DOES take over the place-claim, and the claim still lands', () => {
  const fx = fixture();
  colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'sess-OTHER', '--session-name', 'other']);
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--force', '--session', 'sess-AGENT'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, 'sess-AGENT');
  // Key on the realpath, not the literal fixture path: macOS resolves /tmp to /private/tmp, and
  // `colab` records the realpath (same reason `place.placeKey` uses `fs.realpathSync`).
  const claimKeyed = Object.values(st.claims).find((c) => c.issue === '#5');
  assert.ok(claimKeyed, 'the claim itself must still be recorded');
});

test('cmdClaim on a writes:isolated repo (the EXPLICIT veto) is UNAFFECTED by place-claim logic — no COLAB_HUMAN gate applies', () => {
  const fx = fixture('tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: isolated\n');
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--force', '--session', 'sess-AGENT']);
  assert.strictEqual(r.code, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.places, {}, 'a veto (writes: isolated) repo never takes a trunk-checkout place-claim');
});

test('#237: cmdClaim on a repo with NO writes: key (coexistence default) NOW takes the trunk-checkout place-claim — the widening ruling #1 requires', () => {
  // Before #237, absence resolved through resolveWrites to "isolated" and took no place-claim.
  // Coexistence is now the default: a claim with no --worktree IS the shared-trunk-checkout
  // shape, and under coexistence that shape is legal (and therefore hold-worthy) everywhere
  // except a repo that explicitly declares the veto.
  const fx = fixture('tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n'); // writes omitted entirely
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--session', 'sess-AGENT']);
  assert.strictEqual(r.code, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.strictEqual(Object.keys(st.places).length, 1, 'absence now takes the trunk-checkout place-claim, same as writes: serial-*');
});

// --- Reject 2: the degrade path — unreadable state.json must not throw a raw stack trace --------

function corruptState(fx) {
  fs.writeFileSync(path.join(fx.home, 'state.json'), '{ this is not valid json ');
}

test('cmdPlace acquire against an unreadable state.json degrades (exit 2, no stack trace) instead of crashing', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /degrading/);
  assert.match(r.out, /worktree \+ branch/);
  assert.doesNotMatch(r.err, /at Object\.loadState/, 'must not leak a raw stack trace');
});

test('cmdPlace check against an unreadable state.json degrades (exit 2)', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['place', 'check', fx.work, '--repo', fx.work]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /degrading/);
});

test('cmdPlace release against an unreadable state.json degrades (exit 2)', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['place', 'release', fx.work, '--repo', fx.work]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /degrading/);
});

test('cmdSolo against an unreadable state.json on a writes:serial repo degrades (refuses, no stack trace) instead of crashing', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['solo', '--repo', fx.work, '--session', 's'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /degrading/);
  assert.doesNotMatch(r.err, /at Object\.loadState/, 'must not leak a raw stack trace');
});

test('cmdSolo with no COLAB_HUMAN=1 refuses on attendance BEFORE ever reading state.json — an unreadable state.json never even gets reached', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['solo', '--repo', fx.work, '--session', 's']); // no COLAB_HUMAN
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /COLAB_HUMAN=1/);
  assert.doesNotMatch(r.out, /degrading/, 'attendance is checked first — it never reaches the state read');
});

test('cmdClaim taking the trunk-checkout place-claim against an unreadable state.json degrades instead of crashing', () => {
  const fx = fixture();
  corruptState(fx);
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--session', 's']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /degrading/);
  assert.doesNotMatch(r.err, /at Object\.loadState/, 'must not leak a raw stack trace');
});

// --- syncedStateProblem guarding every place-claim write site (ship-grade remainder) -------------

test('cmdSolo refuses to open when COLAB_HOME sits under a synced marker, same as cmdPlace acquire', () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.home, '.sync'));
  const r = colab(fx, ['solo', '--repo', fx.work, '--session', 's'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /file-synced/);
});

test('cmdWorktreeNew refuses to create a worktree when COLAB_HOME sits under a synced marker, BEFORE creating anything on disk', () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.home, '.sync'));
  const before = fs.readdirSync(fx.work);
  const r = colab(fx, ['worktree', 'new', 'feat/thing-9', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /file-synced/);
  assert.deepStrictEqual(fs.readdirSync(fx.work), before, 'must refuse BEFORE step 1 creates a worktree directory or branch');
});

// --- #235: place acquire with NO resolvable identity — warns, still proceeds, always resolves ---

test('cmdPlace acquire with neither --session nor --session-name still succeeds, but warns "no --session or --session-name given"', () => {
  const fx = fixture();
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]); // colab() defaults both env vars to ''
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.err, /no --session or --session-name given/);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, null);
  assert.strictEqual(rec.sessionName, null);
  assert.ok(rec.pid, 'the write site must still record process.ppid — the only thing that later resolves this holder');
});

test('cmdPlace acquire with a --session-name but no --session still gets the half-identity warning, unchanged, not the no-identity one', () => {
  const fx = fixture();
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session-name', 'my-label']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.err, /recorded with NO session URL/);
  assert.doesNotMatch(r.err, /no --session or --session-name given/);
});

test('cmdPlace acquire with both --session and --session-name warns about neither case', () => {
  const fx = fixture();
  // #306: the --session value here was `'s'`, which the new shape warning correctly flags. This is
  // a FIXTURE correction, not a loosened gate: the test's subject is "warns about neither identity
  // case", and it was never a promise that a one-character session id is warning-free. The
  // empty-stderr assertion below is deliberately kept exactly as it was — it now also proves the
  // shape warning does NOT over-fire on a well-formed session URL.
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work,
    '--session', 'https://claude.ai/code/session_017PlaceCliBoth', '--session-name', 'n']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.err, '');
});

// --- #306: a non-blank but wrong-SHAPE --session warns at write time, and the later refusal says so

test('a --session that is plainly a session NAME warns at claim time, but is still accepted (#306)', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '901', '--repo', fx.work, '--session', 'ops-coding-dashboard-1480']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.err, /does not look like a session URL/);
  assert.match(r.err, /--session-name/);
  // Warned, never refused — `requirePlaceIdentity` promises `<url-or-any-stable-id>`.
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.strictEqual(Object.values(st.places)[0].session, 'ops-coding-dashboard-1480');
});

test('a well-formed session URL draws NO shape warning — the check does not over-fire (#306)', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '902', '--repo', fx.work,
    '--session', 'https://claude.ai/code/session_017GKdaNPELs2mtKPDCasha1']);
  assert.strictEqual(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /does not look like a session URL/);
});

test('place release refused on a session mismatch NAMES both values and the recovery command (#306)', () => {
  const fx = fixture();
  const bad = 'ops-coding-dashboard-1480';
  const real = 'https://claude.ai/code/session_017Real';
  assert.strictEqual(colab(fx, ['claim', '903', '--repo', fx.work, '--session', bad]).code, 0);

  // The live incident: releasing with the objectively-correct URL is refused, because the wrong
  // value landed at claim time. The GATE is unchanged; what it now does is explain itself.
  const r = colab(fx, ['place', 'release', fx.work, '--repo', fx.work, '--session', real]);
  assert.notStrictEqual(r.code, 0, 'must still refuse — the gate is not relaxed');
  assert.match(r.err, /COLAB_HUMAN=1/);
  assert.match(r.err, /recorded session: ops-coding-dashboard-1480/);
  assert.match(r.err, new RegExp(`you presented: *${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(r.err, /colab place release .* --session 'ops-coding-dashboard-1480'/);

  // …and the command it printed actually works, with no human flag — the workaround the issue
  // author proved by hand, now the thing the refusal hands you.
  const ok = colab(fx, ['place', 'release', fx.work, '--repo', fx.work, '--session', bad]);
  assert.strictEqual(ok.code, 0, ok.err);
});

test('colab places never renders a live, identity-less hold as a bare "-" — it shows the pid fallback (#235)', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]);
  assert.strictEqual(acq.code, 0, acq.err);
  const list = colab(fx, ['places']);
  assert.strictEqual(list.code, 0, list.err);
  assert.match(list.out, /pid \d+ on/);
  assert.doesNotMatch(list.out, /\]\s+-\s+since/, 'must never fall back to the bare dash a name/URL-less record used to render as');
});

test('colab places --json still carries the raw (possibly null) session/sessionName/pid fields — no fabrication in the data itself', () => {
  const fx = fixture();
  colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]);
  const list = colab(fx, ['places', '--json']);
  assert.strictEqual(list.code, 0, list.err);
  const rows = JSON.parse(list.out);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].session, null);
  assert.strictEqual(rows[0].sessionName, null);
  assert.ok(rows[0].pid, 'JSON output should carry pid too, the field the text rendering now falls back to');
});

// --- #238: places and refusals report hold age, so a forgotten hold no longer looks fresh -------

/** Rewrite the single place record's `since` in state.json, simulating a hold taken days ago. */
function backdatePlace(fx, isoSince) {
  const statePath = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const key = Object.keys(st.places)[0];
  st.places[key].since = isoSince;
  fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
}

test('colab places reports age alongside liveness, not just a raw "since" timestamp', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]);
  assert.strictEqual(acq.code, 0, acq.err);
  backdatePlace(fx, new Date(Date.now() - 4 * 24 * 3_600_000).toISOString());

  const list = colab(fx, ['places']);
  assert.strictEqual(list.code, 0, list.err);
  assert.match(list.out, /held 4d ago/);

  const listJson = colab(fx, ['places', '--json']);
  const rows = JSON.parse(listJson.out);
  assert.strictEqual(rows[0].age, '4d ago');
});

test('cmdPlace release refuses on someone else\'s hold and names its age, not just its holder', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'sess-OTHER', '--session-name', 'other']);
  assert.strictEqual(acq.code, 0, acq.err);
  backdatePlace(fx, new Date(Date.now() - 4 * 24 * 3_600_000).toISOString());

  const rel = colab(fx, ['place', 'release', fx.work, '--repo', fx.work, '--session', 'sess-MINE']);
  assert.notStrictEqual(rel.code, 0);
  assert.match(rel.err, /held 4d ago/);
});

test('cmdSolo "already OPEN" refusal names the lock\'s age, not just "since <iso>"', () => {
  const fx = fixture();
  const first = colab(fx, ['solo', '--repo', fx.work, '--session', 's1', '--session-name', 'first'], { COLAB_HUMAN: '1' });
  assert.strictEqual(first.code, 0, first.err);

  // backdate the SOLO lock itself (a separate record, st.solo[repo] — not a place-claim). Keyed
  // by colab's resolved repo root (git's git-common-dir, e.g. macOS /private/var/... for a /var/...
  // tmp path), not necessarily the raw fixture path — read the key back rather than assume it.
  const statePath = path.join(fx.home, 'state.json');
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const repoKey = Object.keys(st.solo)[0];
  st.solo[repoKey].since = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();
  fs.writeFileSync(statePath, JSON.stringify(st, null, 2));

  const second = colab(fx, ['solo', '--repo', fx.work, '--session', 's2', '--session-name', 'second'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(second.code, 0);
  assert.match(second.out, /already OPEN/);
  assert.match(second.out, /held 4d ago/);
});

// --- #237: `--done` dispatches BEFORE the eligibility check, so it is NEVER gated on
// COLAB_HUMAN — releasing a hold authorizes nothing. Opened attended, closed unattended. ------

test('cmdSolo --done succeeds with NO COLAB_HUMAN=1 set, even though opening required it', () => {
  const fx = fixture();
  const opened = colab(fx, ['solo', '--repo', fx.work, '--session', 's1'], { COLAB_HUMAN: '1' });
  assert.strictEqual(opened.code, 0, opened.err);

  const done = colab(fx, ['solo', '--done', '--repo', fx.work]); // no COLAB_HUMAN
  assert.strictEqual(done.code, 0, done.err);

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.solo, {}, 'the lock must be released');
  assert.deepStrictEqual(st.places, {}, 'the place-claim it took must be released too');
});

// --- #242: a shared-checkout hold (claim with no worktree, solo) requires a non-blank
// session, mandatorily — a blank one can never be told apart from itself on re-acquire. -------

test('claim with no worktree and no session refuses before reading state, naming --session and COLAB_SESSION (#242)', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '5', '--repo', fx.work]); // no --session, COLAB_SESSION neutralised by colab()
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--session/);
  assert.match(r.err, /COLAB_SESSION/);

  // Refused before ANY state was touched — state.json is never even created by this attempt.
  const statePath = path.join(fx.home, 'state.json');
  assert.strictEqual(fs.existsSync(statePath), false, 'no state write of any kind by the refused attempt');
});

test('#242 reproduction: claim --branch then a second command carrying the same session is not refused by its own hold', () => {
  const fx = fixture();
  const claimed = colab(fx, ['claim', '5', '--repo', fx.work, '--branch', 'fix/thing-5', '--session', 's1']);
  assert.strictEqual(claimed.code, 0, claimed.err);

  const check = colab(fx, ['place', 'check', fx.work, '--repo', fx.work, '--session', 's1']);
  assert.strictEqual(check.code, 0, check.err);
  assert.match(check.out, /free \(or held by you\)/);
});

test('solo with no session refuses with the identity message', () => {
  const fx = fixture();
  const r = colab(fx, ['solo', '--repo', fx.work], { COLAB_HUMAN: '1' }); // no --session
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--session/);

  // Refused before the mutate — no solo lock, no state.json write at all from this attempt.
  const statePath = path.join(fx.home, 'state.json');
  assert.strictEqual(fs.existsSync(statePath), false, 'solo flow must not have opened, nothing written');
});

test('COLAB_SESSION env alone satisfies the requirement — no --session flag needed', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--branch', 'fix/thing-5'], { COLAB_SESSION: 'env-session' });
  assert.strictEqual(r.code, 0, r.err);

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec = Object.values(st.places)[0];
  assert.strictEqual(rec.session, 'env-session');
});

test('claim --worktree with no session is UNCHANGED by #242 — warns, does not refuse (no shared-checkout hold is minted)', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--worktree', 'thing-5']); // no --session
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.err, /no --session or --session-name given/);

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.places, {}, 'a --worktree claim never takes the shared-checkout place-claim');
});

test('place release: a blank-session holder\'s refusal explains the identity gap', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work]); // no session, no name
  assert.strictEqual(acq.code, 0, acq.err);

  const rel = colab(fx, ['place', 'release', fx.work, '--repo', fx.work]); // still no session
  assert.notStrictEqual(rel.code, 0);
  assert.match(rel.err, /carries a session id/);
  assert.match(rel.err, /COLAB_HUMAN=1/);
});

// --- #288 CLI-level (plan's acceptance oracle items 14-15) --------------------------------------

test('#288: --pid none records pidKind "invocation"/live:null, and `colab doctor --prune` leaves it present + reports it', () => {
  const fx = fixture();
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--pid', 'none', '--session', 's1']);
  assert.strictEqual(acq.code, 0, acq.err);

  const list = colab(fx, ['places', '--json']);
  assert.strictEqual(list.code, 0, list.err);
  const rows = JSON.parse(list.out);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].pidKind, 'invocation');
  assert.strictEqual(rows[0].live, null);

  const doc = colab(fx, ['doctor', '--json', '--prune']);
  assert.strictEqual(doc.code, 0, doc.err);
  const report = JSON.parse(doc.out);
  assert.strictEqual(report.unprovablePlaces.length, 1, 'reported in the unprovable section, not stalePlaces');
  assert.strictEqual(report.stalePlaces.length, 0);

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.strictEqual(Object.keys(st.places).length, 1, '--prune must NEVER remove an unprovable (live:null) hold');
});

test('#288: a clean (non-agent) env still anchors on the parent pid (pidKind "anchor"), and a dead-pid record is still pruned — pruning not regressed', () => {
  const fx = fixture();
  // Neutralise this test RUNNER's own agent-session env (this suite may itself be running inside
  // an agent shell) so the acquire below exercises rule 4's plain default, not rule 2/3.
  const cleanEnv = { CLAUDECODE: '', CLAUDE_PID: '', AI_AGENT: '' };
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 's1'], cleanEnv);
  assert.strictEqual(acq.code, 0, acq.err);

  const st1 = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const rec1 = Object.values(st1.places)[0];
  assert.strictEqual(rec1.pidKind, 'anchor');
  assert.ok(rec1.pid, 'pid must still be recorded');

  // Seed a SECOND place record (a different checkout path) directly, with an obviously-dead pid and
  // no pidKind at all — the legacy shape `stalePlaces`/`--prune` must keep pruning unregressed.
  const otherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'place-cli-dead-'));
  TMP.push(otherPath);
  st1.places[otherPath] = {
    path: otherPath, repo: fx.work, branch: null, host: os.hostname(),
    session: 's2', sessionName: null, pid: 999999999, since: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify(st1, null, 2));

  const doc = colab(fx, ['doctor', '--json', '--prune']);
  assert.strictEqual(doc.code, 0, doc.err);
  const st2 = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.ok(!st2.places[otherPath], 'the dead-pid legacy record must still be pruned');
  assert.ok(st2.places[Object.keys(st1.places).find((k) => k !== otherPath)], 'the live anchor record must survive');
});
