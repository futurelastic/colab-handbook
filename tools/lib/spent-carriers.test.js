'use strict';
/**
 * #760 — the pure half of `spent-carriers.js`: the revert name shape, the `#N` reference test, and
 * the verdict that fails toward "still a carrier". The git half runs end to end in
 * claim-spent-carriers-cli.test.js, against a real bare remote.
 *
 * Run: `node --test tools/lib/spent-carriers.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const { revertShape, referencesIssue, verdict } = require('./spent-carriers');

test('revertShape: the revert segment, sha first, the trailing run as issues', () => {
  assert.deepStrictEqual(revertShape('fix/revert-3b6fa56-760'), { sha: '3b6fa56', issues: [760] });
  assert.deepStrictEqual(revertShape('ada/box-a/fix/revert-3b6fa56aa-12-13'), { sha: '3b6fa56aa', issues: [12, 13] });
  // an all-digit short sha is the sha, never an issue number
  assert.deepStrictEqual(revertShape('fix/revert-1234567-760'), { sha: '1234567', issues: [760] });
});

test('revertShape: anything else is not a prepared revert', () => {
  for (const b of ['fix/revert-760', 'fix/revert-xyz1234-760', 'fix/revert-abc-760', 'fix/unrevert-3b6fa56-760',
    'revert/revert-3b6fa56-760', 'fix/revert-3b6fa56', 'claim/760', '', null]) {
    assert.strictEqual(revertShape(b), null, String(b));
  }
});

test('referencesIssue: #N as a whole number, not inside another reference', () => {
  assert.ok(referencesIssue('fix: thing (#7)', 7));
  assert.ok(referencesIssue('body\n\nCloses #7\n', 7));
  assert.ok(referencesIssue('#7 at the start', 7));
  assert.ok(!referencesIssue('fix: thing (#70)', 7));
  assert.ok(!referencesIssue('fix: thing (#17)', 7));
  assert.ok(!referencesIssue('other/repo#7', 7));
  assert.ok(!referencesIssue('', 7));
});

const LANDED = { state: 'landed', method: 'content', commitsAhead: 2, why: 'merging the branch would not change the base tree' };
const base = { num: 7, revert: null, revertOnTrunk: false, landed: LANDED, refCommit: 'abc1234', trunk: 'main' };

test('verdict: shipped needs content-landed AND commits ahead AND a trunk commit referencing #N', () => {
  const v = verdict(base);
  assert.strictEqual(v.spent, true);
  assert.strictEqual(v.reason, 'shipped');
  assert.match(v.why, /abc1234 references #7/);
});

test('verdict: every missing fact keeps the branch a carrier', () => {
  assert.strictEqual(verdict({ ...base, landed: null }).spent, false);
  assert.strictEqual(verdict({ ...base, landed: { ...LANDED, state: 'unknown', method: 'none' } }).spent, false, 'unknown is not landed');
  assert.strictEqual(verdict({ ...base, landed: { ...LANDED, state: 'cargo' } }).spent, false);
  assert.strictEqual(verdict({ ...base, landed: { ...LANDED, method: 'two-signal' } }).spent, false, 'the two-signal fallback never proves spent');
  assert.strictEqual(verdict({ ...base, landed: { ...LANDED, commitsAhead: 0 } }).spent, false, 'zero ahead may be freshly cut');
  assert.strictEqual(verdict({ ...base, landed: { ...LANDED, commitsAhead: null } }).spent, false);
  assert.strictEqual(verdict({ ...base, refCommit: '' }).spent, false, 'no trunk commit names the issue');
});

test('verdict: a prepared revert of a trunk commit, named for #N, is skipped for #N only', () => {
  const revert = { sha: '3b6fa56', issues: [7] };
  const v = verdict({ ...base, landed: null, refCommit: '', revert, revertOnTrunk: true });
  assert.strictEqual(v.spent, true);
  assert.strictEqual(v.reason, 'revert');
  assert.match(v.why, /prepared revert of 3b6fa56/);
  assert.strictEqual(verdict({ ...base, landed: null, revert, revertOnTrunk: false }).spent, false, 'sha not on trunk');
  assert.strictEqual(verdict({ ...base, num: 8, landed: null, revert, revertOnTrunk: true }).spent, false, 'not named for this issue');
});

test('verdict: proof two — the tip tree is a trunk commit referencing #N, with commits ahead', () => {
  const unknown = { state: 'unknown', method: 'none', commitsAhead: 2, why: 'conflict' };
  const v = verdict({ ...base, landed: unknown, treeCommit: 'def5678' });
  assert.strictEqual(v.spent, true);
  assert.match(v.why, /its tree is def5678 on main, which references #7/);
  assert.strictEqual(verdict({ ...base, landed: { ...unknown, commitsAhead: 0 }, treeCommit: 'def5678' }).spent, false, 'a fresh cut matches trunk\'s tree too');
  assert.strictEqual(verdict({ ...base, landed: null, treeCommit: 'def5678' }).spent, false);
});
