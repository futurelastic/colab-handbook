'use strict';
/**
 * Unit tests for tools/lib/owner-branch.js — #394 (ruled D): the owner's branch of a repo the
 * fleet does not own, reached only by one pull request the owner merges.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const ob = require('./owner-branch');

test('read: absent key is not declared — and a null block is absent too', () => {
  assert.deepStrictEqual(ob.read({ trunk: 'main' }), { declared: false, branch: null, remote: null, problems: [] });
  assert.strictEqual(ob.read({ owner: null }).declared, false);
  assert.strictEqual(ob.read(null).declared, false);
});

test('read: branch required, remote optional, unknown sub-keys and scalars are problems', () => {
  assert.deepStrictEqual(ob.read({ owner: { branch: 'master' } }), { declared: true, branch: 'master', remote: null, problems: [] });
  assert.strictEqual(ob.read({ owner: { branch: 'master', remote: 'up' } }).remote, 'up');
  assert.match(ob.read({ owner: { remote: 'origin' } }).problems[0], /without "branch:"/);
  assert.match(ob.read({ owner: 'master' }).problems[0], /must be a block/);
  assert.match(ob.read({ owner: { branch: 'master', merge: 'auto' } }).problems[0], /unknown key "merge"/);
  assert.match(ob.read({ owner: { branch: 'trunk' } }).problems[0], /role/);
});

test('evaluate: no key → no findings; collisions with trunk / integration / releaseBranch fail', () => {
  assert.deepStrictEqual(ob.evaluate({ trunk: 'main' }, { trunk: 'main' }), []);
  const doc = { owner: { branch: 'master' } };
  assert.deepStrictEqual(ob.evaluate(doc, { trunk: 'fleet/integration', branches: ['master', 'fleet/integration'] }), []);
  const t = ob.evaluate({ owner: { branch: 'fleet/integration' } }, { trunk: 'fleet/integration' });
  assert.strictEqual(t[0].level, 'fail'); assert.match(t[0].text, /is the trunk/);
  assert.match(ob.evaluate(doc, { trunk: 'x', integration: ['master'] })[0].text, /integration/);
  assert.match(ob.evaluate(doc, { trunk: 'x', releaseBranch: 'master' })[0].text, /releaseBranch/);
  const w = ob.evaluate(doc, { trunk: 'x', branches: ['x'] });
  assert.strictEqual(w[0].level, 'warn');
});

test('refuseMove: absent key never refuses; the owner branch always does; malformed fails closed', () => {
  assert.strictEqual(ob.refuseMove({}, 'main'), null);
  assert.strictEqual(ob.refuseMove({ owner: { branch: 'master' } }, 'fleet/integration'), null);
  assert.match(ob.refuseMove({ owner: { branch: 'master' } }, 'master'), /no colab command moves it/);
  assert.match(ob.refuseMove({ owner: { remote: 'origin' } }, 'anything'), /malformed/);
});

test('classifyPrs: merged read from PR STATE (squash/rebase leave no ancestry), newest first', () => {
  const prs = ob.classifyPrs([
    { number: 3, state: 'MERGED', mergedAt: '2026-01-02T00:00:00Z', headRefOid: 'b' },
    { number: 5, state: 'OPEN', headRefOid: 'c' },
    { number: 1, state: 'MERGED', headRefOid: 'a' },
    { number: 4, state: 'CLOSED', headRefOid: 'x' },
  ]);
  assert.strictEqual(prs.open.number, 5);
  assert.strictEqual(prs.lastMerged.number, 3);
  assert.strictEqual(prs.lastClosed.number, 4);
  // a close OLDER than the last merge is history, not a pending rejection
  const old = ob.classifyPrs([{ number: 2, state: 'CLOSED' }, { number: 3, state: 'MERGED' }]);
  assert.strictEqual(old.lastClosed, null);
  // a closed PR carrying mergedAt counts as merged
  assert.strictEqual(ob.classifyPrs([{ number: 9, state: 'CLOSED', mergedAt: 't' }]).lastMerged.number, 9);
  assert.deepStrictEqual(ob.classifyPrs(null), { open: null, lastMerged: null, lastClosed: null, latest: null });
});

test('issueRefs: #N in first-seen order, de-duplicated; owner/name#N skipped', () => {
  assert.deepStrictEqual(ob.issueRefs(['feat: a (#12)\n\nCloses #12\nCloses #7', 'fix: b\n\nRefs #3 see other/repo#99']), [12, 7, 3]);
  assert.deepStrictEqual(ob.issueRefs([]), []);
});

test('decide: every row', () => {
  const c = [{ sha: 'a', subject: 's' }];
  const none = { open: null, lastMerged: null, lastClosed: null };
  assert.strictEqual(ob.decide({ pending: [], prs: none }).state, 'nothing-to-deliver');
  assert.deepStrictEqual(
    [ob.decide({ pending: c, prs: none }).state, ob.decide({ pending: c, prs: none }).action], ['ready', 'create']);
  const open = { ...none, open: { number: 5 } };
  assert.strictEqual(ob.decide({ pending: c, prs: open }).action, 'refresh');
  assert.strictEqual(ob.decide({ pending: [], prs: open }).action, 'none');
  assert.strictEqual(ob.decide({ pending: c, prs: open }).state, 'waiting-on-owner');
  const rej = { ...none, lastClosed: { number: 4, headRefOid: 'tip' } };
  const r = ob.decide({ pending: c, prs: rej, headSha: 'tip' });
  assert.deepStrictEqual([r.state, r.action], ['rejected', 'none']);
  assert.match(r.detail, /same trunk tip/);
  assert.strictEqual(ob.decide({ pending: c, prs: rej, reopen: true }).action, 'create');
});

test('prText: lists commits and issues, never a closing keyword', () => {
  const t = ob.prText({ trunk: 'fleet/integration', ownerBranch: 'master',
    pending: [{ sha: 'abcdef0123', subject: 'feat: x (#12)', body: 'Closes #12' }], lastMerged: { number: 4 } });
  assert.match(t.title, /fleet\/integration → master: 1 change\(s\) \(#12\)/);
  assert.match(t.body, /`abcdef0` feat: x/);
  assert.match(t.body, /- #12/);
  assert.match(t.body, /Previous delivery: #4/);
  assert.doesNotMatch(t.body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #\d/i);
});
