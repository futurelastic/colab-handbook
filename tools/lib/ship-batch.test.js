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
  assert.deepStrictEqual(sb.nextStep({ ...base, eligibleCount: 1 }), { step: 'serial', reason: 'too-few' });
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
