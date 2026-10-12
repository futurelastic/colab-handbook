'use strict';
/**
 * #596 — the owner-level migration-grant value: the pure record reading (who counts, latest wins,
 * unset), the three-level precedence, and the ship rule fed with the resolved policy.
 * The CLI wiring (mint, set, show) is in owner-policy-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const op = require('./owner-policy.js');
const mg = require('./migration-grant.js');
const trustHumans = require('./trust-humans.js');

const mark = (value, o = {}) => ({
  body: op.markerBody('migration-grant', value, 'box', o.at || '2026-10-12T00:00:00Z'),
  user: { login: o.login || 'boss' }, author_association: 'assoc' in o ? o.assoc : 'OWNER', created_at: o.at || '2026-10-12T00:00:00Z',
});
const repo = (doc) => mg.parseGrantPolicy(doc);
const ownerOk = (value, by = 'boss', at = '2026-10-12T00:00:00Z') => ({ read: 'ok', owner: 'acme', issue: 1, set: true, value, by, at, ignored: [] });

// ---- the record -------------------------------------------------------------------------------

test('a marker from the owner sets the value; who and when are carried', () => {
  const v = op.ownerValue([mark('reviewer')], 'migration-grant', null);
  assert.deepEqual([v.set, v.value, v.by, v.at], [true, 'reviewer', 'boss', '2026-10-12T00:00:00Z']);
});

test('latest trusted marker wins; unset withdraws; GraphQL comment shape reads too', () => {
  const later = { body: op.markerBody('migration-grant', 'unset', 'box', 'x'), author: { login: 'boss' }, authorAssociation: 'MEMBER', createdAt: '2026-10-13T00:00:00Z' };
  assert.equal(op.ownerValue([mark('reviewer'), later], 'migration-grant', null).set, false);
  const v = op.ownerValue([later, mark('human', { at: '2026-10-14T00:00:00Z' })], 'migration-grant', null);
  assert.equal(v.value, 'human');
});

test('a marker by a collaborator or outsider is ignored and reported, never honoured', () => {
  for (const assoc of ['COLLABORATOR', 'CONTRIBUTOR', 'NONE', '']) {
    const v = op.ownerValue([mark('reviewer', { login: 'agent', assoc })], 'migration-grant', null);
    assert.equal(v.set, false, assoc);
    assert.equal(v.ignored.length, 1);
    assert.match(v.ignored[0].reason, /not the owner or an org member/);
  }
});

test('trust-humans on the judged repo: an unlisted member marker is ignored, a listed one counts', () => {
  const trust = trustHumans.parseTrustHumans({ 'trust-humans': ['boss'] });
  const bot = mark('reviewer', { login: 'agent-bot', assoc: 'MEMBER', at: '2026-10-13T00:00:00Z' });
  const v = op.ownerValue([mark('human'), bot], 'migration-grant', trust);
  assert.equal(v.value, 'human', 'the later agent marker does not override the human one');
  assert.match(v.ignored[0].reason, /not listed in trust-humans/);
});

test('an unknown value or another key is not read as migration-grant', () => {
  const bad = { body: '<!-- colab:owner-policy key=migration-grant value=yes -->', user: { login: 'boss' }, author_association: 'OWNER', created_at: 'z' };
  const other = { body: '<!-- colab:owner-policy key=ci-grant value=reviewer -->', user: { login: 'boss' }, author_association: 'OWNER', created_at: 'z' };
  const v = op.ownerValue([bad, other], 'migration-grant', null);
  assert.equal(v.set, false);
  assert.equal(v.ignored.length, 1);
  assert.throws(() => op.markerBody('ci-grant', 'reviewer', 'h', 'i'));
});

// ---- precedence -------------------------------------------------------------------------------

test('no repo key + owner reviewer → reviewer, source owner, naming who set it', () => {
  const r = op.resolveGrantPolicy(repo({}), ownerOk('reviewer'));
  assert.deepEqual([r.policy, r.source, r.valid, r.declared], ['reviewer', 'owner', true, false]);
  assert.match(r.reason, /owner-level migration-grant: reviewer .*acme\/\.github by boss at 2026-10-12/);
  assert.equal(op.sourceLabel(r), 'owner (boss at 2026-10-12T00:00:00Z)');
});

test('repo human + owner reviewer → human, source repo, opted out — the reason says so', () => {
  const r = op.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), ownerOk('reviewer'));
  assert.deepEqual([r.policy, r.source, r.optedOut], ['human', 'repo', true]);
  assert.match(r.reason, /opted out/);
});

test('repo reviewer wins over owner human; repo human + owner human is not an opt-out', () => {
  const a = op.resolveGrantPolicy(repo({ 'migration-grant': 'reviewer' }), ownerOk('human'));
  assert.deepEqual([a.policy, a.source], ['reviewer', 'repo']);
  const b = op.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), ownerOk('human'));
  assert.equal(b.optedOut, false);
});

test('no owner value → every pre-#596 field identical to parseGrantPolicy, source default/repo', () => {
  for (const doc of [{}, { 'migration-grant': 'human' }, { 'migration-grant': 'reviewer' }, { 'migration-grant': 'bogus' }]) {
    const base = repo(doc);
    for (const owner of [null, { read: 'none', set: false }, { read: 'ok', set: false }]) {
      const r = op.resolveGrantPolicy(base, owner);
      for (const k of ['policy', 'declared', 'valid', 'reason']) assert.deepEqual(r[k], base[k], `${JSON.stringify(doc)} ${k}`);
      assert.equal(r.source, base.declared ? 'repo' : 'default');
      assert.equal(r.ownerNote, '');
    }
  }
});

test('an unreadable owner record fails closed to the default, with a note', () => {
  const r = op.resolveGrantPolicy(repo({}), { read: 'unread', why: 'HTTP 502' });
  assert.deepEqual([r.policy, r.source], ['human', 'default']);
  assert.match(r.ownerNote, /could not be read \(HTTP 502\)/);
});

// ---- the ship rule, fed the resolved policy ------------------------------------------------------

const LABEL = 'migration-granted';
const BRANCH = 'feat/schema-change-1';
const HEAD = 'a'.repeat(40);
const reviewRec = () => ({ v: '1', role: 'migration-reviewer', reviewer: 'bot-a', head: HEAD, verdict: 'approve', checklist: 'pass',
  'checklist-items': '7/7', escalation: 'destructive-ddl', 'escalation-result': 'clear', 'ci-roundtrip': 'pass' });
const issue = { state: 'OPEN', labels: [{ name: LABEL }],
  comments: [{ body: mg.reviewGrantCommentBody(BRANCH, 'box', '2026-10-12T00:00:00Z', reviewRec()), createdAt: '2026-10-12T00:00:00Z', author: { login: 'boss' }, authorAssociation: 'MEMBER' }] };
const shipCtx = (pres) => ({ policy: pres.policy, policyReason: pres.source === 'owner' || pres.optedOut || pres.ownerNote ? pres.reason : null,
  headSha: HEAD, roundtrip: () => ({ ok: true, reason: '' }) });

test('ship: no repo key + owner reviewer → a passing reviewer grant ships', () => {
  const v = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(op.resolveGrantPolicy(repo({}), ownerOk('reviewer'))));
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted[0].role, 'reviewer');
});

test('ship: repo human + owner reviewer → refused on P, and the reason says the repo opted out', () => {
  const v = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(op.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), ownerOk('reviewer'))));
  assert.equal(v.ok, false);
  assert.equal(v.missing[0].failed, 'policy');
  assert.match(v.missing[0].reason, /opted out/);
});

test('ship: no owner value → the P refusal text is the pre-#596 one, byte for byte', () => {
  const before = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, { policy: 'human', headSha: HEAD, roundtrip: () => ({ ok: true }) });
  const after = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(op.resolveGrantPolicy(repo({}), { read: 'none', set: false })));
  assert.deepEqual(after, before);
});
