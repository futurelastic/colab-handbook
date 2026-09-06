'use strict';
/**
 * Tests for tools/lib/disposition.js — colab-handbook #315.
 *
 * Run: `node --test tools/lib/*.test.js` (the existing CI glob picks this file up).
 *
 * WHAT THESE PIN, and why it is worth pinning. The module exists so two consumers reach the same
 * verdict from the same evidence; a test suite that only exercised the happy path would leave the
 * interesting half — every way a fact can be absent — free to drift towards `agent`. So every row
 * of the authority table gets BOTH columns asserted, and the fail-safe direction gets its own
 * block: absent, malformed and unresolvable facts must read `human`, never `agent`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('./disposition.js');

// A `done` whose every condition is satisfied. Each test below removes exactly one fact, so a
// failure names the condition rather than "something in the bundle".
const DONE_OK = Object.freeze({
  kind: 'done',
  exposure: 'self',
  evidence: { what: 'restarted the daemon', command: 'launchctl kickstart …', result: 'pid 4412', remains: 'nothing' },
  crossCheck: 'curl -s localhost:8775/v1/health',
  acceptance: { ticked: true },
  gateNode: false,
});

// ---------------------------------------------------------------------------------------------
// Vocabulary — the closed set, and the marker
// ---------------------------------------------------------------------------------------------

test('seven kinds, seven tokens, and the sets round-trip', () => {
  assert.equal(d.KINDS.length, 7);
  assert.equal(d.TOKENS.length, 7);
  for (const kind of d.KINDS) assert.equal(d.KIND_BY_TOKEN[d.TOKEN_BY_KIND[kind]], kind);
});

test('no token is a prefix or decorated variant of another — the colab:grade property', () => {
  for (const a of d.TOKENS) {
    for (const b of d.TOKENS) {
      if (a === b) continue;
      assert.ok(!b.startsWith(a), `token "${a}" is a prefix of "${b}" — a prefix reader could confuse them`);
    }
  }
});

test('the kind keeps GitHub\'s close-reason spelling; only the token is hyphenated', () => {
  assert.ok(d.KINDS.includes('not planned'));
  assert.equal(d.TOKEN_BY_KIND['not planned'], 'not-planned');
  assert.equal(d.parseMarker(d.formatMarker('not planned')).kind, 'not planned');
});

test('parseMarker: recognised, unrecognised, absent, and contradictory', () => {
  assert.equal(d.parseMarker('text\n<!-- colab:disposition proposed=routed-out -->\ntext').kind, 'routed-out');
  assert.equal(d.parseMarker('nothing here'), null);
  assert.equal(d.parseMarker(''), null);
  assert.equal(d.parseMarker(undefined), null);

  const bogus = d.parseMarker('<!-- colab:disposition proposed=shipped -->');
  assert.equal(bogus.recognised, false);
  assert.equal(bogus.kind, null, 'an unrecognised token must not default to anything');

  const two = d.parseMarker('<!-- colab:disposition proposed=done -->\n<!-- colab:disposition proposed=hold -->');
  assert.equal(two.recognised, false);
  assert.equal(two.kind, null, 'two proposals is not a proposal');
});

test('parseMarker reads by equality, not by prefix', () => {
  assert.equal(d.parseMarker('<!-- colab:disposition proposed=done-ish -->').recognised, false);
  assert.equal(d.parseMarker('<!-- colab:disposition proposed=holding -->').recognised, false);
});

test('the exported pattern is a string, so no consumer inherits a lastIndex', () => {
  assert.equal(typeof d.MARKER_PATTERN, 'string');
  const body = '<!-- colab:disposition proposed=hold -->';
  assert.equal(d.parseMarker(body).kind, 'hold');
  assert.equal(d.parseMarker(body).kind, 'hold', 'a second read of the same body must answer the same');
});

test('formatMarker refuses to mint a token outside the closed set', () => {
  assert.throws(() => d.formatMarker('shipped'), /not a disposition kind/);
  assert.throws(() => d.formatMarker('not-planned'), /not a disposition kind/, 'the TOKEN is not the KIND');
});

test('evidenceShape: the four fixed fields, whitespace not counted as present', () => {
  assert.deepEqual(d.evidenceShape({ what: 'a', command: 'b', result: 'c', remains: 'd' }), { complete: true, missing: [] });
  assert.deepEqual(d.evidenceShape({ what: 'a', command: '  ', result: 'c', remains: 'd' }).missing, ['command']);
  assert.deepEqual(d.evidenceShape(undefined).missing, d.EVIDENCE_FIELDS.slice());
  assert.ok(!d.EVIDENCE_FIELDS.includes('crossCheck'), 'cross-check is done\'s requirement, not the shape\'s');
});

// ---------------------------------------------------------------------------------------------
// The axis input — exposure, read through axis-authority
// ---------------------------------------------------------------------------------------------

test('axisPermits: none/self/live permit, released does not', () => {
  for (const exposure of ['none', 'self', 'live']) assert.equal(d.axisPermits({ exposure }).ok, true, exposure);
  assert.equal(d.axisPermits({ exposure: 'released' }).ok, false);
});

test('axisPermits reads a legacy descriptor through axis-authority, not by letter', () => {
  assert.equal(d.axisPermits({ project: { tier: 'A' } }).ok, false, 'A -> released');
  assert.equal(d.axisPermits({ project: { tier: 'C' } }).ok, true, 'C -> live');
  assert.equal(d.axisPermits({ project: { tier: 'B' } }).ok, false, 'B -> null: no opinion is not permission');
  assert.equal(d.axisPermits({ project: { tier: 'B', exposure: 'self' } }).ok, true, 'exposure wins where declared');
});

test('axisPermits: no descriptor at all reads human', () => {
  assert.equal(d.axisPermits({}).ok, false);
  assert.equal(d.axisPermits({ project: {} }).ok, false);
  assert.equal(d.axisPermits({ exposure: 'sideways' }).ok, false, 'an unknown value is not a permissive one');
});

// ---------------------------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------------------------

test('done: every condition met on a non-released repo — agent applies', () => {
  const v = d.classify(DONE_OK);
  assert.equal(v.authority, d.AGENT);
  assert.equal(v.applicable, true);
  assert.deepEqual(v.blockers, []);
});

test('done: exposure released — human', () => {
  const v = d.classify({ ...DONE_OK, exposure: 'released' });
  assert.equal(v.authority, d.HUMAN);
  assert.match(v.blockers.join(' '), /released/);
});

test('done: a skip-fence class named in the evidence — human, whatever the exposure', () => {
  const v = d.classify({ ...DONE_OK, skipFence: ['production'] });
  assert.equal(v.authority, d.HUMAN);
  assert.match(v.blockers.join(' '), /skip-fence/);
});

test('done: no cross-check recorded — human (measurement cannot cross-check itself)', () => {
  const { crossCheck, ...rest } = DONE_OK;
  assert.equal(d.classify(rest).authority, d.HUMAN);
  assert.equal(d.classify({ ...DONE_OK, crossCheck: '   ' }).authority, d.HUMAN);
});

test('done: the issue is a gate node for something open — human', () => {
  const v = d.classify({ ...DONE_OK, gateNode: true });
  assert.equal(v.authority, d.HUMAN);
  assert.match(v.blockers.join(' '), /gate node/);
});

test('done: acceptance neither ticked nor a remainder declared — human', () => {
  assert.equal(d.classify({ ...DONE_OK, acceptance: {} }).authority, d.HUMAN);
  assert.equal(d.classify({ ...DONE_OK, acceptance: { remainderDeclared: true } }).authority, d.AGENT,
    'a declared remainder is the stated alternative to a full tick');
});

test('done: free-form evidence is a finding, not a disposition — not applicable at all', () => {
  const v = d.classify({ ...DONE_OK, evidence: { what: 'had a look' } });
  assert.equal(v.applicable, false);
  assert.equal(v.authority, d.HUMAN);
  assert.match(v.why, /free-form evidence is a finding/);
});

test('done: several failures are all reported, not just the first', () => {
  const v = d.classify({ ...DONE_OK, exposure: 'released', gateNode: true, crossCheck: null, skipFence: ['credentials'] });
  assert.equal(v.blockers.length, 4);
});

// ---------------------------------------------------------------------------------------------
// split · routed-out — "never human; filing is mechanical"
// ---------------------------------------------------------------------------------------------

const SPLIT_OK = Object.freeze({ kind: 'split', subIssue: { filed: true, delivery: true, wake: true, evidenceCopied: true } });

test('split: remainder filed and carried across — agent applies', () => {
  const v = d.classify(SPLIT_OK);
  assert.equal(v.authority, d.AGENT);
  assert.equal(v.applicable, true);
});

test('split: unmet mechanics do not escalate — still the agent\'s job, just not filed yet', () => {
  const v = d.classify({ kind: 'split', subIssue: { filed: true } });
  assert.equal(v.authority, d.AGENT, 'a mechanical gap is not a judgement call');
  assert.equal(v.applicable, false);
  assert.equal(v.blockers.length, 3);
});

test('split stays the agent\'s even on a released repo behind a skip fence — it asserts no outcome', () => {
  const v = d.classify({ ...SPLIT_OK, exposure: 'released', skipFence: ['production'] });
  assert.equal(v.authority, d.AGENT);
  assert.ok(!d.ASSERTS_AN_OUTCOME.includes('split'));
});

test('routed-out: a destination that exists and links back — agent applies', () => {
  const v = d.classify({ kind: 'routed-out', routedTo: { ref: 'coding-dashboard#1568', linksBack: true } });
  assert.equal(v.authority, d.AGENT);
  assert.equal(v.applicable, true);
});

test('routed-out: a one-way route is not a route', () => {
  const v = d.classify({ kind: 'routed-out', routedTo: { ref: 'coding-dashboard#1568' } });
  assert.equal(v.authority, d.AGENT);
  assert.equal(v.applicable, false);
  assert.match(v.blockers.join(' '), /link back/);
});

// ---------------------------------------------------------------------------------------------
// hold
// ---------------------------------------------------------------------------------------------

test('hold: a review-by date, or a real blockedBy edge, is a wake — agent applies', () => {
  assert.equal(d.classify({ kind: 'hold', wake: { reviewBy: '2026-10-01' } }).authority, d.AGENT);
  assert.equal(d.classify({ kind: 'hold', wake: { blockedBy: true } }).authority, d.AGENT);
});

test('hold: no wake condition is not a hold — a silent wontfix, applicable to nobody', () => {
  const v = d.classify({ kind: 'hold', wake: {} });
  assert.equal(v.applicable, false);
  assert.match(v.why, /silent wontfix/);
});

test('hold: a wake standing past the proposal threshold with no movement — human confirms', () => {
  const stale = { kind: 'hold', wake: { reviewBy: '2026-01-01', ageDays: d.HOLD_STALE_DAYS + 1 } };
  const v = d.classify(stale);
  assert.equal(v.authority, d.HUMAN);
  assert.match(v.why, /PROPOSAL/, 'the threshold must announce that it is unmeasured');

  assert.equal(d.classify({ ...stale, wake: { ...stale.wake, ageDays: d.HOLD_STALE_DAYS } }).authority, d.AGENT,
    'the boundary itself is not yet stale');
  assert.equal(d.classify({ ...stale, wake: { ...stale.wake, movedSince: true } }).authority, d.AGENT,
    'movement resets the concern');
});

// ---------------------------------------------------------------------------------------------
// needs-boss · not planned · leave
// ---------------------------------------------------------------------------------------------

test('needs-boss: never an agent, on any repo, however clean the evidence', () => {
  const v = d.classify({ ...DONE_OK, kind: 'needs-boss' });
  assert.equal(v.authority, d.HUMAN);
  assert.equal(v.applicable, true, 'recording it is legitimate — it is applying it that is human');
});

test('not planned: superseded by a merged replacement referencing this issue — agent applies', () => {
  const v = d.classify({ kind: 'not planned', exposure: 'self', supersededBy: { ref: '#412', state: 'merged', referencesThis: true } });
  assert.equal(v.authority, d.AGENT);
});

test('not planned: an abandoned direction is a human judgement, always', () => {
  assert.equal(d.classify({ kind: 'not planned', exposure: 'self' }).authority, d.HUMAN);
  assert.equal(d.classify({ kind: 'not planned', exposure: 'self', supersededBy: { ref: '#412', state: 'open', referencesThis: true } }).authority, d.HUMAN,
    'an open replacement has replaced nothing yet');
  assert.equal(d.classify({ kind: 'not planned', exposure: 'self', supersededBy: { ref: '#412', state: 'merged' } }).authority, d.HUMAN,
    'a replacement that does not reference this issue is not evidence about this issue');
});

test('not planned: the shared inputs gate it exactly as they gate done', () => {
  const superseded = { kind: 'not planned', supersededBy: { ref: '#412', state: 'closed', referencesThis: true } };
  assert.equal(d.classify({ ...superseded, exposure: 'released' }).authority, d.HUMAN);
  assert.equal(d.classify({ ...superseded, exposure: 'self', skipFence: ['destructive'] }).authority, d.HUMAN);
  assert.deepEqual(d.ASSERTS_AN_OUTCOME.slice().sort(), ['done', 'not planned']);
});

test('leave: an agent never applies it — a nameable wake converts it to hold', () => {
  const v = d.classify({ kind: 'leave', wake: { reviewBy: '2026-10-01' } });
  assert.equal(v.converted, 'hold');
  assert.equal(v.authority, d.AGENT, 'the agent applies the HOLD it converts to');
  assert.match(v.why, /converts to hold/);
});

test('leave: nothing to wake on is a finding about the brief, not a disposition', () => {
  const v = d.classify({ kind: 'leave' });
  assert.equal(v.converted, 'finding');
  assert.equal(v.applicable, false);
  assert.equal(v.authority, d.HUMAN);
});

test('leave inherits the hold staleness rule through the conversion', () => {
  const v = d.classify({ kind: 'leave', wake: { reviewBy: '2026-01-01', ageDays: 400 } });
  assert.equal(v.converted, 'hold');
  assert.equal(v.authority, d.HUMAN);
});

// ---------------------------------------------------------------------------------------------
// Fail-safe direction
// ---------------------------------------------------------------------------------------------

test('an unrecognised or absent kind is never cleared', () => {
  for (const facts of [undefined, {}, { kind: 'shipped' }, { kind: null }, { token: 'donezo' }, 'done', 42]) {
    const v = d.classify(facts);
    assert.equal(v.authority, d.HUMAN, `${JSON.stringify(facts)} must not clear`);
    assert.equal(v.applicable, false);
    assert.equal(v.kind, null);
  }
});

test('a token may be supplied instead of a kind', () => {
  assert.equal(d.classify({ ...DONE_OK, kind: undefined, token: 'done' }).authority, d.AGENT);
  assert.equal(d.classify({ kind: undefined, token: 'not-planned', exposure: 'self' }).kind, 'not planned');
});

test('no combination of absent facts yields agent for the kinds that assert an outcome', () => {
  for (const kind of d.ASSERTS_AN_OUTCOME) {
    assert.equal(d.classify({ kind }).authority, d.HUMAN, kind);
    assert.equal(d.classify({ kind, exposure: 'self' }).authority, d.HUMAN, `${kind} + permissive exposure alone`);
  }
});

test('malformed sub-objects are treated as unproven, not as satisfied', () => {
  assert.equal(d.classify({ kind: 'done', ...DONE_OK, acceptance: 'yes' }).authority, d.HUMAN);
  assert.equal(d.classify({ kind: 'split', subIssue: 'filed it' }).applicable, false);
  assert.equal(d.classify({ kind: 'hold', wake: 'next week' }).applicable, false);
  assert.equal(d.classify({ kind: 'routed-out', routedTo: null }).applicable, false);
});

test('skipFence: an unnamed boolean true still fences', () => {
  assert.equal(d.classify({ ...DONE_OK, skipFence: true }).authority, d.HUMAN);
  assert.equal(d.classify({ ...DONE_OK, skipFence: [] }).authority, d.AGENT, 'an empty list names nothing');
  assert.equal(d.classify({ ...DONE_OK, skipFence: ['  '] }).authority, d.AGENT, 'nor does a blank entry');
});

test('every documented skip-fence class fences done', () => {
  for (const c of d.SKIP_FENCE_CLASSES) assert.equal(d.classify({ ...DONE_OK, skipFence: [c] }).authority, d.HUMAN, c);
});

test('every kind answers with a closed-set authority and a reason', () => {
  for (const kind of d.KINDS) {
    const v = d.classify({ kind });
    assert.ok(v.authority === d.AGENT || v.authority === d.HUMAN, kind);
    assert.equal(typeof v.why, 'string');
    assert.ok(v.why.length > 0, kind);
    assert.ok(Array.isArray(v.blockers), kind);
  }
});
