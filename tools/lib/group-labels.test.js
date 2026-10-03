'use strict';
/**
 * Tests for spent group-label classification (tools/lib/group-labels.js, #85).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The value here is not the counting. It is that this module is the only thing standing
 * between `colab doctor --sync --prune` and `gh label delete`, which is destructive and
 * cannot be undone in kind: recreating a deleted label does not restore the issues it bound
 * or the description carrying the group's rationale. So every case below is really one
 * question — "can this label be deleted?" — and the ones that must answer NO are the ones
 * worth having. A refactor that lets `empty`, `unknown`, or a part-open group become
 * deletable is the regression this file exists to fail against.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  isOpenMember, classifyGroupLabel, classifyGroupLabels, deletableLabels, reportableLabels,
} = require('./group-labels.js');

const closed = (n) => ({ number: n, state: 'CLOSED' });
const open = (n) => ({ number: n, state: 'OPEN' });

// --- the three real populations -------------------------------------------------------

test('every member closed → spent (this is B4\'s condition, reached late)', () => {
  const v = classifyGroupLabel('group:convention-gaps', [closed(70), closed(74)]);
  assert.strictEqual(v.verdict, 'spent');
  assert.strictEqual(v.total, 2);
  assert.strictEqual(v.open, 0);
  assert.deepStrictEqual(v.members, [70, 74]);
});

test('one member still open → mid-flight, and mid-flight is NOT reported', () => {
  const v = classifyGroupLabel('group:import-fixes', [closed(115), open(114), closed(113)]);
  assert.strictEqual(v.verdict, 'mid-flight');
  assert.strictEqual(v.open, 1);
  // A group part-closed is the normal state of a group being worked. Reporting it would be
  // reporting rot that is not rot — the thing #85 explicitly asked not to do.
  assert.deepStrictEqual(reportableLabels([v]), []);
  assert.deepStrictEqual(deletableLabels([v]), []);
});

test('no members → empty: reported, but NEVER deletable', () => {
  const v = classifyGroupLabel('group:vanished', []);
  assert.strictEqual(v.verdict, 'empty');
  // Surfaced for a human …
  assert.deepStrictEqual(reportableLabels([v]).map((x) => x.name), ['group:vanished']);
  // … and withheld from --prune, because "every member was transferred away" and "a triage
  // session created it seconds ago and has not applied it yet" are indistinguishable: the
  // labels API exposes no creation time. Deleting the second case breaks a live grouping.
  assert.deepStrictEqual(deletableLabels([v]), []);
});

// --- the failure contract -------------------------------------------------------------

test('membership that could not be read is unknown — never "no members", never deletable', () => {
  // ghIssueListByLabel returns null on gh failure / no remote / network, and states that null
  // means "could not read". Reading that as an empty array would classify a live group as
  // spent and delete it on the next --prune. That is the sharp edge this case pins.
  for (const bad of [null, undefined]) {
    const v = classifyGroupLabel('group:unreadable', bad);
    assert.strictEqual(v.verdict, 'unknown');
    assert.deepStrictEqual(deletableLabels([v]), []);
    // still surfaced, so a human sees the check was incomplete rather than assuming clean
    assert.deepStrictEqual(reportableLabels([v]).map((x) => x.name), ['group:unreadable']);
  }
});

test('an unrecognised member state counts as OPEN — deletion fails toward keeping', () => {
  assert.strictEqual(isOpenMember({ number: 1, state: 'OPEN' }), true);
  assert.strictEqual(isOpenMember({ number: 1, state: 'CLOSED' }), false);
  assert.strictEqual(isOpenMember({ number: 1, state: 'closed' }), false, 'case-tolerant');
  // No state field at all, or a state nobody has seen before: cannot prove closed.
  assert.strictEqual(isOpenMember({ number: 1 }), true);
  assert.strictEqual(isOpenMember({ number: 1, state: 'MERGED' }), true);
  // …which makes the whole label non-deletable, the safe direction.
  const v = classifyGroupLabel('group:odd', [closed(1), { number: 2 }]);
  assert.strictEqual(v.verdict, 'mid-flight');
  assert.deepStrictEqual(deletableLabels([v]), []);
});

test('the bare "group:" prefix names no group and is never deletable', () => {
  // labels.isGroupLabel already guards this; classification must not undo the guard by
  // treating an unparseable name as an empty group.
  const v = classifyGroupLabel('group:', []);
  assert.strictEqual(v.verdict, 'unknown');
  assert.deepStrictEqual(deletableLabels([v]), []);
});

// --- the repo-level sweep --------------------------------------------------------------

test('classifyGroupLabels picks group labels out of the tracker and leaves the rest alone', () => {
  const all = ['bug', 'in-progress', 'group:alpha', 'epic', 'group:beta', 'group:gamma'];
  const members = {
    'group:alpha': [closed(1), closed(2)],   // spent
    'group:beta': [closed(3), open(4)],      // mid-flight
    'group:gamma': null,                     // unreadable
  };
  const verdicts = classifyGroupLabels(all, (n) => members[n]);

  assert.deepStrictEqual(verdicts.map((v) => [v.name, v.verdict]), [
    ['group:alpha', 'spent'],
    ['group:beta', 'mid-flight'],
    ['group:gamma', 'unknown'],
  ], 'convention labels are not group labels and must not be classified — let alone deleted');

  assert.deepStrictEqual(deletableLabels(verdicts).map((v) => v.name), ['group:alpha']);
  assert.deepStrictEqual(reportableLabels(verdicts).map((v) => v.name),
    ['group:alpha', 'group:gamma']);
});

test('a tracker whose labels could not be listed yields nothing, not an empty tracker', () => {
  // Same contract one level up: ghListLabels returns null on failure. Answering [] here is
  // correct precisely BECAUSE it produces no verdicts — and therefore nothing deletable.
  assert.deepStrictEqual(classifyGroupLabels(null, () => []), []);
  let looked = 0;
  classifyGroupLabels(null, () => { looked++; return []; });
  assert.strictEqual(looked, 0, 'a failed label list must not fan out into membership calls');
});

test('the three labels measured spent on the tracker in #85 all classify as deletable', () => {
  // The concrete evidence from the issue: three fully spent labels that ship's B4 can never
  // reach, because none has an unshipped member left to trigger one.
  const all = ['group:ceremony-vocabulary', 'group:cli-ship-release', 'group:convention-gaps'];
  const members = {
    'group:ceremony-vocabulary': [closed(78), closed(79), closed(80)],
    'group:cli-ship-release': [closed(77), closed(81)],
    'group:convention-gaps': [closed(75), closed(84)],
  };
  const verdicts = classifyGroupLabels(all, (n) => members[n]);
  assert.deepStrictEqual(deletableLabels(verdicts).map((v) => v.name), all);
});

// --- #448: the second read before ship / doctor --prune deletes a label -------------------

const { spentLabelDecision, teardownSpentGroupLabel, keptReason } = require('./group-labels.js');

function stubs({ search, confirm, del = { ok: true } }) {
  const calls = { search: 0, confirm: 0, del: 0 };
  return {
    calls,
    deps: {
      searchOpen: () => { calls.search++; return search; },
      confirmOpen: () => { calls.confirm++; return confirm; },
      deleteLabel: () => { calls.del++; return del; },
    },
  };
}

test('#448 the measured case: search lists 0 open, the issues-table read still shows #4 → NOT deleted', () => {
  const { calls, deps } = stubs({ search: [], confirm: [4] });
  const t = teardownSpentGroupLabel('group:k', deps);
  assert.strictEqual(t.action, 'keep');
  assert.strictEqual(t.reason, 'disagree');
  assert.deepStrictEqual(t.open, [4]);
  assert.strictEqual(calls.del, 0, 'gh label delete must not run when the two reads disagree');
  assert.match(keptReason('group:k', t), /#4 still carries it open/);
});

test('#448 both reads agree on zero → deleted', () => {
  const { calls, deps } = stubs({ search: [], confirm: [] });
  const t = teardownSpentGroupLabel('group:k', deps);
  assert.strictEqual(t.action, 'delete');
  assert.strictEqual(t.deleted, true);
  assert.strictEqual(calls.del, 1);
});

test('#448 confirming read fails → kept, never "none open"', () => {
  const { calls, deps } = stubs({ search: [], confirm: null });
  const t = teardownSpentGroupLabel('group:k', deps);
  assert.strictEqual(t.reason, 'unconfirmed');
  assert.strictEqual(calls.del, 0);
});

test('#448 search shows open members → kept silently, confirm read never spent', () => {
  const { calls, deps } = stubs({ search: [{ number: 9 }], confirm: [] });
  const t = teardownSpentGroupLabel('group:k', deps);
  assert.strictEqual(t.reason, 'open');
  assert.strictEqual(calls.confirm, 0);
  assert.strictEqual(calls.del, 0);
  assert.strictEqual(keptReason('group:k', t), '');
});

test('#448 search read fails → kept as unread', () => {
  const { calls, deps } = stubs({ search: null, confirm: [] });
  assert.strictEqual(teardownSpentGroupLabel('group:k', deps).reason, 'unread');
  assert.strictEqual(calls.confirm + calls.del, 0);
});

test('#448 pre-read search membership (doctor path) still gets confirmed', () => {
  const { calls, deps } = stubs({ confirm: [12] });
  const t = teardownSpentGroupLabel('group:k', { ...deps, searchOpen: [] });
  assert.strictEqual(t.reason, 'disagree');
  assert.strictEqual(calls.confirm, 1);
  assert.strictEqual(calls.del, 0);
});

test('#448 delete itself fails → reported, not claimed', () => {
  const { deps } = stubs({ search: [], confirm: [], del: { ok: false, stderr: 'HTTP 403' } });
  const t = teardownSpentGroupLabel('group:k', deps);
  assert.strictEqual(t.deleted, false);
  assert.strictEqual(t.error, 'HTTP 403');
});

test('#448 not a group label → never deleted', () => {
  const { calls, deps } = stubs({ search: [], confirm: [] });
  assert.strictEqual(teardownSpentGroupLabel('in-progress', deps).action, 'keep');
  assert.strictEqual(calls.del, 0);
});

test('#448 spentLabelDecision is total over the input space', () => {
  assert.strictEqual(spentLabelDecision([], []).action, 'delete');
  for (const [s, c] of [[null, []], [[1], []], [[], null], [[], [3]], [[], undefined]]) {
    assert.strictEqual(spentLabelDecision(s, c).action, 'keep', JSON.stringify([s, c]));
  }
});
