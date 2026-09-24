'use strict';
/**
 * Tests for the decision-record marker (tools/lib/decision-record.js, #121).
 *
 * Pure cases only — no git, no gh, no network. Modelled on migration-grant.test.js; the two
 * modules share TRUSTED_ASSOCIATIONS and the grant/reopen resolution shape, so the test
 * shapes mirror each other on purpose.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  DECISION_MARK, REOPEN_MARK, DECISION_RE, REOPEN_RE,
  decisionCommentBody, reopenCommentBody,
  liveDecisions, TRUSTED_ASSOCIATIONS,
  hasRecordedDecision, answeredOptionRefs,
  PAIR_VERDICTS, pairVerdict,
  evaluateIssue,
} = require('./decision-record.js');

const HOST = 'build-box-01';
const NOW = '2026-08-06T10:00:00Z';
const LATER = '2026-08-06T11:00:00Z';
const LATEST = '2026-08-06T12:00:00Z';

function comment(body, { createdAt = NOW, login = 'vo2vo', authorAssociation = 'MEMBER' } = {}) {
  return { body, createdAt, author: { login }, authorAssociation };
}

function decisionComment(ruledBy, opts = {}) {
  const at = opts.at || NOW;
  return comment(decisionCommentBody(ruledBy, opts.answers, opts.host || HOST, at, opts.body), { ...opts, createdAt: at });
}

function reopenComment(ruledBy, opts = {}) {
  const at = opts.at || NOW;
  return comment(reopenCommentBody(ruledBy, opts.host || HOST, at, opts.reason), { ...opts, createdAt: at });
}

// --- marker bodies round-trip through their own regex --------------------------------------

test('decisionCommentBody round-trips through DECISION_RE, including a ref answered', () => {
  const body = decisionCommentBody('boss', 'issuecomment-123', HOST, NOW);
  const m = body.match(DECISION_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'boss');
  assert.equal(m[2], 'issuecomment-123');
  assert.equal(m[3], HOST);
  assert.equal(m[4], NOW);
});

test('decisionCommentBody defaults answers to "-" when no options block is named', () => {
  const body = decisionCommentBody('boss', undefined, HOST, NOW);
  const m = body.match(DECISION_RE);
  assert.ok(m, body);
  assert.equal(m[2], '-');
});

test('decisionCommentBody appends ruling prose below the marker line when given', () => {
  const body = decisionCommentBody('boss', '-', HOST, NOW, 'Chosen: option D.');
  assert.match(body, /Chosen: option D\./);
  assert.ok(body.match(DECISION_RE));
});

test('reopenCommentBody round-trips through REOPEN_RE', () => {
  const body = reopenCommentBody('boss', HOST, NOW);
  const m = body.match(REOPEN_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'boss');
  assert.equal(m[2], HOST);
  assert.equal(m[3], NOW);
  assert.match(body, /superseded/);
});

test('DECISION_MARK and REOPEN_MARK never collide — a reopen body does not match DECISION_RE and vice versa', () => {
  const decision = decisionCommentBody('boss', '-', HOST, NOW);
  const reopen = reopenCommentBody('boss', HOST, NOW);
  assert.ok(!reopen.match(DECISION_RE), 'reopen body must never parse as a decision');
  assert.ok(!decision.match(REOPEN_RE), 'decision body must never parse as a reopen');
  assert.notEqual(DECISION_MARK.codePointAt(0), REOPEN_MARK.codePointAt(0),
    'the two marks must lead with different leading glyphs');
});

// --- liveDecisions: live / superseded / revived resolution ----------------------------------

test('liveDecisions: a lone decision comment is live', () => {
  const live = liveDecisions([decisionComment('boss')]);
  assert.equal(live.length, 1);
  assert.equal(live[0].ruledBy, 'boss');
  assert.equal(live[0].login, 'vo2vo');
  assert.equal(live[0].authorAssociation, 'MEMBER');
});

test('liveDecisions: a decision followed by a LATER reopen is cancelled', () => {
  const live = liveDecisions([
    decisionComment('boss', { at: NOW }),
    reopenComment('boss', { at: LATER }),
  ]);
  assert.equal(live.length, 0);
});

test('liveDecisions: decide, reopen, then a LATER decide is live again', () => {
  const live = liveDecisions([
    decisionComment('boss', { at: NOW }),
    reopenComment('boss', { at: LATER }),
    decisionComment('boss', { at: LATEST }),
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0].at, LATEST);
});

test('liveDecisions: reopening is NOT ruled-by-scoped — a different name can reopen', () => {
  const live = liveDecisions([
    decisionComment('boss', { at: NOW }),
    reopenComment('may', { at: LATER }),
  ]);
  assert.equal(live.length, 0, 'a reopen from a different ruler must still cancel — no race to protect here');
});

test('liveDecisions: resolution is by createdAt, not array order', () => {
  const live = liveDecisions([
    reopenComment('boss', { at: NOW }),
    decisionComment('boss', { at: LATER }),
  ]);
  assert.equal(live.length, 1);
});

test('liveDecisions tolerates missing/malformed input', () => {
  assert.deepStrictEqual(liveDecisions([]), []);
  assert.deepStrictEqual(liveDecisions(null), []);
  assert.deepStrictEqual(liveDecisions(undefined), []);
  assert.deepStrictEqual(liveDecisions([{ body: 'unrelated comment', createdAt: NOW }]), []);
});

// --- hasRecordedDecision / answeredOptionRefs ------------------------------------------------

test('hasRecordedDecision: true only for a live, trusted decision', () => {
  assert.equal(hasRecordedDecision([decisionComment('boss')]), true);
  assert.equal(hasRecordedDecision([]), false);
  assert.equal(hasRecordedDecision([decisionComment('boss', { authorAssociation: 'NONE' })]), false);
  assert.equal(hasRecordedDecision([
    decisionComment('boss', { at: NOW }),
    reopenComment('boss', { at: LATER }),
  ]), false);
});

test('answeredOptionRefs: extracts live, trusted, non-"-" refs, most-recent-last', () => {
  assert.deepStrictEqual(
    answeredOptionRefs([
      decisionComment('boss', { at: NOW, answers: 'ic-1' }),
      decisionComment('may', { at: LATER, answers: 'ic-2' }),
    ]),
    ['ic-1', 'ic-2'],
  );
  assert.deepStrictEqual(answeredOptionRefs([decisionComment('boss', { answers: undefined })]), []);
  assert.deepStrictEqual(answeredOptionRefs([]), []);
});

// --- evaluateIssue: recorded / gated / contradiction -----------------------------------------

test('evaluateIssue: neither label nor decision — neither recorded nor gated', () => {
  const v = evaluateIssue({ labels: [], comments: [] });
  assert.equal(v.recorded, false);
  assert.equal(v.gated, false);
  assert.equal(v.contradiction, false);
});

test('evaluateIssue: gated only (needs-decision present, no decision comment) — the ordinary blocked state', () => {
  const v = evaluateIssue({ labels: ['needs-decision'], comments: [] });
  assert.equal(v.recorded, false);
  assert.equal(v.gated, true);
  assert.equal(v.contradiction, false);
});

test('evaluateIssue: recorded only (decision-recorded flow — label cleared, decision comment present) — the healthy answered state', () => {
  const v = evaluateIssue({ labels: ['decision-recorded'], comments: [decisionComment('boss')] });
  assert.equal(v.recorded, true);
  assert.equal(v.gated, false);
  assert.equal(v.contradiction, false);
});

test('evaluateIssue: CONTRADICTION — both a live decision AND needs-decision present (the exact #127 failure, now nameable)', () => {
  const v = evaluateIssue({ labels: ['needs-decision'], comments: [decisionComment('boss')] });
  assert.equal(v.recorded, true);
  assert.equal(v.gated, true);
  assert.equal(v.contradiction, true);
});

test('evaluateIssue: label objects ({name}) are accepted, the shape gh issue view actually returns', () => {
  const v = evaluateIssue({ labels: [{ name: 'needs-decision' }], comments: [] });
  assert.equal(v.gated, true);
});

test('evaluateIssue: an untrusted decision comment does not count as recorded', () => {
  const v = evaluateIssue({
    labels: [],
    comments: [decisionComment('boss', { authorAssociation: 'NONE' })],
  });
  assert.equal(v.recorded, false);
});

test('evaluateIssue: tolerates missing labels/comments entirely', () => {
  const v = evaluateIssue({});
  assert.equal(v.recorded, false);
  assert.equal(v.gated, false);
  assert.equal(v.contradiction, false);
  assert.deepStrictEqual(evaluateIssue().decisions, []);
});

test('TRUSTED_ASSOCIATIONS is re-exported from migration-grant.js, never a second copy', () => {
  const migrationGrant = require('./migration-grant.js');
  assert.strictEqual(TRUSTED_ASSOCIATIONS, migrationGrant.TRUSTED_ASSOCIATIONS);
});

// --- the both-labels pair (#357): open question vs interrupted write -------------------------
//
// Two histories leave the identical label set `needs-decision` + `decision-recorded`. An
// interrupted `--record` (comment posted, label swap failed) is answered; a second question
// added by hand is OPEN. Before #357, the only documented reading was "interrupted", which hid
// a re-asked question for ~9 h in one adopter's decision inbox.

const BOTH = ['needs-decision', 'decision-recorded'];
const EARLY = '2026-08-06T09:00:00Z';

test('pairVerdict: null when the pair is absent — gated alone, recorded alone, neither', () => {
  assert.equal(pairVerdict({ labels: ['needs-decision'], comments: [] }), null);
  assert.equal(pairVerdict({ labels: ['decision-recorded'], comments: [decisionComment('boss')] }), null);
  assert.equal(pairVerdict({ labels: [], comments: [] }), null);
});

test('pairVerdict: needs-decision labeled AFTER the ⚖ record — an OPEN second question (the measured #357 case)', () => {
  const v = pairVerdict({ labels: BOTH, comments: [decisionComment('boss', { at: NOW })], labelEvents: [EARLY, LATER] });
  assert.equal(v.verdict, PAIR_VERDICTS.OPEN_QUESTION);
  assert.equal(v.decidedAt, NOW);
  assert.equal(v.askAt, new Date(LATER).toISOString());
});

test('pairVerdict: every needs-decision label event predates the ⚖ record — an INTERRUPTED write', () => {
  const v = pairVerdict({ labels: BOTH, comments: [decisionComment('boss', { at: NOW })], labelEvents: [EARLY] });
  assert.equal(v.verdict, PAIR_VERDICTS.INTERRUPTED_WRITE);
});

test('pairVerdict: a decision:options comment newer than the record is an OPEN question even with the label timeline unread', () => {
  const v = pairVerdict({
    labels: BOTH,
    comments: [decisionComment('boss', { at: NOW }), comment('<!-- decision:options\nA: x\nB: y\n-->', { createdAt: LATER })],
    labelEvents: null,
  });
  assert.equal(v.verdict, PAIR_VERDICTS.OPEN_QUESTION);
});

test('pairVerdict: label timeline NOT read and no newer options block — UNDETERMINED, never interrupted-write', () => {
  const v = pairVerdict({ labels: BOTH, comments: [decisionComment('boss', { at: NOW })], labelEvents: null });
  assert.equal(v.verdict, PAIR_VERDICTS.UNDETERMINED);
});

test('pairVerdict: timeline read but empty — UNDETERMINED (a present label with no labeled event is unexplained)', () => {
  const v = pairVerdict({ labels: BOTH, comments: [decisionComment('boss', { at: NOW })], labelEvents: [] });
  assert.equal(v.verdict, PAIR_VERDICTS.UNDETERMINED);
});

test('pairVerdict: decision-recorded label with NO live record behind it — OPEN (an interrupted --record always leaves the comment)', () => {
  const v = pairVerdict({ labels: BOTH, comments: [], labelEvents: [EARLY] });
  assert.equal(v.verdict, PAIR_VERDICTS.OPEN_QUESTION);
  assert.equal(v.decidedAt, null);
});

test('pairVerdict: a live record reached via needs-decision alone (no decision-recorded label) is still the pair', () => {
  const v = pairVerdict({ labels: ['needs-decision'], comments: [decisionComment('boss', { at: NOW })], labelEvents: [LATEST] });
  assert.equal(v.verdict, PAIR_VERDICTS.OPEN_QUESTION);
});

test('pairVerdict: an untrusted ⚖ record does not answer anything — only the trusted one dates the decision', () => {
  const v = pairVerdict({
    labels: BOTH,
    comments: [decisionComment('boss', { at: NOW }), decisionComment('drive-by', { at: LATEST, authorAssociation: 'NONE' })],
    labelEvents: [LATER],
  });
  assert.equal(v.verdict, PAIR_VERDICTS.OPEN_QUESTION, 'the untrusted LATEST record must not outrank the LATER ask');
});

test('evaluateIssue: pending follows the pair verdict — open and undetermined are pending, interrupted is not', () => {
  const rec = [decisionComment('boss', { at: NOW })];
  assert.equal(evaluateIssue({ labels: BOTH, comments: rec, labelEvents: [LATER] }).pending, true);
  assert.equal(evaluateIssue({ labels: BOTH, comments: rec, labelEvents: null }).pending, true);
  assert.equal(evaluateIssue({ labels: BOTH, comments: rec, labelEvents: [EARLY] }).pending, false);
  assert.equal(evaluateIssue({ labels: ['needs-decision'], comments: [] }).pending, true);
  assert.equal(evaluateIssue({ labels: ['decision-recorded'], comments: rec }).pending, false);
  assert.equal(evaluateIssue({ labels: ['decision-recorded'], comments: rec }).pair, null);
});
