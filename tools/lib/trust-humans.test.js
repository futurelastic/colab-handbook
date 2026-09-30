'use strict';
/**
 * Tests for `trust-humans` (#407) — tools/lib/trust-humans.js, and how the three human readers
 * use it: migration-grant.js, ci-grant.js, decision-record.js.
 *
 * The one fact under test: once an adopter's agents run under their own login, the association
 * class (`MEMBER`) cannot tell them from the human. With the key set, only a listed login's grant or
 * ruling is human — and the key absent changes nothing. The "branch cannot edit its own list" half
 * is wiring (tools/colab reads the TARGET's project.yml) and is pinned end to end in
 * ship-migration-grant.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');

const th = require('./trust-humans.js');
const mg = require('./migration-grant.js');
const cg = require('./ci-grant.js');
const dr = require('./decision-record.js');

const HOST = 'build-box-01';
const NOW = '2026-09-30T10:00:00Z';
const BRANCH = 'feat/schema-change-1';
const HUMAN = 'operator-a';
const AGENT = 'agent-bot';
const TRUST = th.parseTrustHumans({ 'trust-humans': [HUMAN] });
const ABSENT = th.parseTrustHumans({});

function comment(body, { login = HUMAN, authorAssociation = 'MEMBER', createdAt = NOW } = {}) {
  return { body, createdAt, author: login === null ? null : { login }, authorAssociation };
}
function openRecord(label, comments) {
  return { state: 'OPEN', labels: [{ name: label }], comments };
}

// --- the parser ---------------------------------------------------------------------------

test('parseTrustHumans: absent reads as undeclared, and a valid list is lowercased', () => {
  assert.deepStrictEqual(th.parseTrustHumans({}), { declared: false, valid: true, humans: null, reason: 'trust-humans absent — a trusted association counts as human' });
  assert.strictEqual(th.parseTrustHumans(null).declared, false);
  assert.strictEqual(th.parseTrustHumans({ 'trust-humans': null }).declared, false);
  const t = th.parseTrustHumans({ 'trust-humans': ['Operator-A', 'second-human'] });
  assert.strictEqual(t.declared, true);
  assert.strictEqual(t.valid, true);
  assert.deepStrictEqual([...t.humans], ['operator-a', 'second-human']);
});

test('parseTrustHumans: every malformed shape fails CLOSED — declared, invalid, nobody human', () => {
  for (const doc of [
    { 'trust-humans': 'operator-a' },
    { 'trust-humans': { humans: ['operator-a'] } },
    { 'trust-humans': [] },
    { 'trust-humans': ['ok', 'not a login'] },
    { 'trust-humans': ['-leading'] },
    { 'trust-humans': [42] },
    { 'trust-humans': [null] },
    { 'trust-humans': true },
  ]) {
    const t = th.parseTrustHumans(doc);
    assert.strictEqual(t.declared, true, JSON.stringify(doc));
    assert.strictEqual(t.valid, false, JSON.stringify(doc));
    assert.strictEqual(t.humans.size, 0, JSON.stringify(doc));
    assert.match(t.reason, /nobody is human/);
    // Fail closed: even a trusted OWNER is not human under a malformed list.
    assert.strictEqual(th.authorIsHuman({ login: 'ok', authorAssociation: 'OWNER' }, t).ok, false);
  }
});

test('authorIsHuman: absent key = the association class, byte-identical reason', () => {
  assert.deepStrictEqual(th.authorIsHuman({ login: AGENT, authorAssociation: 'MEMBER' }, ABSENT), { ok: true, reason: '' });
  assert.deepStrictEqual(th.authorIsHuman({ login: AGENT, authorAssociation: 'MEMBER' }, undefined), { ok: true, reason: '' });
  assert.strictEqual(th.authorIsHuman({ login: 'x', authorAssociation: 'NONE' }, ABSENT).reason,
    'x (NONE) — not a repo owner/member/collaborator');
});

test('authorIsHuman: declared key — listed passes (case-insensitive), unlisted MEMBER and unknown author refuse', () => {
  assert.strictEqual(th.authorIsHuman({ login: 'OPERATOR-A', authorAssociation: 'OWNER' }, TRUST).ok, true);
  const un = th.authorIsHuman({ login: AGENT, authorAssociation: 'MEMBER' }, TRUST);
  assert.strictEqual(un.ok, false);
  assert.match(un.reason, new RegExp(`${AGENT} \\(MEMBER\\) is not listed in trust-humans`));
  const unknown = th.authorIsHuman({ login: '', authorAssociation: 'MEMBER' }, TRUST);
  assert.strictEqual(unknown.ok, false);
  assert.match(unknown.reason, /author could not be read/);
  // Listed but no longer a member: the association check stays.
  assert.match(th.authorIsHuman({ login: HUMAN, authorAssociation: 'NONE' }, TRUST).reason, /no longer a repo owner/);
});

test('labelApplierIsHuman: no-op when undeclared; declared needs the LATEST applier listed; unread refuses', () => {
  assert.strictEqual(th.labelApplierIsHuman(null, ABSENT, 'l').ok, true);
  assert.strictEqual(th.labelApplierIsHuman([AGENT, HUMAN], TRUST, 'l').ok, true);
  const re = th.labelApplierIsHuman([HUMAN, AGENT], TRUST, 'migration-granted');
  assert.strictEqual(re.ok, false);
  assert.match(re.reason, new RegExp(`last applied by ${AGENT}`));
  assert.match(th.labelApplierIsHuman(null, TRUST, 'l').reason, /could not be read/);
  assert.match(th.labelApplierIsHuman([], TRUST, 'l').reason, /no `labeled` event/);
});

// --- migration-grant ------------------------------------------------------------------------

const MLABEL = 'migration-granted';
const mGrant = (who, assoc = 'MEMBER') => comment(mg.grantCommentBody(BRANCH, HOST, NOW), { login: who, authorAssociation: assoc });
const humanActors = () => [HUMAN];

test('migration grant: listed login is live; the same comment by an unlisted MEMBER is refused naming the login', () => {
  const ok = mg.evaluateIssue(openRecord(MLABEL, [mGrant(HUMAN)]), BRANCH, 1, MLABEL, { trust: TRUST, labelActors: humanActors });
  assert.strictEqual(ok.ok, true, ok.reason);
  const no = mg.evaluateIssue(openRecord(MLABEL, [mGrant(AGENT)]), BRANCH, 1, MLABEL, { trust: TRUST, labelActors: humanActors });
  assert.strictEqual(no.ok, false);
  assert.match(no.reason, new RegExp(`#1's grant is not a human's: ${AGENT} \\(MEMBER\\) is not listed`));
});

test('migration grant: an unreadable author is refused', () => {
  const c = mGrant(HUMAN); c.author = null;
  const v = mg.evaluateIssue(openRecord(MLABEL, [c]), BRANCH, 1, MLABEL, { trust: TRUST, labelActors: humanActors });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /author could not be read/);
});

test('migration grant: label re-applied by the agent refuses; unread label timeline refuses', () => {
  const rec = openRecord(MLABEL, [mGrant(HUMAN)]);
  const byAgent = mg.evaluateIssue(rec, BRANCH, 1, MLABEL, { trust: TRUST, labelActors: () => [HUMAN, AGENT] });
  assert.strictEqual(byAgent.ok, false);
  assert.match(byAgent.reason, /last applied by agent-bot/);
  const unread = mg.evaluateIssue(rec, BRANCH, 1, MLABEL, { trust: TRUST, labelActors: () => null });
  assert.strictEqual(unread.ok, false);
  const thrower = mg.evaluateIssue(rec, BRANCH, 1, MLABEL, { trust: TRUST, labelActors: () => { throw new Error('x'); } });
  assert.strictEqual(thrower.ok, false, 'a throwing read fails closed');
});

test('migration grant: key absent — behaviour unchanged, and the label timeline is never read', () => {
  let reads = 0;
  const actors = () => { reads += 1; return [AGENT]; };
  const agentGrant = openRecord(MLABEL, [mGrant(AGENT)]);
  const before = mg.evaluateIssue(agentGrant, BRANCH, 1, MLABEL);
  const after = mg.evaluateIssue(agentGrant, BRANCH, 1, MLABEL, { trust: ABSENT, labelActors: actors });
  assert.deepStrictEqual(after, before);
  assert.strictEqual(after.ok, true, 'without the key a MEMBER agent still reads as human — exactly the pre-#407 hole');
  const outsider = openRecord(MLABEL, [mGrant('drive-by', 'NONE')]);
  assert.deepStrictEqual(mg.evaluateIssue(outsider, BRANCH, 1, MLABEL, { trust: ABSENT }), mg.evaluateIssue(outsider, BRANCH, 1, MLABEL));
  assert.strictEqual(reads, 0);
});

test('migration ship set: a reviewer grant is unaffected by the human list', () => {
  const HEAD = 'a'.repeat(40);
  const rec = { v: '1', role: 'migration-reviewer', reviewer: 'bot-a', head: HEAD, verdict: 'approve',
    checklist: 'pass', escalation: 'destructive-ddl', 'escalation-result': 'clear', 'ci-roundtrip': 'pass' };
  // Posted by the (unlisted) agent account — the reviewer role is judged by P · M · HEAD · R alone.
  const c = comment(mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec), { login: AGENT });
  const ctx = { policy: 'reviewer', headSha: HEAD, roundtrip: () => ({ ok: true }), trust: TRUST, labelActors: () => [AGENT] };
  const s = mg.evaluateShipSet([1], { 1: openRecord(MLABEL, [c]) }, BRANCH, MLABEL, ctx);
  assert.strictEqual(s.ok, true, JSON.stringify(s.missing));
  assert.strictEqual(s.granted[0].role, 'reviewer');
  // And the same set with no trust at all reads identically.
  const s2 = mg.evaluateShipSet([1], { 1: openRecord(MLABEL, [c]) }, BRANCH, MLABEL, { ...ctx, trust: undefined });
  assert.deepStrictEqual(s2, s);
});

test('migration ship set: an agent-posted human grant is refused as `human`, with the login in the reason', () => {
  const ctx = { policy: 'human', headSha: null, roundtrip: () => null, trust: TRUST, labelActors: humanActors };
  const s = mg.evaluateShipSet([1], { 1: openRecord(MLABEL, [mGrant(AGENT)]) }, BRANCH, MLABEL, ctx);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.missing[0].failed, 'human');
  assert.match(s.missing[0].reason, /agent-bot \(MEMBER\) is not listed/);
});

// --- ci-grant -------------------------------------------------------------------------------

const CLABEL = 'ci-granted';
const cGrant = (who) => comment(cg.grantCommentBody(BRANCH, 'main', 'aaaaaaa', 'ccccccc', HOST, NOW), { login: who });
const EV = { ok: true, sha: 'ccccccc' };

test('ci grant: listed live, unlisted MEMBER refused naming the login, unreadable author refused, absent unchanged', () => {
  const opts = { trust: TRUST, labelActors: humanActors };
  assert.strictEqual(cg.evaluateIssue(openRecord(CLABEL, [cGrant(HUMAN)]), BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL, opts).ok, true);
  const no = cg.evaluateIssue(openRecord(CLABEL, [cGrant(AGENT)]), BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL, opts);
  assert.strictEqual(no.ok, false);
  assert.match(no.reason, /agent-bot \(MEMBER\) is not listed in trust-humans/);
  const anon = cGrant(HUMAN); anon.author = null;
  assert.match(cg.evaluateIssue(openRecord(CLABEL, [anon]), BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL, opts).reason, /author could not be read/);
  const lab = cg.evaluateIssue(openRecord(CLABEL, [cGrant(HUMAN)]), BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL, { trust: TRUST, labelActors: () => [AGENT] });
  assert.match(lab.reason, /`ci-granted` was last applied by agent-bot/);
  const r = openRecord(CLABEL, [cGrant(AGENT)]);
  assert.deepStrictEqual(cg.evaluateIssue(r, BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL, { trust: ABSENT }),
    cg.evaluateIssue(r, BRANCH, 'main', 'aaaaaaa', EV, 1, CLABEL));
  const set = cg.evaluateShipSet([1], { 1: r }, BRANCH, 'main', 'aaaaaaa', EV, CLABEL, opts);
  assert.strictEqual(set.ok, false);
});

// --- decision-record ------------------------------------------------------------------------

const ruling = (who) => comment(dr.decisionCommentBody('boss', '-', HOST, NOW), { login: who });

test('ruling: listed live, unlisted MEMBER not a ruling, unreadable author not a ruling, absent unchanged', () => {
  assert.strictEqual(dr.hasRecordedDecision([ruling(HUMAN)], TRUST), true);
  assert.strictEqual(dr.hasRecordedDecision([ruling(AGENT)], TRUST), false);
  const anon = ruling(HUMAN); anon.author = null;
  assert.strictEqual(dr.hasRecordedDecision([anon], TRUST), false);
  assert.strictEqual(dr.hasRecordedDecision([ruling(AGENT)]), true, 'absent key: the association class, as before');
  assert.strictEqual(dr.hasRecordedDecision([ruling(AGENT)], ABSENT), true);

  const labels = ['needs-decision'];
  const agentOnly = dr.evaluateIssue({ labels, comments: [ruling(AGENT)], trust: TRUST });
  assert.strictEqual(agentOnly.recorded, false);
  assert.strictEqual(agentOnly.pending, true, 'an agent-posted ⚖ record does not answer the question');
  assert.deepStrictEqual(dr.evaluateIssue({ labels, comments: [ruling(AGENT)], trust: ABSENT }),
    dr.evaluateIssue({ labels, comments: [ruling(AGENT)] }));
  assert.strictEqual(dr.evaluateIssue({ labels, comments: [ruling(HUMAN)], trust: TRUST }).recorded, true);
});

test('ruling pair: an agent-posted ⚖ record beside needs-decision is no pair — the question stays open', () => {
  const pair = dr.pairVerdict({ labels: ['needs-decision'], comments: [ruling(AGENT)], trust: TRUST });
  assert.strictEqual(pair, null);
  assert.deepStrictEqual(dr.answeredOptionRefs([comment(dr.decisionCommentBody('boss', 'issuecomment-1', HOST, NOW), { login: AGENT })], TRUST), []);
});
