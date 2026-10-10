'use strict';
// #584 — the pure rules for closing a CI-trigger PR after its branch landed by squash.
// Run: `node --test tools/lib/landed-prs.test.js`.
const test = require('node:test');
const assert = require('node:assert');
const { closeLandedPrs, landedPrComment } = require('./landed-prs');

const closer = (fail = new Set()) => {
  const calls = [];
  return { calls, close: (n, c) => { calls.push([n, c]); return fail.has(n) ? { ok: false, stderr: 'HTTP 502\nmore' } : { ok: true }; } };
};

test('a PR whose head landed is closed with the comment', () => {
  const c = closer();
  const r = closeLandedPrs({ prs: { prs: [{ number: 7, headRefOid: 'aaa' }] }, headLanded: () => true, close: c.close, comment: 'X' });
  assert.deepStrictEqual(r.closed, [7]);
  assert.deepStrictEqual(c.calls, [[7, 'X']]);
});

test('a PR whose head carries work that did not land is kept, never closed', () => {
  const c = closer();
  const r = closeLandedPrs({ prs: { prs: [{ number: 8, headRefOid: 'bbb' }] }, headLanded: () => false, close: c.close, comment: 'X' });
  assert.deepStrictEqual(r.closed, []);
  assert.strictEqual(r.kept[0].number, 8);
  assert.strictEqual(c.calls.length, 0);
});

test('a failed close is reported, not thrown, and the others still close', () => {
  const c = closer(new Set([9]));
  const r = closeLandedPrs({ prs: { prs: [{ number: 9, headRefOid: 'a' }, { number: 10, headRefOid: 'b' }] }, headLanded: () => true, close: c.close, comment: 'X' });
  assert.deepStrictEqual(r.closed, [10]);
  assert.deepStrictEqual(r.failed, [{ number: 9, error: 'HTTP 502' }]);
});

test('a list error is surfaced as listError, never as "no PRs"', () => {
  const r = closeLandedPrs({ prs: { error: 'boom' }, headLanded: () => true, close: () => ({ ok: true }), comment: 'X' });
  assert.strictEqual(r.listError, 'boom');
});

test('a skipped PR (#350 already closed it) is not touched again', () => {
  const c = closer();
  closeLandedPrs({ prs: { prs: [{ number: 11, headRefOid: 'a' }] }, headLanded: () => true, close: c.close, comment: 'X', skip: [11] });
  assert.strictEqual(c.calls.length, 0);
});

test('a headLanded that throws reads as not landed — kept', () => {
  const r = closeLandedPrs({ prs: { prs: [{ number: 12, headRefOid: 'a' }] }, headLanded: () => { throw new Error('x'); }, close: () => ({ ok: true }), comment: 'X' });
  assert.strictEqual(r.kept.length, 1);
});

test('the comment names the target, the squash sha and the issues', () => {
  const s = landedPrComment({ target: 'main', sha: 'abc123', issues: [5, 6] });
  assert.match(s, /`main`/); assert.match(s, /abc123/); assert.match(s, /\(#5 #6\)/);
});
