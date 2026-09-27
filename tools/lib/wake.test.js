'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('./wake.js');

// #382 close criterion: "the vocabulary matches, name for name, what the one adopting scheduler
// that evaluates it already accepts." That scheduler's closed list is issueClosed · branchLanded ·
// claimReleased · sessionGone · labelPresent · trunkAt · after. The two session kinds are
// deliberately not adopted (wake.js header). Changing this list is changing the convention.
const SCHEDULER_KINDS = ['issueClosed', 'branchLanded', 'claimReleased', 'sessionGone', 'labelPresent', 'trunkAt', 'after'];

test('vocabulary: the checkable kinds are exactly the five adopted, each spelled as the scheduler spells it', () => {
  assert.deepEqual([...w.CHECKABLE_KINDS].sort(), ['after', 'branchLanded', 'issueClosed', 'labelPresent', 'trunkAt']);
  for (const k of w.CHECKABLE_KINDS) assert.ok(SCHEDULER_KINDS.includes(k), `${k} is a second spelling`);
});

test('vocabulary: the three native forms stay, in front', () => {
  assert.deepEqual(w.WAKE_KINDS.slice(0, 3), ['review-by', 'edge', 'ruling']);
  assert.equal(w.WAKE_KINDS.length, 8);
});

test('parseWake: native forms', () => {
  assert.deepEqual(w.parseWake('review-by:2026-10-01'), { kind: 'review-by', arg: '2026-10-01', raw: 'review-by:2026-10-01' });
  assert.equal(w.parseWake('review-by:2026-02-31'), null, 'an impossible date is refused');
  assert.equal(w.parseWake('review-by:next week'), null);
  assert.deepEqual(w.parseWake('#12'), { kind: 'edge', arg: '12', raw: '#12' });
  assert.deepEqual(w.parseWake('ruling'), { kind: 'ruling', arg: null, raw: 'ruling' });
});

test('parseWake: argument rules match the scheduler', () => {
  assert.ok(w.parseWake('issueClosed:27'));
  assert.ok(w.parseWake('issueClosed:owner/repo#12'));
  assert.equal(w.parseWake('issueClosed:abc'), null);
  assert.equal(w.parseWake('issueClosed:owner/repo'), null);
  assert.ok(w.parseWake('branchLanded:fix/thing-27'));
  assert.equal(w.parseWake('branchLanded:has space'), null);
  assert.ok(w.parseWake('labelPresent:in progress'), 'labels may contain spaces');
  assert.ok(w.parseWake('trunkAt:7a7c900'));
  assert.equal(w.parseWake('trunkAt:abc'), null, 'shorter than 7 hex');
  assert.equal(w.parseWake('trunkAt:nothex!!'), null);
  assert.ok(w.parseWake('after:2026-10-01'));
  assert.ok(w.parseWake('after:1790000000000'));
  assert.equal(w.parseWake('after:whenever'), null);
});

test('parseWake: everything else is outside the closed vocabulary', () => {
  for (const s of ['', 'issueClosed', 'issueClosed:', 'until the fix is deployed', 'claimReleased:5',
    'sessionGone:x', 'IssueClosed:5', 'toString:x', '__proto__:x', 12, null]) {
    assert.equal(w.parseWake(s), null, `accepted ${JSON.stringify(s)}`);
  }
});

test('parseWakeLine: commas AND several conditions; one bad piece refuses the whole line', () => {
  const ok = w.parseWakeLine('issueClosed:o/r#12, trunkAt:abc1234');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.conditions.map((c) => c.kind), ['issueClosed', 'trunkAt']);
  const bad = w.parseWakeLine('issueClosed:o/r#12, until it is deployed');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /until it is deployed/);
  assert.equal(w.parseWakeLine('').ok, false);
  assert.equal(w.parseWakeLine(undefined).ok, false);
  assert.equal(w.parseWakeLine(['#3', 'ruling']).ok, true);
});

test('evaluateWake: unmeasured is null, never guessed', () => {
  const c = w.parseWake('issueClosed:o/r#12');
  assert.equal(w.evaluateWake(c, {}), null);
  assert.equal(w.evaluateWake(c, { issueClosed: { 'o/r#12': true } }), true);
  assert.equal(w.evaluateWake(c, { issueClosed: { 'o/r#12': false } }), false);
  assert.equal(w.evaluateWake(c, { issueClosed: { 'o/r#12': 'yes' } }), null);
  assert.equal(w.evaluateWake(w.parseWake('#9'), { issueClosed: { 9: true } }), true);
  assert.equal(w.evaluateWake(w.parseWake('branchLanded:f/x-1'), { branchLanded: { 'f/x-1': true } }), true);
  assert.equal(w.evaluateWake(w.parseWake('trunkAt:abc1234'), { trunkAt: { abc1234: false } }), false);
  assert.equal(w.evaluateWake(w.parseWake('labelPresent:ready'), { labels: ['ready'] }), true);
  assert.equal(w.evaluateWake(w.parseWake('labelPresent:ready'), { labels: [] }), false);
  assert.equal(w.evaluateWake(w.parseWake('labelPresent:ready'), {}), null);
});

test('evaluateWake: dates are met on or after the day; ruling is never mechanically met', () => {
  const day = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(w.evaluateWake(w.parseWake('review-by:2026-10-01'), { now: day - 1 }), false);
  assert.equal(w.evaluateWake(w.parseWake('review-by:2026-10-01'), { now: day }), true);
  assert.equal(w.evaluateWake(w.parseWake('after:2026-10-01'), { now: day + 1 }), true);
  assert.equal(w.evaluateWake(w.parseWake('after:2026-10-01'), {}), null);
  assert.equal(w.evaluateWake(w.parseWake('ruling'), { now: day, issueClosed: {}, labels: [] }), null);
});

test('evaluateWakeLine: AND — met only when every condition is measured met', () => {
  const conds = w.parseWakeLine('issueClosed:o/r#12, trunkAt:abc1234').conditions;
  assert.equal(w.evaluateWakeLine(conds, { issueClosed: { 'o/r#12': true }, trunkAt: { abc1234: true } }), true);
  assert.equal(w.evaluateWakeLine(conds, { issueClosed: { 'o/r#12': true } }), null, 'half measured is not met');
  assert.equal(w.evaluateWakeLine(conds, { issueClosed: { 'o/r#12': true }, trunkAt: { abc1234: false } }), false);
  assert.equal(w.evaluateWakeLine(conds, { issueClosed: { 'o/r#12': false } }), false);
  assert.equal(w.evaluateWakeLine([], {}), null);
});

test('parseQualifiedIssueRef', () => {
  assert.deepEqual(w.parseQualifiedIssueRef('o/r#12'), { slug: 'o/r', number: 12 });
  assert.equal(w.parseQualifiedIssueRef('12'), null);
});
