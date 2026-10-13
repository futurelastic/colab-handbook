'use strict';
/**
 * #596 — the owner-level migration-grant record: the pure record reading (who counts, latest wins,
 * unset). Retired as a resolution rung by #598; `colab owner-policy show` still reads it.
 * The CLI wiring is in grant-policy-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const op = require('./owner-policy.js');
const trustHumans = require('./trust-humans.js');

const mark = (value, o = {}) => ({
  body: op.markerBody('migration-grant', value, 'box', o.at || '2026-10-12T00:00:00Z'),
  user: { login: o.login || 'boss' }, author_association: 'assoc' in o ? o.assoc : 'OWNER', created_at: o.at || '2026-10-12T00:00:00Z',
});

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

// The precedence and the ship rule moved with the resolver to grant-policy.test.js (#598): the owner
// record is no longer a rung. These tests keep the record reader `colab owner-policy show` uses.
