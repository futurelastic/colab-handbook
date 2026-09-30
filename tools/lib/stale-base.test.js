'use strict';
/**
 * Tests for tools/lib/stale-base.js (#395) — pure, facts handed in exactly as tools/colab's
 * `shipStaleBaseCheck` measures them. Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const { staleBaseVerdict } = require('./stale-base.js');

const GREEN = { status: 'completed', conclusion: 'success' };
const base = { headSha: 'aaaaaaa1', baseTip: 'bbbbbbb2', base: 'main', ghUsable: true, run: GREEN, behind: 0 };

test('a green run whose head contains the base tip is fresh', () => {
  const r = staleBaseVerdict({ ...base, contains: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'fresh');
});

test('the measured incident: green run, base moved, head lacks it — stale-base, self-clearing', () => {
  const r = staleBaseVerdict({ ...base, contains: false, behind: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'stale-base');
  assert.strictEqual(r.selfClearing, true);
  assert.match(r.detail, /^stale-base: .*1 commit\(s\).*Sync main into the branch \(B0\)/);
});

test('staleness does not depend on the run being green — an in-flight run on a stale head is stale too', () => {
  const r = staleBaseVerdict({ ...base, run: { status: 'in_progress', conclusion: null }, contains: false, behind: 3 });
  assert.strictEqual(r.verdict, 'stale-base');
});

test('no branch run at the head (workflows that cannot fire for a branch ref) passes — nothing to be stale', () => {
  const r = staleBaseVerdict({ ...base, run: { status: 'none', conclusion: null }, contains: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-run');
});

test('branch not pushed — passes as no-run', () => {
  const r = staleBaseVerdict({ ...base, headSha: null, run: null, contains: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-run');
});

test('a failed run read is never fresh', () => {
  const r = staleBaseVerdict({ ...base, run: null, contains: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'unread');
  assert.strictEqual(r.selfClearing, true);
});

test('unmeasurable containment (head sha not local, no base tip) refuses, self-clearing', () => {
  assert.strictEqual(staleBaseVerdict({ ...base, contains: null }).ok, false);
  assert.strictEqual(staleBaseVerdict({ ...base, baseTip: null, contains: true }).ok, false);
});

test('gh unusable defers to the CI row that already refuses — no second refusal', () => {
  const r = staleBaseVerdict({ ...base, ghUsable: false, run: null, contains: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'unread');
});

test('a head that lands no change against the base passes — evidence-close grades nothing', () => {
  const r = staleBaseVerdict({ ...base, contains: 'no-change' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-change');
});
