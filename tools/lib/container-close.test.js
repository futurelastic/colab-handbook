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
