'use strict';
/**
 * Tests for closing a container with its last child (tools/lib/container-close.js, #371).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Every case is one question: "may `colab ship` close this parent now?" Only one shape may
 * answer yes. The cases worth having are the ones that must answer NO — a refactor that lets an
 * unlabelled parent, an epic with unfiled items, a release record or an unreadable parent close
 * is the regression this file exists to fail against.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  untickedItems, classifyContainer, containerDeliveryLabels, containerCloseComment, containerFinding,
} = require('./container-close.js');
const cc = require('./container-close.js');

const epic = (over = {}) => ({
  number: 40,
  state: 'OPEN',
  labels: [{ name: 'epic' }],
  body: '## Goal\n\nShip the thing.\n',
  subIssuesSummary: { total: 3, completed: 3, percentCompleted: 100 },
  ...over,
});

test('close: an open epic whose native sub-issues are all closed and whose body lists nothing unticked', () => {
  const c = classifyContainer(epic());
  assert.strictEqual(c.verdict, 'close');
  assert.strictEqual(c.number, 40);
  assert.strictEqual(c.total, 3);
});

test('close: ticked checklist lines do not hold the container open', () => {
  assert.strictEqual(classifyContainer(epic({ body: '- [x] #41\n- [X] #42\n' })).verdict, 'close');
});

test('children-open: one sub-issue still open is the normal state of a live epic', () => {
  assert.strictEqual(classifyContainer(epic({ subIssuesSummary: { total: 3, completed: 2 } })).verdict, 'children-open');
});

test('no-sub-issues: a hand-checklist epic is never closed here (code-ship B2c limits stand)', () => {
  assert.strictEqual(classifyContainer(epic({ subIssuesSummary: { total: 0, completed: 0 } })).verdict, 'no-sub-issues');
});

test('not-container: every child closed but no epic label — a finding, not a close', () => {
  const c = classifyContainer(epic({ labels: [{ name: 'enhancement' }] }));
  assert.strictEqual(c.verdict, 'not-container');
  assert.match(containerFinding(c), /not labelled `epic`/);
});

test('unfiled-items: an unticked line is work somebody listed and nobody filed — never closed over', () => {
  const c = classifyContainer(epic({ body: '## Plan\n- [x] #41\n- [ ] phase 3: migrate the importer\n' }));
  assert.strictEqual(c.verdict, 'unfiled-items');
  assert.deepStrictEqual(c.unticked, ['phase 3: migrate the importer']);
  assert.match(containerFinding(c), /1 unticked item/);
});

// ---- #713: an epic stating `Done when` acceptance is proposed, never auto-closed ---------------

test('#713 done-when: every filed child closed, but the body states Done when — never closed', () => {
  const c = classifyContainer(epic({
    body: '## Goal\n\nPhase 2.\n\nDone when: the importer runs nightly with no manual step.\n',
    subIssuesSummary: { total: 1, completed: 1 },
  }));
  assert.strictEqual(c.verdict, 'done-when');
  assert.strictEqual(c.total, 1);
  assert.match(containerFinding(c), /#40: all 1 sub-issue\(s\) closed, but its body states `Done when`/);
});

test('#713 hasDoneWhen: heading, label line, bold, bullet and hyphen forms; any case', () => {
  for (const b of ['## Done when\n- x', 'Done when: x', '**Done when:** x', '- Done when: x', 'done-when: x', '### DONE WHEN']) {
    assert.strictEqual(cc.hasDoneWhen(b), true, b);
  }
});

test('#713 hasDoneWhen: a mid-sentence mention, a blockquote or a fenced example does not count', () => {
  assert.strictEqual(cc.hasDoneWhen('We are done when it ships.'), false);
  assert.strictEqual(cc.hasDoneWhen('> Done when: quoted from elsewhere'), false);
  assert.strictEqual(cc.hasDoneWhen('Template:\n```md\nDone when: …\n```\n'), false);
  assert.strictEqual(cc.hasDoneWhen(undefined), false);
  assert.strictEqual(classifyContainer(epic({ body: 'We are done when it ships.' })).verdict, 'close');
});

test('#713 precedence: unticked items still win (they name the unfiled work); not-container still wins', () => {
  assert.strictEqual(classifyContainer(epic({ body: 'Done when: x\n- [ ] phase 3\n' })).verdict, 'unfiled-items');
  assert.strictEqual(classifyContainer(epic({ labels: [], body: 'Done when: x' })).verdict, 'not-container');
  assert.strictEqual(classifyContainer(epic({ body: 'Done when: x', subIssuesSummary: { total: 2, completed: 1 } })).verdict, 'children-open');
});

test('#713 containerProposalComment: names the child, target and sha, and says it stays open', () => {
  const s = cc.containerProposalComment({ child: 43, sha: 'abc1234', total: 1, target: 'main' });
  assert.match(s, /All 1 sub-issue\(s\) closed — its last open sub-issue #43 shipped to main at abc1234/);
  assert.match(s, /Left open: check `Done when` and close if met/);
  assert.doesNotMatch(s, /Closed by colab ship/);
});

test('untickedItems: a `- [ ]` inside a fenced block is a quoted example, not an item', () => {
  const body = 'Template:\n```md\n- [ ] …\n```\n* [ ] real one\n';
  assert.deepStrictEqual(untickedItems(body), ['real one']);
});

test('release-record: a release tracking issue is owned by colab release finalize', () => {
  const c = classifyContainer(epic({ body: '<!-- colab:release version=v1.2.3 -->\nrecord' }));
  assert.strictEqual(c.verdict, 'release-record');
  assert.strictEqual(containerFinding(c), null);
});

test('already-closed: nothing to do', () => {
  assert.strictEqual(classifyContainer(epic({ state: 'CLOSED' })).verdict, 'already-closed');
});

test('unknown: a failed read, a missing summary or a missing state never closes', () => {
  assert.strictEqual(classifyContainer(null).verdict, 'unknown');
  assert.strictEqual(classifyContainer(epic({ subIssuesSummary: undefined })).verdict, 'unknown');
  assert.strictEqual(classifyContainer(epic({ state: undefined })).verdict, 'unknown');
  assert.strictEqual(classifyContainer(epic({ number: undefined })).verdict, 'unknown');
  assert.match(containerFinding(classifyContainer(null)), /could not read/);
});

test('containerDeliveryLabels: a delivery:* label on an epic is a finding; on a task it is not', () => {
  assert.deepStrictEqual(containerDeliveryLabels([{ name: 'epic' }, { name: 'delivery:code' }]), ['delivery:code']);
  assert.deepStrictEqual(containerDeliveryLabels(['epic', 'enhancement']), []);
  assert.deepStrictEqual(containerDeliveryLabels(['delivery:code']), []);
});

test('containerCloseComment: names the child, the target and the sha', () => {
  const s = containerCloseComment({ child: 43, sha: 'abc1234', total: 3, target: 'main' });
  assert.match(s, /#43 shipped to main at abc1234/);
  assert.match(s, /all 3 sub-issue/);
});

// ---- #502: a parent is looked up by number only in the child's own repository -------------------

test('#502 issueRepoSlug: owner/repo from an issue URL, lowercased; null for anything else', () => {
  assert.strictEqual(cc.issueRepoSlug('https://github.com/Org/Repo-A/issues/47'), 'org/repo-a');
  assert.strictEqual(cc.issueRepoSlug('https://ghe.example/org/repo/issues/1/'), 'org/repo');
  assert.strictEqual(cc.issueRepoSlug('https://github.com/org/repo/pull/3'), null);
  assert.strictEqual(cc.issueRepoSlug(undefined), null);
});

test('#502 parentRelation: same / other / unknown, and the finding line for each', () => {
  const view = (childUrl, parentUrl) => ({ url: childUrl, parent: { number: 68, url: parentUrl } });
  const a = 'https://github.com/org/repo-a/issues/47';
  const same = cc.parentRelation(view(a, 'https://github.com/ORG/repo-a/issues/68'));
  assert.strictEqual(same.relation, 'same');
  assert.strictEqual(cc.parentRelationFinding(same), null);
  const other = cc.parentRelation(view(a, 'https://github.com/org/repo-b/issues/68'));
  assert.deepStrictEqual(other, { relation: 'other', slug: 'org/repo-b', number: 68 });
  assert.strictEqual(cc.parentRelationFinding(other), 'org/repo-b#68 is in another repository — not evaluated');
  const unknown = cc.parentRelation(view(a, undefined));
  assert.strictEqual(unknown.relation, 'unknown');
  assert.doesNotMatch(cc.parentRelationFinding(unknown), /could not read the parent/);
  assert.strictEqual(cc.parentRelation({ parent: { number: 68, url: a } }).relation, 'unknown');
});
