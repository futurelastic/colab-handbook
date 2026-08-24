'use strict';
/**
 * Unit tests for tools/lib/claim-identity.js — the shared shape #264 (writer) and #267 (readers)
 * both apply. Pure functions, no gh/git/fs — see the module doc for the two field classes and the
 * degrade-on-missing rule these tests pin.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const ci = require('./claim-identity');

test('components: absent config → coarse default [login, host]', () => {
  assert.deepStrictEqual(ci.components({}), ['login', 'host']);
  assert.deepStrictEqual(ci.components(undefined), ['login', 'host']);
});

test('components: "login,host,session" → the fine set', () => {
  assert.deepStrictEqual(ci.components({ claimIdentity: 'login,host,session' }), ['login', 'host', 'session']);
});

test('components: an unrecognised value degrades to coarse, never throws', () => {
  assert.doesNotThrow(() => ci.components({ claimIdentity: 'garbage' }));
  assert.deepStrictEqual(ci.components({ claimIdentity: 'garbage' }), ['login', 'host']);
  assert.deepStrictEqual(ci.components({ claimIdentity: '' }), ['login', 'host']);
});

test('claimIdentityProblem: accepts the two valid values and "" (unset)', () => {
  assert.strictEqual(ci.claimIdentityProblem('login,host'), null);
  assert.strictEqual(ci.claimIdentityProblem('login,host,session'), null);
  assert.strictEqual(ci.claimIdentityProblem(''), null);
});

test('claimIdentityProblem: rejects a typo with a UserError-shaped message', () => {
  const problem = ci.claimIdentityProblem('login,host,sesion');
  assert.ok(problem && /claimIdentity must be/.test(problem), problem);
});

test('identityString: coarse form is login@host regardless of session', () => {
  const entry = { login: 'me', host: 'h1', session: 'session_abc' };
  assert.strictEqual(ci.identityString(entry, ['login', 'host']), 'me@h1');
});

test('identityString: fine form appends #session only when the entry carries one', () => {
  const withSession = { login: 'me', host: 'h1', session: 'session_abc' };
  const noSession = { login: 'me', host: 'h1', session: '' };
  assert.strictEqual(ci.identityString(withSession, ['login', 'host', 'session']), 'me@h1#session_abc');
  // A blank session must not produce a trailing "#" — that would misrepresent a legacy comment.
  assert.strictEqual(ci.identityString(noSession, ['login', 'host', 'session']), 'me@h1');
});

test('sameClaimant: coarse — same login+host is the same claimant, session ignored', () => {
  const a = { login: 'me', host: 'h1', session: 'session_A' };
  const b = { login: 'me', host: 'h1', session: 'session_B' };
  assert.strictEqual(ci.sameClaimant(a, b, ['login', 'host']), true);
});

test('sameClaimant: fine — same login+host but DIFFERENT sessions is NOT the same claimant', () => {
  const a = { login: 'me', host: 'h1', session: 'session_A' };
  const b = { login: 'me', host: 'h1', session: 'session_B' };
  assert.strictEqual(ci.sameClaimant(a, b, ['login', 'host', 'session']), false);
});

test('sameClaimant: fine — one side has NO session degrades that pair back to coarse (degrade-on-missing)', () => {
  const withSession = { login: 'me', host: 'h1', session: 'session_A' };
  const noSession = { login: 'me', host: 'h1', session: '' };
  assert.strictEqual(ci.sameClaimant(withSession, noSession, ['login', 'host', 'session']), true);
  assert.strictEqual(ci.sameClaimant(noSession, withSession, ['login', 'host', 'session']), true);
  // Both sides missing a session degrades the same way.
  const alsoNoSession = { login: 'me', host: 'h1', session: '' };
  assert.strictEqual(ci.sameClaimant(noSession, alsoNoSession, ['login', 'host', 'session']), true);
});

test('sameClaimant: different login or host is never the same claimant, under either setting', () => {
  const a = { login: 'me', host: 'h1', session: 'session_A' };
  const diffLogin = { login: 'other', host: 'h1', session: 'session_A' };
  const diffHost = { login: 'me', host: 'h2', session: 'session_A' };
  assert.strictEqual(ci.sameClaimant(a, diffLogin, ['login', 'host']), false);
  assert.strictEqual(ci.sameClaimant(a, diffHost, ['login', 'host', 'session']), false);
});

test('mergeClaimRecord: blank incoming branch keeps a known existing branch when sameHolder', () => {
  const existing = { branch: 'fix/known-123', session: 's1', sessionName: 'n1', worktree: 'wt' };
  const incoming = { branch: null, session: '', sessionName: '', worktree: 'wt' };
  const merged = ci.mergeClaimRecord(existing, incoming, { sameHolder: true });
  assert.strictEqual(merged.branch, 'fix/known-123');
  assert.strictEqual(merged.session, 's1');
  assert.strictEqual(merged.sessionName, 'n1');
});

test('mergeClaimRecord: an explicit incoming branch always overwrites', () => {
  const existing = { branch: 'fix/old-123', session: 's1', sessionName: 'n1', worktree: 'wt' };
  const incoming = { branch: 'fix/new-123', session: '', sessionName: '', worktree: 'wt' };
  const merged = ci.mergeClaimRecord(existing, incoming, { sameHolder: true });
  assert.strictEqual(merged.branch, 'fix/new-123');
  // session/sessionName still inherited — only branch was supplied explicitly this call
  assert.strictEqual(merged.session, 's1');
});

test('mergeClaimRecord: a --force takeover (sameHolder:false) does NOT inherit branch or session', () => {
  const existing = { branch: 'fix/known-123', session: 's1', sessionName: 'n1', worktree: 'wt' };
  const incoming = { branch: null, session: '', sessionName: '', worktree: null };
  const merged = ci.mergeClaimRecord(existing, incoming, { sameHolder: false });
  assert.strictEqual(merged.branch, null);
  assert.strictEqual(merged.session, '');
  assert.strictEqual(merged.sessionName, '');
});

test('mergeClaimRecord: worktree is never inherited from existing, even when sameHolder', () => {
  const existing = { branch: 'fix/known-123', session: 's1', sessionName: 'n1', worktree: 'wt-old' };
  const incoming = { branch: null, session: '', sessionName: '', worktree: null };
  const merged = ci.mergeClaimRecord(existing, incoming, { sameHolder: true });
  assert.strictEqual(merged.worktree, null);
});

test('mergeClaimRecord: no existing record — incoming passes through unchanged', () => {
  const incoming = { branch: null, session: '', sessionName: '', worktree: 'wt' };
  const merged = ci.mergeClaimRecord(null, incoming, { sameHolder: true });
  assert.deepStrictEqual(merged, incoming);
});
