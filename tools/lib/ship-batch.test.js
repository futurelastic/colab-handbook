'use strict';
/**
 * Unit tests for tools/lib/ship-batch.js (#373) — every exported rule, no I/O.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const sb = require('./ship-batch');

test('parseShipBatch: absent and 1 are serial; 2 and 3 are batches', () => {
  assert.deepStrictEqual(sb.parseShipBatch({}), { n: 1, declared: false, valid: true, reason: 'ship-batch absent' });
  assert.strictEqual(sb.parseShipBatch(null).n, 1);
  assert.strictEqual(sb.parseShipBatch({ 'ship-batch': 1 }).n, 1);
  assert.strictEqual(sb.parseShipBatch({ 'ship-batch': 2 }).n, 2);
  assert.strictEqual(sb.parseShipBatch({ 'ship-batch': 3 }).n, 3);
  assert.strictEqual(sb.parseShipBatch({ 'ship-batch': '2' }).n, 2, 'the audit reads every scalar as a string — both readers agree');
});

test('parseShipBatch: every malformed value fails CLOSED to serial, with the reason', () => {
  for (const v of [0, 4, '4', '03', 2.5, '2.5', true, 'two', -1]) {
    const r = sb.parseShipBatch({ 'ship-batch': v });
    assert.strictEqual(r.n, 1, JSON.stringify(v));
    assert.strictEqual(r.valid, false);
    assert.match(r.reason, /^ship-batch is .*, expected an integer 1–3/);
  }
});

test('batch ref naming round-trips, and nothing else parses as one', () => {
  assert.strictEqual(sb.batchRefName('abcdef0123456789'), 'ship-batch/abcdef0');
  assert.deepStrictEqual(sb.parseBatchRef('refs/heads/ship-batch/abcdef0'), { ref: 'ship-batch/abcdef0', base7: 'abcdef0' });
  assert.deepStrictEqual(sb.parseBatchRef('ship-batch/abcdef0'), { ref: 'ship-batch/abcdef0', base7: 'abcdef0' });
  assert.strictEqual(sb.parseBatchRef('ship-batch/xyz'), null);
  assert.strictEqual(sb.parseBatchRef('feat/ship-batch/abcdef0'), null);
});

test('member trailers round-trip, in order, across messages', () => {
  const t1 = sb.memberTrailer({ ref: 'ship-batch/abcdef0', branch: 'fix/a-11', sha: '1111111aaaa' });
  assert.strictEqual(t1, 'Ship-Batch: ship-batch/abcdef0 fix/a-11@1111111aaaa');
  const msgs = [`fix: a\n\nCloses #11\n\n${t1}`, 'fix: b\n\nShip-Batch: ship-batch/abcdef0 fix/b-12@2222222\n', 'no trailer'];
  assert.deepStrictEqual(sb.parseMemberTrailers(msgs), [
    { ref: 'ship-batch/abcdef0', branch: 'fix/a-11', sha: '1111111aaaa' },
    { ref: 'ship-batch/abcdef0', branch: 'fix/b-12', sha: '2222222' },
  ]);
});

test('branchCiClass reads a member head as a joining class', () => {
  assert.strictEqual(sb.branchCiClass({ status: 'completed', conclusion: 'success' }, true), 'green');
  assert.strictEqual(sb.branchCiClass({ status: 'completed', conclusion: 'failure' }, true), 'red');
  assert.strictEqual(sb.branchCiClass({ status: 'in_progress' }, true), 'pending');
  assert.strictEqual(sb.branchCiClass({ status: 'none' }, true), 'none-pending');
  assert.strictEqual(sb.branchCiClass({ status: 'none' }, false), 'none-cannot-arrive');
  assert.strictEqual(sb.branchCiClass(null, true), 'pending', 'a failed read is never green');
});

const okReport = (over = {}) => ({
  ok: true, mode: 'squash', target: 'main', autonomyGate: { via: 'auto-trunk' },
  migrationGrant: null, ciGrant: null, ciCure: null, coreReview: { verdict: 'inert' }, checks: [], ...over,
});

test('memberEligibility admits an ordinary green member', () => {
  assert.deepStrictEqual(sb.memberEligibility(okReport(), 'green', { trunk: 'main' }), { ok: true, why: 'own head CI: green' });
  assert.strictEqual(sb.memberEligibility(okReport(), 'none-cannot-arrive', { trunk: 'main' }).ok, true);
});

test('memberEligibility sends every special member serial, naming why', () => {
  const cases = [
    [null, 'green', /read failed/],
    [okReport({ ok: false, checks: [{ name: 'trunk CI green', ok: false }] }), 'green', /trunk CI green/],
    [okReport({ mode: 'evidence-close' }), 'green', /evidence-close/],
    [okReport({ mode: 'pr-pending' }), 'green', /pr-pending/],
    [okReport({ target: 'next' }), 'green', /base is "next"/],
    [okReport({ autonomyGate: { via: 'docs-only' } }), 'green', /docs-only/],
    [okReport({ migrationGrant: { ok: true } }), 'green', /migrations/],
    // #401: a reviewer-granted member (P+M+HEAD+R all held) is still never a batch member.
    [okReport({ migrationGrant: { policy: 'reviewer', granted: [{ issue: 1, role: 'reviewer' }], missing: [] } }), 'green', /migrations \(granted or not\)/],
    [okReport({ ciGrant: { ok: true } }), 'green', /grant\/cure/],
    [okReport({ ciCure: { ok: true } }), 'green', /grant\/cure/],
    [okReport({ coreReview: { verdict: 'approved' } }), 'green', /core path/],
    [okReport({ checks: [{ ok: true, detail: 'adopted explicitly (--adopt)' }] }), 'green', /adopted/],
    [okReport(), 'red', /red at its own head/],
    [okReport(), 'pending', /not joinable yet/],
    [okReport(), 'none-pending', /not joinable yet/],
  ];
  for (const [report, cls, rx] of cases) {
    const r = sb.memberEligibility(report, cls, { trunk: 'main' });
    assert.strictEqual(r.ok, false, String(rx));
    assert.match(r.why, rx);
  }
  const wf = sb.memberEligibility(okReport(), 'green', { trunk: 'main', touchesWorkflows: true });
  assert.strictEqual(wf.ok, false);
  assert.match(wf.why, /workflows/);
});

test('selectMembers takes file-disjoint members first, fills from the rest, caps at n', () => {
  const a = { branch: 'a', files: ['x'] };
  const b = { branch: 'b', files: ['x', 'y'] };
  const c = { branch: 'c', files: ['z'] };
  const d = { branch: 'd', files: ['w'] };
  let r = sb.selectMembers([a, b, c], 2);
  assert.deepStrictEqual(r.selected.map((m) => m.branch), ['a', 'c']);
  assert.deepStrictEqual(r.overflow.map((m) => m.branch), ['b']);
  r = sb.selectMembers([a, b, c], 3);
  assert.deepStrictEqual(r.selected.map((m) => m.branch), ['a', 'c', 'b'], 'overlap is a pre-sort, never a veto');
  r = sb.selectMembers([a, c, d], 2);
  assert.deepStrictEqual(r.overflow.map((m) => m.branch), ['d']);
});

test('selectMembers (#387): sharing only generated paths leaves candidates disjoint', () => {
  const a = { branch: 'a', files: ['a.txt', 'allow.json'] };
  const b = { branch: 'b', files: ['b.txt', 'allow.json'] };
  const c = { branch: 'c', files: ['c.txt'] };
  let r = sb.selectMembers([a, b, c], 2);
  assert.deepStrictEqual(r.selected.map((x) => x.branch), ['a', 'c'], 'without the predicate the allowlist is an overlap');
  r = sb.selectMembers([a, b, c], 2, { isGenerated: (f) => f === 'allow.json' });
  assert.deepStrictEqual(r.selected.map((x) => x.branch), ['a', 'b']);
});

test('wiring: no workflow firing on ship-batch/** means the run can never arrive', () => {
  assert.deepStrictEqual(sb.wiring([]), { wired: false, fires: [] });
  assert.deepStrictEqual(sb.wiring(['ci.yml']), { wired: true, fires: ['ci.yml'] });
});

test('combinedVerdict applies the all-runs rule and reports the attempt', () => {
  const ok = { status: 'completed', conclusion: 'success', databaseId: 1 };
  assert.strictEqual(sb.combinedVerdict(null).state, 'pending');
  assert.strictEqual(sb.combinedVerdict([]).state, 'none');
  assert.strictEqual(sb.combinedVerdict([ok, { status: 'in_progress', databaseId: 2 }]).state, 'pending');
  assert.strictEqual(sb.combinedVerdict([ok, { status: 'completed', conclusion: 'failure', databaseId: 2 }]).state, 'red');
  assert.strictEqual(sb.combinedVerdict([ok, { status: 'completed', conclusion: 'cancelled' }]).state, 'green');
  assert.strictEqual(sb.combinedVerdict([{ status: 'completed', conclusion: 'cancelled' }]).state, 'red');
  const g = sb.combinedVerdict([ok, { ...ok, databaseId: 2, attempt: 2 }]);
  assert.deepStrictEqual([g.state, g.attempt, g.runIds], ['green', 2, [1, 2]]);
});

test('nextStep: the declined, waiting and building states', () => {
  const base = { enabled: true, wired: true, trunkCi: 'green', eligibleCount: 3, trunkNow: 'abcdef0999' };
  assert.deepStrictEqual(sb.nextStep({ ...base, enabled: false }), { step: 'serial', reason: 'not-enabled' });
  assert.deepStrictEqual(sb.nextStep({ ...base, wired: false }), { step: 'serial', reason: 'unwired' });
  assert.deepStrictEqual(sb.nextStep({ ...base, trunkCi: 'red' }), { step: 'serial', reason: 'trunk-red' });
  assert.deepStrictEqual(sb.nextStep({ ...base, trunkCi: 'pending' }), { step: 'wait-trunk' });
  // #562: one ready member is a batch of one — it builds; only none ready goes serial.
  assert.deepStrictEqual(sb.nextStep({ ...base, eligibleCount: 1 }), { step: 'build' });
  assert.deepStrictEqual(sb.nextStep({ ...base, eligibleCount: 0 }), { step: 'serial', reason: 'none-ready' });
  assert.deepStrictEqual(sb.nextStep(base), { step: 'build' });
});

test('nextStep: an existing batch — trunk moved, members changed, pending, red once, red twice, green', () => {
  const base = { enabled: true, wired: true, trunkCi: 'green', trunkNow: 'abcdef0999' };
  const ex = { base7: 'abcdef0', matches: true };
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: { ...ex, base7: '1234567' } }), { step: 'rebuild', reason: 'trunk-moved' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: { ...ex, matches: false } }), { step: 'rebuild', reason: 'members-changed' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: ex, verdict: { state: 'pending' } }), { step: 'wait-run' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: ex, verdict: { state: 'none' } }), { step: 'wait-run' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: ex, verdict: { state: 'red', attempt: 1 } }), { step: 'red-rerun-or-serial' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: ex, verdict: { state: 'red', attempt: 2 } }), { step: 'red-serial' });
  assert.deepStrictEqual(sb.nextStep({ ...base, existing: ex, verdict: { state: 'green' } }), { step: 'land' });
  // the race: trunk moved between building and landing → never land
  assert.deepStrictEqual(sb.nextStep({ ...base, trunkNow: 'fffffff000', existing: ex, verdict: { state: 'green' } }).step, 'rebuild');
});

test('foreignBatchStep (#391): only a red batch is declined and cleared; everything else waits', () => {
  assert.strictEqual(sb.foreignBatchStep({ state: 'red', attempt: 1, why: 'x' }).step, 'clear');
  assert.strictEqual(sb.foreignBatchStep({ state: 'red', attempt: 2, why: 'x' }).step, 'clear');
  for (const state of ['pending', 'none', 'green']) assert.strictEqual(sb.foreignBatchStep({ state }).step, 'wait');
  assert.strictEqual(sb.foreignBatchStep(null).step, 'wait');
  assert.strictEqual(sb.foreignBatchStep(sb.combinedVerdict(null)).step, 'wait', 'an unreadable run list never clears');
});

test('batchGreenCoversTrunk: only green, same workflows, enough rows, and no real trunk red', () => {
  const g = (id) => ({ status: 'completed', conclusion: 'success', databaseId: id });
  const args = { trunkRows: [{ status: 'in_progress' }], batchRows: [g(1)], trunkFires: ['ci.yml'], batchFires: ['ci.yml'] };
  assert.strictEqual(sb.batchGreenCoversTrunk(args), true);
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, trunkRows: [] }), true);
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, trunkRows: [{ status: 'completed', conclusion: 'failure' }] }), false);
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, batchRows: [{ status: 'in_progress' }] }), false);
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, trunkFires: ['ci.yml', 'deploy.yml'] }), false);
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, trunkFires: ['a.yml', 'b.yml'], batchFires: ['a.yml', 'b.yml'] }), false, 'one row cannot stand for two workflows');
  assert.strictEqual(sb.batchGreenCoversTrunk({ ...args, trunkFires: [], batchFires: [] }), false);
});

test('evidenceSuffix and serialLine', () => {
  assert.strictEqual(sb.evidenceSuffix({ n: 3, ref: 'ship-batch/abcdef0', headSha: '1234567890', runIds: [9001] }),
    ' · landed in a batch of 3 — combined run 9001 at ship-batch/abcdef0@1234567 (#373)');
  assert.strictEqual(sb.serialLine(['fix/a-11', 'fix/b-12']), '→ SERIAL: colab ship --branch fix/a-11 · colab ship --branch fix/b-12');
});

test('#415 notStaged: requested branches the staged batch does not carry, in request order', () => {
  const staged = [{ branch: 'fix/a-11' }, { branch: 'fix/b-12' }];
  assert.deepStrictEqual(sb.notStaged(['fix/a-11', 'fix/b-12', 'fix/c-13'], staged), ['fix/c-13']);
  assert.deepStrictEqual(sb.notStaged(['fix/b-12', 'fix/a-11'], staged), []);
  assert.deepStrictEqual(sb.notStaged(['fix/c-13', 'fix/c-13'], []), ['fix/c-13']);
  assert.deepStrictEqual(sb.notStaged(null, staged), []);
});

test('#509 landPushFailure: re-read remote decides "moved"; stderr decides refusal vs rejection', () => {
  const hook = 'ERR_MODULE_NOT_FOUND x\nerror: failed to push some refs to \'/o.git\'\n';
  const T = 'a'.repeat(40);
  const M = 'b'.repeat(40);
  assert.deepStrictEqual(sb.landPushFailure({ stderr: hook, remoteNow: T, base: T }),
    { kind: 'push-refused', exit: 1, lines: ['ERR_MODULE_NOT_FOUND x'] });
  const rej = ' ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs to \'o\'';
  assert.strictEqual(sb.landPushFailure({ stderr: rej, remoteNow: T, base: T }).kind, 'remote-rejected');
  const nff = ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to \'o\'';
  assert.deepStrictEqual(sb.landPushFailure({ stderr: nff, remoteNow: M, base: T }).exit, 3);
  assert.strictEqual(sb.landPushFailure({ stderr: nff, remoteNow: M, base: T }).kind, 'trunk-moved');
  assert.strictEqual(sb.landPushFailure({ stderr: 'fatal: unable to access', remoteNow: null, base: T }).kind, 'unreachable');
  // only git's generic trailer → it is kept rather than echoing nothing
  assert.deepStrictEqual(sb.landPushFailure({ stderr: 'error: failed to push some refs to \'o\'', remoteNow: T, base: T }).lines,
    ['error: failed to push some refs to \'o\'']);
  assert.strictEqual(sb.landPushFailure({ stderr: Array(20).fill('x').join('\n'), remoteNow: T, base: T }).lines.length, 8);
});

// ---- #555: ship-batch-wait ------------------------------------------------------------------------

test('parseShipBatchWait: absent/null is no wait — today exactly', () => {
  assert.deepStrictEqual(sb.parseShipBatchWait({}), { sec: 0, declared: false, valid: true, reason: 'ship-batch-wait absent' });
  assert.strictEqual(sb.parseShipBatchWait(null).sec, 0);
  assert.strictEqual(sb.parseShipBatchWait({ 'ship-batch-wait': null }).declared, false);
});

test('parseShipBatchWait: a whole number with a unit, no ceiling', () => {
  assert.strictEqual(sb.parseShipBatchWait({ 'ship-batch-wait': '90s' }).sec, 90);
  assert.strictEqual(sb.parseShipBatchWait({ 'ship-batch-wait': '6m' }).sec, 360);
  assert.strictEqual(sb.parseShipBatchWait({ 'ship-batch-wait': ' 1h ' }).sec, 3600);
  assert.strictEqual(sb.parseShipBatchWait({ 'ship-batch-wait': '48h' }).sec, 172800, 'the repo chooses — no handbook ceiling');
  const zero = sb.parseShipBatchWait({ 'ship-batch-wait': '0m' });
  assert.strictEqual(zero.valid, true); assert.strictEqual(zero.sec, 0);
});

test('parseShipBatchWait: malformed fails CLOSED to no wait, with the reason', () => {
  for (const v of [6, '6', 0, '6 m', '6min', '1.5m', '-1m', 'm', true, 'soon', '']) {
    const r = sb.parseShipBatchWait({ 'ship-batch-wait': v });
    assert.strictEqual(r.sec, 0, JSON.stringify(v));
    assert.strictEqual(r.valid, false, JSON.stringify(v));
    assert.match(r.reason, /^ship-batch-wait is .*, expected a whole number with a unit/);
  }
});

test('partnerWait: waits only for ONE eligible member, with a window, inside it', () => {
  const base = { n: 3, waitSec: 360, eligibleCount: 1, readySinceMs: 1_000_000, nowMs: 1_000_000 + 60_000 };
  assert.deepStrictEqual(sb.partnerWait(base), { wait: true, leftSec: 300 });
  assert.deepStrictEqual(sb.partnerWait({ ...base, n: 1 }), { wait: false, reason: 'not-enabled' }, 'serial repo never waits');
  assert.deepStrictEqual(sb.partnerWait({ ...base, waitSec: 0 }), { wait: false, reason: 'no-window' }, 'absent field never waits');
  assert.deepStrictEqual(sb.partnerWait({ ...base, eligibleCount: 2 }), { wait: false, reason: 'has-partner' });
  assert.deepStrictEqual(sb.partnerWait({ ...base, eligibleCount: 0 }), { wait: false, reason: 'none-ready' });
  assert.deepStrictEqual(sb.partnerWait({ ...base, readySinceMs: null }), { wait: false, reason: 'ready-time-unread' });
  assert.deepStrictEqual(sb.partnerWait({ ...base, nowMs: base.readySinceMs + 360_000 }), { wait: false, reason: 'window-elapsed' });
  assert.deepStrictEqual(sb.partnerWait({ ...base, nowMs: base.readySinceMs - 5_000 }), { wait: true, leftSec: 360 }, 'clock skew never extends the window');
});

test('readySince: newest finished run, else the head commit, else null', () => {
  const rows = [
    { status: 'completed', updatedAt: '2026-10-07T10:00:00Z' },
    { status: 'completed', updatedAt: '2026-10-07T10:05:00Z' },
    { status: 'in_progress', updatedAt: '2026-10-07T11:00:00Z' },
  ];
  assert.strictEqual(sb.readySince(rows, '2026-10-07T09:00:00Z'), Date.parse('2026-10-07T10:05:00Z'));
  assert.strictEqual(sb.readySince([], '2026-10-07T09:00:00Z'), Date.parse('2026-10-07T09:00:00Z'));
  assert.strictEqual(sb.readySince(null, null), null);
  assert.strictEqual(sb.readySince([{ status: 'completed' }], 'garbage'), null);
});

// ---- #581: the lane reservation — an in-flight batch at trunk's tip holds the lane ----
const TRUNK = 'abcdef0123456789';
const NOW = Date.parse('2026-10-09T10:00:00Z');
const ago = (min) => NOW - min * 60000;
const batch = (o) => ({ ref: 'ship-batch/abcdef0', base7: 'abcdef0', ...o });

test('laneHold: a pending combined run at trunk tip holds the lane', () => {
  const r = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: { state: 'pending', why: 'a run is still in flight' }, builtAtMs: ago(60) })] });
  assert.strictEqual(r.held, true);
  assert.strictEqual(r.ref, 'ship-batch/abcdef0');
  assert.match(r.why, /in flight/);
});

test('laneHold: an unreadable run list holds (fails closed — a pause clears itself)', () => {
  const r = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: sb.combinedVerdict(null) })] });
  assert.strictEqual(r.held, true);
  assert.strictEqual(sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({})] }).held, true, 'a missing verdict reads as unreadable');
});

test('laneHold: a batch on an older base holds nothing — trunk already moved past it', () => {
  const r = sb.laneHold({ trunkNow: '1234567aaaa', nowMs: NOW, batches: [batch({ verdict: { state: 'pending', why: 'x' } })] });
  assert.deepStrictEqual(r, { held: false, released: [] });
});

test('laneHold: a red batch is declined and holds nothing', () => {
  const r = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: { state: 'red', why: 'a run finished failure' } })] });
  assert.strictEqual(r.held, false);
  assert.match(r.released[0].why, /^declined — a run finished failure/);
});

test('laneHold: no run yet holds within the grace after the build, releases after it', () => {
  const none = { state: 'none', why: 'no run at the batch head yet' };
  assert.strictEqual(sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: none, builtAtMs: ago(2) })] }).held, true);
  const stale = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: none, builtAtMs: ago(16) })] });
  assert.strictEqual(stale.held, false);
  assert.match(stale.released[0].why, /no combined run 16m ago.*abandoned/);
  const unread = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: none, builtAtMs: null })] });
  assert.strictEqual(unread.held, false, 'an unread build time is not provably alive');
});

test('laneHold: green holds within the grace after it went green — then it is abandoned', () => {
  const green = { state: 'green', why: '2 run(s): all success' };
  const fresh = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: green, builtAtMs: ago(40), settledAtMs: ago(3) })] });
  assert.strictEqual(fresh.held, true);
  assert.match(fresh.why, /green 3m ago — its lander lands it/);
  const old = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: green, settledAtMs: ago(15) })] });
  assert.strictEqual(old.held, false, 'exactly the grace has elapsed');
  assert.match(old.released[0].why, /still not landed .*abandoned/);
  assert.strictEqual(sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [batch({ verdict: green, settledAtMs: null })] }).held, false);
});

test('laneHold: graceSec is honoured, and no trunk means nothing is held', () => {
  const green = { state: 'green', why: 'ok' };
  assert.strictEqual(sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, graceSec: 60, batches: [batch({ verdict: green, settledAtMs: ago(2) })] }).held, false);
  assert.strictEqual(sb.laneHold({ trunkNow: '', nowMs: NOW, batches: [batch({ verdict: { state: 'pending' } })] }).held, false);
  assert.strictEqual(sb.laneHold({}).held, false);
});

test('laneHold: a declined batch does not hide a live one at the same base', () => {
  const r = sb.laneHold({ trunkNow: TRUNK, nowMs: NOW, batches: [
    batch({ verdict: { state: 'red', why: 'r' } }),
    batch({ ref: 'ship-batch/abcdef0', verdict: { state: 'pending', why: 'p' } }),
  ] });
  assert.strictEqual(r.held, true);
});

test('settledAt: newest updatedAt among finished rows, null when none', () => {
  assert.strictEqual(sb.settledAt([
    { status: 'completed', updatedAt: '2026-10-09T09:00:00Z' },
    { status: 'completed', updatedAt: '2026-10-09T09:05:00Z' },
    { status: 'in_progress', updatedAt: '2026-10-09T09:10:00Z' },
  ]), Date.parse('2026-10-09T09:05:00Z'));
  assert.strictEqual(sb.settledAt([]), null);
  assert.strictEqual(sb.settledAt(null), null);
});
