'use strict';
/**
 * Tests for the `--refs` brake reminder (tools/lib/refs-brake.js, #385).
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');

const { countBoxes, brakeLabel, refsBrakeFinding, reminderLines } = require('./refs-brake.js');

// The incident's shape: leftovers under a "Done when" heading, not "## Plan".
const INCIDENT_BODY = '## Goal\n\nx\n\n## Done when\n\n- [x] code lands\n- [ ] live end-to-end proof in a real session\n';

test('countBoxes counts boxes under ANY heading, not only ## Plan', () => {
  assert.deepStrictEqual(countBoxes(INCIDENT_BODY), { total: 2, unticked: 1 });
  assert.deepStrictEqual(countBoxes('* [ ] a\n  - [X] b\nplain - [ ] not a line start'), { total: 2, unticked: 1 });
  assert.deepStrictEqual(countBoxes(null), { total: 0, unticked: 0 });
});

test('the incident fires: --refs, an unticked box, no hold label', () => {
  const f = refsBrakeFinding({ issue: 7, body: INCIDENT_BODY, labels: [{ name: 'deps-checked' }, { name: 'enhancement' }] });
  assert.ok(f);
  assert.strictEqual(f.issue, 7);
  assert.strictEqual(f.unticked, 1);
  assert.strictEqual(f.total, 2);
  assert.match(f.reason, /no hold/);
});

test('no reminder when every box is ticked, or there are none', () => {
  assert.strictEqual(refsBrakeFinding({ issue: 1, body: '- [x] done\n', labels: [] }), null);
  assert.strictEqual(refsBrakeFinding({ issue: 1, body: 'prose only', labels: [] }), null);
});

test('each start-stopping label silences it', () => {
  for (const l of ['deferred:measurement', 'deferred:date', 'deferred:external-party', 'needs-decision', 'tracking', 'delivery:ops']) {
    assert.strictEqual(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: [l] }), null, l);
  }
});

test('a label declared under project.yml holds: silences it; an undeclared lookalike does not', () => {
  assert.strictEqual(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: ['needs-rescope'], declaredHolds: ['needs-rescope'] }), null);
  assert.ok(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: ['needs-rescope'], declaredHolds: [] }));
  assert.ok(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: ['hold:manual'] }), 'nothing infers a hold from a name (§5 Holds)');
});

test('a code-lane delivery value is not a brake', () => {
  assert.ok(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: ['delivery:code'] }));
  assert.strictEqual(brakeLabel(['delivery:code'], []), null);
});

test('a bare review-by: date alone is not a brake — it is the wake, not the park', () => {
  assert.ok(refsBrakeFinding({ issue: 1, body: INCIDENT_BODY, labels: ['review-by:2026-10-01'] }));
});

test('reminderLines names both shapes: a hold for a non-code leftover, Remainder for code', () => {
  const text = reminderLines({ issue: 9, unticked: 1, total: 2, reason: 'r' }).join('\n');
  assert.match(text, /gh issue edit 9 --add-label deferred:/);
  assert.match(text, /review-by:/);
  assert.match(text, /Hold: deferred:<kind> — owner:/);
  assert.match(text, /Remainder: #M/);
});
