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
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
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

test('cmdClaim on a writes:isolated repo (default) is UNAFFECTED by place-claim logic — no COLAB_HUMAN gate applies', () => {
  const fx = fixture('tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n'); // writes omitted = isolated
  const r = colab(fx, ['claim', '5', '--repo', fx.work, '--force', '--session', 'sess-AGENT']);
  assert.strictEqual(r.code, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.places, {}, 'an isolated repo never takes a trunk-checkout place-claim');
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
  const r = colab(fx, ['solo', '--repo', fx.work, '--session', 's']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /degrading/);
  assert.doesNotMatch(r.err, /at Object\.loadState/, 'must not leak a raw stack trace');
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
  const r = colab(fx, ['solo', '--repo', fx.work, '--session', 's']);
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
  const r = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 's', '--session-name', 'n']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.err, '');
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
