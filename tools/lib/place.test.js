'use strict';
/**
 * Tests for the place-claim primitive (tools/lib/place.js, #136).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `defaultProbe`/`isLive`/`holderOf`/`conflict` all take an injectable probe so these tests never
 * depend on a real pid being alive or dead on the machine running them — same discipline
 * `decideTeardown` uses for its own outcome injection.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const place = require('./place.js');
const machine = require('./machine.js');

const HOST = os.hostname();

function rec(overrides = {}) {
  return {
    path: '/tmp/repo',
    repo: '/tmp/repo',
    branch: null,
    host: HOST,
    session: 'sess-1',
    sessionName: 'my-session',
    pid: 4242,
    since: new Date().toISOString(),
    ...overrides,
  };
}

// --- placeKey ------------------------------------------------------------------

test('placeKey: a symlinked path and its canonical form key identically', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'place-test-'));
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link);
  try {
    assert.strictEqual(place.placeKey(link), place.placeKey(real));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('placeKey: a trailing "." resolves to the same key as the bare path', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'place-test-'));
  try {
    assert.strictEqual(place.placeKey(path.join(base, '.')), place.placeKey(base));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('placeKey: a nonexistent path still resolves (asking "is anything holding this" about a torn-down place is legitimate)', () => {
  const p = place.placeKey('/tmp/does-not-exist-place-test-xyz');
  assert.ok(p.endsWith('does-not-exist-place-test-xyz'));
});

// --- holdRecord ------------------------------------------------------------------

test('holdRecord: a trunk-checkout hold records branch: null, never the word "trunk"', () => {
  const r = place.holdRecord({ pathAbs: '/tmp/repo', repo: '/tmp/repo', branch: null, session: 's1' });
  assert.strictEqual(r.branch, null);
});

test('holdRecord: defaults host to this machine and pid to null when omitted', () => {
  const r = place.holdRecord({ pathAbs: '/tmp/repo', repo: '/tmp/repo' });
  assert.strictEqual(r.host, HOST);
  assert.strictEqual(r.pid, null);
});

// --- holderLabel — a resolvable identity, never bare "unknown" when a pid exists (#235) ---------

test('holderLabel: prefers sessionName over session and pid', () => {
  assert.strictEqual(place.holderLabel(rec({ sessionName: 'my-session', session: 'sess-1', pid: 4242 })), 'my-session');
});

test('holderLabel: falls back to session when no sessionName', () => {
  assert.strictEqual(place.holderLabel(rec({ sessionName: null, session: 'sess-1', pid: 4242 })), 'sess-1');
});

test('holderLabel: neither session nor sessionName falls back to "pid <n> on <host>" — never bare "unknown"', () => {
  assert.strictEqual(place.holderLabel(rec({ sessionName: null, session: null, pid: 4242, host: 'some-host' })),
    'pid 4242 on some-host');
});

test('holderLabel: neither identity nor pid — the one case a hand-edited state.json could still produce — is "unknown"', () => {
  assert.strictEqual(place.holderLabel(rec({ sessionName: null, session: null, pid: null })), 'unknown');
});

test('holderLabel: no record at all is "unknown"', () => {
  assert.strictEqual(place.holderLabel(null), 'unknown');
});

// --- holdAge — a hold's age, self-evident on sight, never a raw timestamp to subtract (#238) ----

test('holdAge: a fresh record reads "just now"', () => {
  assert.strictEqual(place.holdAge(rec({ since: new Date().toISOString() })), 'just now');
});

test('holdAge: a days-old record reads in days — the record #238\'s own design observed', () => {
  const since = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();
  assert.strictEqual(place.holdAge(rec({ since })), '4d ago');
});

test('holdAge: a record with no "since" (only reachable via a hand-edited state.json) degrades to a label, never throws', () => {
  assert.strictEqual(place.holdAge(rec({ since: null })), 'age unknown');
  assert.strictEqual(place.holdAge(null), 'age unknown');
});

// --- defaultProbe / isLive — the liveness-at-read-time core (#136 comment 3) --------

test('defaultProbe: no pid recorded is unknown (null), not dead — fails closed', () => {
  assert.strictEqual(place.defaultProbe(rec({ pid: null })), null);
});

test('defaultProbe: a foreign-host record is unknown (null), never probed for liveness', () => {
  assert.strictEqual(place.defaultProbe(rec({ host: 'some-other-machine' })), null);
});

test('isLive: an alive pid (injected probe) is live', () => {
  const r = rec();
  const { live, reason } = place.isLive(r, () => true);
  assert.strictEqual(live, true);
  assert.match(reason, /alive/);
});

test('isLive: a dead pid (injected probe) is NOT live — no write occurred, this is read-time only', () => {
  const r = rec();
  const { live, reason } = place.isLive(r, () => false);
  assert.strictEqual(live, false);
  assert.match(reason, /gone/);
});

test('isLive: same record probed twice with different injected results gives different verdicts — nothing is cached', () => {
  const r = rec();
  assert.strictEqual(place.isLive(r, () => true).live, true);
  assert.strictEqual(place.isLive(r, () => false).live, false); // the "kill the holder, re-check" scenario
});

test('isLive: no record at all is not live, with its own reason', () => {
  const { live, reason } = place.isLive(null);
  assert.strictEqual(live, false);
  assert.match(reason, /no record/);
});

test('isLive: foreign-host record is unknown and names the sync hazard', () => {
  const { live, reason } = place.isLive(rec({ host: 'other-machine' }), () => true);
  assert.strictEqual(live, null);
  assert.match(reason, /other-machine/);
});

// --- holderOf / conflict ------------------------------------------------------------

test('holderOf: no record at the path is null — genuinely free', () => {
  const st = { places: {} };
  assert.strictEqual(place.holderOf(st, '/tmp/nobody-here'), null);
});

test('holderOf: resolves liveness at call time via the injected probe', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec() } };
  const h = place.holderOf(st, '/tmp/repo', () => true);
  assert.strictEqual(h.live, true);
});

test('conflict: no hold at all — clear ground', () => {
  const st = { places: {} };
  assert.strictEqual(place.conflict(st, '/tmp/repo'), null);
});

test('conflict: a live OTHER holder refuses, kind "held"', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: 'sess-other' }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c.kind, 'held');
  assert.match(c.message, /held by session/);
});

test('conflict: the SAME session re-acquiring its own hold is not a conflict', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: 'sess-mine' }) } };
  assert.strictEqual(place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true), null);
});

test('conflict: a dead holder (injected probe false) is clear ground, no write required first', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: 'sess-other' }) } };
  assert.strictEqual(place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => false), null);
});

test('conflict: unknown liveness (no pid) refuses, kind "unknown", names both remedies', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ pid: null, session: 'sess-other' }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' });
  assert.strictEqual(c.kind, 'unknown');
  assert.match(c.message, /wait a moment/);
  assert.match(c.message, /COLAB_HUMAN=1/);
});

test('conflict: a hold with neither session nor sessionName names its pid+host in the message, never a bare "unknown" (#235)', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: null, pid: 9999, host: HOST }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c.kind, 'held');
  assert.match(c.message, /pid 9999 on/);
  assert.doesNotMatch(c.message, /session "unknown"/);
});

test('conflict: a foreign-host record refuses, kind "foreign-host", citing the sync prohibition', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ host: 'other-machine', session: 'sess-other' }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c.kind, 'foreign-host');
});

// --- conflict() and blank-session self-recognition (#242) -----------------------------

test('conflict: two blank sessions are NOT the same holder — a self-collision still refuses', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: null }) } };
  const c = place.conflict(st, '/tmp/repo', { session: '' }, () => true);
  assert.notStrictEqual(c, null);
  assert.strictEqual(c.kind, 'held');
});

test('conflict: pid is never an exemption key — identical pid, blank sessions both sides, still a conflict', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: null, pid: 4242 }) } };
  const c = place.conflict(st, '/tmp/repo', { session: '', pid: 4242 }, () => true);
  assert.notStrictEqual(c, null);
  assert.strictEqual(c.kind, 'held');
  assert.strictEqual(c.likelySelf, true);
});

test('conflict: a blank-blank refusal names the identity gap and both remedies', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: null, pid: 4242 }) } };
  const c = place.conflict(st, '/tmp/repo', { session: '', pid: 4242 }, () => true);
  assert.match(c.message, /carries a session id/);
  assert.match(c.message, /--session/);
  assert.match(c.message, /COLAB_SESSION/);
  assert.match(c.message, /COLAB_HUMAN=1 colab place release/);
});

test('conflict: blank-blank with a DIFFERENT pid carries no likelySelf and never claims the hold is yours', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: null, pid: 4242 }) } };
  const c = place.conflict(st, '/tmp/repo', { session: '', pid: 9999 }, () => true);
  assert.notStrictEqual(c.likelySelf, true);
  assert.doesNotMatch(c.message, /very likely yours/);
});

test('conflict: a non-blank matching session still exempts itself (unchanged)', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: 'sess-mine' }) } };
  assert.strictEqual(place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true), null);
});

test('conflict: unidentified is false whenever either side carries a session', () => {
  const key = place.placeKey('/tmp/repo');
  const st1 = { places: { [key]: rec({ session: 'sess-other' }) } };
  const c1 = place.conflict(st1, '/tmp/repo', { session: '' }, () => true);
  assert.strictEqual(c1.unidentified, false);

  const st2 = { places: { [key]: rec({ session: null }) } };
  const c2 = place.conflict(st2, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c2.unidentified, false);
});

test('conflict: sessionName is never an exemption key — equal names, blank sessions both sides, still a conflict', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: null, sessionName: 'same-label' }) } };
  const c = place.conflict(st, '/tmp/repo', { session: '', sessionName: 'same-label' }, () => true);
  assert.notStrictEqual(c, null);
  assert.strictEqual(c.kind, 'held');
});

// --- conflict() names the hold's age, on every kind (#238) ------------------------

const DAYS_OLD = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();

test('conflict: kind "held" names the age alongside the holder, not just liveness', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ session: 'sess-other', since: DAYS_OLD }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c.kind, 'held');
  assert.match(c.message, /held 4d ago/);
});

test('conflict: kind "unknown" names the age too — a forgotten hold looks the same as a fresh one without it', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ pid: null, session: 'sess-other', since: DAYS_OLD }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' });
  assert.strictEqual(c.kind, 'unknown');
  assert.match(c.message, /held 4d ago/);
});

test('conflict: kind "foreign-host" names the age too', () => {
  const key = place.placeKey('/tmp/repo');
  const st = { places: { [key]: rec({ host: 'other-machine', session: 'sess-other', since: DAYS_OLD }) } };
  const c = place.conflict(st, '/tmp/repo', { session: 'sess-mine' }, () => true);
  assert.strictEqual(c.kind, 'foreign-host');
  assert.match(c.message, /held 4d ago/);
});

// --- stalePlaces -----------------------------------------------------------------

test('stalePlaces: lists only confirmed-dead holders, never "unknown" ones', () => {
  const st = {
    places: {
      '/tmp/dead': rec({ path: '/tmp/dead', pid: 1 }),
      '/tmp/alive': rec({ path: '/tmp/alive', pid: 2 }),
      '/tmp/unknown': rec({ path: '/tmp/unknown', pid: null }),
    },
  };
  const probe = (r) => (r.path === '/tmp/dead' ? false : r.path === '/tmp/alive' ? true : null);
  const stale = place.stalePlaces(st, probe);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].path, '/tmp/dead');
});

// --- syncedStateProblem ------------------------------------------------------------

test('syncedStateProblem: a directory with no sync markers up to $HOME is clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-sync-test-'));
  try {
    // A tmp dir is not inside $HOME, so the ancestor walk stops quickly without a sync marker.
    assert.strictEqual(place.syncedStateProblem(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('syncedStateProblem: a ".sync" marker beside the colab dir is flagged (Resilio)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-sync-test-'));
  fs.mkdirSync(path.join(dir, '.sync'));
  try {
    const problem = place.syncedStateProblem(dir);
    assert.ok(problem);
    assert.match(problem, /file-synced/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('syncedStateProblem: a ".stfolder" marker is flagged (Syncthing)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-sync-test-'));
  fs.mkdirSync(path.join(dir, '.stfolder'));
  try {
    assert.ok(place.syncedStateProblem(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('syncedStateProblem: an iCloud "Library/Mobile Documents" path is flagged by substring, no marker file needed', () => {
  const p = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', '.colab');
  const problem = place.syncedStateProblem(p);
  assert.ok(problem);
  assert.match(problem, /iCloud/);
});

// --- #289: machine identity end-to-end through isLive/conflict, not just machine.js in isolation --

test('isLive: a record whose host is the SAME first label under a different case/suffix than the live machine is live: true — #289 drift case, end-to-end', () => {
  const localHost = machine.localMachine().host;
  const drifted = localHost.toUpperCase() + '.some.other.suffix.';
  const r = rec({ host: drifted, pid: process.pid });
  const { live, reason } = place.isLive(r, () => true);
  assert.strictEqual(live, true);
  assert.match(reason, /alive/);
});

// --- #288: pidKind — 'invocation' pids are a lead for humans, never a liveness signal ------------

test('defaultProbe: pid + no pidKind (legacy/anchor default) is probed normally', () => {
  assert.strictEqual(place.defaultProbe(rec({ pid: process.pid, pidKind: undefined })), true);
});

test('defaultProbe: pid + pidKind "invocation" is NEVER probed — null even though the pid is alive', () => {
  assert.strictEqual(place.defaultProbe(rec({ pid: process.pid, pidKind: 'invocation' })), null);
});

test('defaultProbe: pid + pidKind "anchor" is probed exactly like the legacy default', () => {
  assert.strictEqual(place.defaultProbe(rec({ pid: process.pid, pidKind: 'anchor' })), true);
});

test('isLive: an "invocation" record names WHY it cannot probe and cites #288, distinct from the no-pid reason', () => {
  const withPid = place.isLive(rec({ pid: 4242, pidKind: 'invocation' }));
  assert.strictEqual(withPid.live, null);
  assert.match(withPid.reason, /#288/);
  assert.doesNotMatch(withPid.reason, /no pid recorded/);

  const noPid = place.isLive(rec({ pid: null, pidKind: null }));
  assert.strictEqual(noPid.live, null);
  assert.match(noPid.reason, /no pid recorded/);
});

// --- stalePlaces / unprovablePlaces — an 'invocation' hold is never "confirmed dead" --------------

test('stalePlaces: never lists an "invocation" record, even with a probe that would say dead for anyone else', () => {
  const st = {
    places: {
      '/tmp/inv': rec({ path: '/tmp/inv', pid: 1, pidKind: 'invocation' }),
      '/tmp/dead': rec({ path: '/tmp/dead', pid: 2, pidKind: 'anchor' }),
    },
  };
  const probe = () => false; // "would say dead" for everyone the module actually lets it probe
  const stale = place.stalePlaces(st, probe);
  assert.deepStrictEqual(stale.map((s) => s.path), ['/tmp/dead']);
});

test('unprovablePlaces: lists an "invocation" record and any other live:null hold, never a live:false one', () => {
  const st = {
    places: {
      '/tmp/inv': rec({ path: '/tmp/inv', pid: 1, pidKind: 'invocation' }),
      '/tmp/dead': rec({ path: '/tmp/dead', pid: 2, pidKind: 'anchor' }),
      '/tmp/alive': rec({ path: '/tmp/alive', pid: 3, pidKind: 'anchor' }),
    },
  };
  const probe = (r) => (r.path === '/tmp/dead' ? false : r.path === '/tmp/alive' ? true : null);
  const unprovable = place.unprovablePlaces(st, probe);
  assert.deepStrictEqual(unprovable.map((s) => s.path), ['/tmp/inv']);
});

// --- resolveAnchor (#288) — table-driven, every real-world source injected ------------------------

test('resolveAnchor: --pid <n>, alive → {pid: n, pidKind: "anchor"}', () => {
  const r = place.resolveAnchor({ pidOpt: '123', env: {}, ppid: 999, alive: () => true, isAncestor: () => false });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 123, pidKind: 'anchor' });
});

test('resolveAnchor: --pid <n>, NOT alive → invalid, no anchor adopted', () => {
  const r = place.resolveAnchor({ pidOpt: '123', env: {}, ppid: 999, alive: () => false, isAncestor: () => false });
  assert.strictEqual(r.invalid, true);
});

test('resolveAnchor: --pid none → {pid: ppid, pidKind: "invocation"}', () => {
  const r = place.resolveAnchor({ pidOpt: 'none', env: {}, ppid: 999, alive: () => true, isAncestor: () => false });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 999, pidKind: 'invocation' });
});

test('resolveAnchor: CLAUDE_PID alive + proven ancestor → {pid: that, pidKind: "anchor"}', () => {
  const r = place.resolveAnchor({
    env: { CLAUDE_PID: '555' }, ppid: 999, alive: () => true, isAncestor: () => true,
  });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 555, pidKind: 'anchor' });
});

test('resolveAnchor: CLAUDE_PID alive but NOT an ancestor + CLAUDECODE=1 → {pid: ppid, pidKind: "invocation"}', () => {
  const r = place.resolveAnchor({
    env: { CLAUDE_PID: '555', CLAUDECODE: '1' }, ppid: 999, alive: () => true, isAncestor: () => false,
  });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 999, pidKind: 'invocation' });
});

test('resolveAnchor: CLAUDECODE=1 alone (no CLAUDE_PID) → {pid: ppid, pidKind: "invocation"}', () => {
  const r = place.resolveAnchor({ env: { CLAUDECODE: '1' }, ppid: 999, alive: () => true, isAncestor: () => true });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 999, pidKind: 'invocation' });
});

test('resolveAnchor: empty env, no --pid → {pid: ppid, pidKind: "anchor"} — today\'s exact default', () => {
  const r = place.resolveAnchor({ env: {}, ppid: 999, alive: () => true, isAncestor: () => true });
  assert.deepStrictEqual({ pid: r.pid, pidKind: r.pidKind }, { pid: 999, pidKind: 'anchor' });
});

test('resolveAnchor: AI_AGENT truthy behaves like CLAUDECODE=1 — fails closed to "invocation"', () => {
  const r = place.resolveAnchor({ env: { AI_AGENT: '1' }, ppid: 999, alive: () => true, isAncestor: () => true });
  assert.strictEqual(r.pidKind, 'invocation');
});

// --- acquire (#285) ------------------------------------------------------------
//
// The decide-and-write half. These are DELIBERATELY deterministic — no processes, no timing, no
// scheduler luck: they drive the exact state transition the concurrency test can only observe
// statistically. `place-serialize.test.js` proves the same property against real racing processes;
// this proves it is not an accident of scheduling.

const ALIVE = () => true;
const DEAD = () => false;

function emptySt() { return { places: {} }; }

function acquireOpts(session, over = {}) {
  return {
    pathAbs: '/tmp/repo-285', repo: '/tmp/repo-285', branch: null, host: HOST,
    session, sessionName: `name-${session}`, pid: 4242, pidKind: 'anchor', ...over,
  };
}

test('acquire: on clear ground it writes exactly one record and reports no supersede', () => {
  const st = emptySt();
  const r = place.acquire(st, acquireOpts('sess-A'), ALIVE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.superseded, null);
  assert.deepStrictEqual(Object.keys(st.places), [place.placeKey('/tmp/repo-285')]);
  assert.strictEqual(st.places[place.placeKey('/tmp/repo-285')].session, 'sess-A');
});

test('acquire: a SECOND acquire on the SAME mutated state is refused, and the first record is untouched', () => {
  // This is the whole point of #285. Before it, each call site re-read state under the lock and wrote
  // unconditionally, so this second write silently superseded the first — measured as 8/8 concurrent
  // `colab place acquire` invocations all exiting 0 against one checkout.
  const st = emptySt();
  assert.strictEqual(place.acquire(st, acquireOpts('sess-A'), ALIVE).ok, true);
  const before = JSON.stringify(st.places);

  const r = place.acquire(st, acquireOpts('sess-B'), ALIVE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.kind, 'held');
  assert.match(r.conflict.message, /name-sess-A/);
  assert.strictEqual(JSON.stringify(st.places), before, 'a refused acquire must write nothing at all');
});

test('acquire: the same session re-acquiring is a RENEWAL — allowed, and never reported as a supersede', () => {
  const st = emptySt();
  place.acquire(st, acquireOpts('sess-A'), ALIVE);
  const r = place.acquire(st, acquireOpts('sess-A'), ALIVE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.superseded, null, 'a renewal is not a takeover and must not be worded as one');
  assert.strictEqual(Object.keys(st.places).length, 1);
});

test('acquire: a CONFIRMED-DEAD holder is clear ground — superseded, and the displaced record is reported', () => {
  const st = emptySt();
  place.acquire(st, acquireOpts('sess-A'), ALIVE);
  const r = place.acquire(st, acquireOpts('sess-B'), DEAD);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.superseded && r.superseded.session, 'sess-A');
  assert.strictEqual(st.places[place.placeKey('/tmp/repo-285')].session, 'sess-B');
});

test('acquire: a pidKind "invocation" holder is UNPROVABLE, and fails closed — refused, not reclaimed', () => {
  // #288's fail-closed direction must survive #285. An agent hold with no provable anchor reads
  // live:null forever; auto-reclaiming it here would silently undo exactly what #288 fixed.
  const st = emptySt();
  place.acquire(st, acquireOpts('sess-A', { pidKind: 'invocation' }), ALIVE);
  const r = place.acquire(st, acquireOpts('sess-B'), place.defaultProbe);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.kind, 'unknown');
  assert.strictEqual(st.places[place.placeKey('/tmp/repo-285')].session, 'sess-A');
});

test('acquire: force writes over a live holder and names what it displaced', () => {
  // `force` is not an override this module grants — the caller has already cleared the COLAB_HUMAN=1
  // bar. This only pins that passing it does what it says.
  const st = emptySt();
  place.acquire(st, acquireOpts('sess-A'), ALIVE);
  const r = place.acquire(st, acquireOpts('sess-B', { force: true }), ALIVE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.superseded && r.superseded.session, 'sess-A');
  assert.strictEqual(st.places[place.placeKey('/tmp/repo-285')].session, 'sess-B');
});

test('acquire: two different paths never conflict — the hold is path-scoped, not repo-scoped', () => {
  const st = emptySt();
  assert.strictEqual(place.acquire(st, acquireOpts('sess-A'), ALIVE).ok, true);
  assert.strictEqual(place.acquire(st, acquireOpts('sess-B', { pathAbs: '/tmp/repo-285-other' }), ALIVE).ok, true);
  assert.strictEqual(Object.keys(st.places).length, 2);
});
