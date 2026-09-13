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

// --- looksLikeSessionId (#306) --------------------------------------------------------------
// The ONE shape rule in the tree. `parseSessionField` (tools/colab) decodes claim comments with
// it and `warnWeakIdentity` warns with it; these cases pin both at once. It is a WARNING
// heuristic, never a gate — see the function's own doc comment.

test('looksLikeSessionId: a real session URL, and a bare session_ token, both pass', () => {
  assert.strictEqual(ci.looksLikeSessionId('https://claude.ai/code/session_017GKdaNPELs2mtKPDCasha1'), true);
  assert.strictEqual(ci.looksLikeSessionId('http://example.invalid/x'), true);
  assert.strictEqual(ci.looksLikeSessionId('session_017abc-DEF'), true);
});

test('looksLikeSessionId: a session NAME in the URL slot fails — the #306 live case', () => {
  assert.strictEqual(ci.looksLikeSessionId('ops-coding-dashboard-1480'), false);
  assert.strictEqual(ci.looksLikeSessionId('colab-handbook-305-306'), false);
});

test('looksLikeSessionId: blank/null are false — absence is #11/#242 territory, not this predicate', () => {
  assert.strictEqual(ci.looksLikeSessionId(''), false);
  assert.strictEqual(ci.looksLikeSessionId('   '), false);
  assert.strictEqual(ci.looksLikeSessionId(null), false);
  assert.strictEqual(ci.looksLikeSessionId(undefined), false);
});

test('looksLikeSessionId: a bare stable id is FALSE but must stay usable — this is a warning, not a gate', () => {
  // The fleet, and six of this repo's own fixtures, pass ids like these. `requirePlaceIdentity`
  // promises `<url-or-any-stable-id>`; nothing may turn this false into a refusal.
  assert.strictEqual(ci.looksLikeSessionId('sess-OTHER'), false);
  assert.strictEqual(ci.looksLikeSessionId('sess-plan-journal-test'), false);
});

// --- #327: machine identity — one machine is one claimant however its hostname is spelled ------

const machine = require('./machine');

test('#327 sameHost: two spellings of one hostname are one machine', () => {
  assert.strictEqual(ci.sameHost({ host: 'Box.local.' }, { host: 'box' }), true);
  assert.strictEqual(ci.sameHost({ host: 'box.lan' }, { host: 'box.local' }), true);
  assert.strictEqual(ci.sameHost({ host: 'box' }, { host: 'crate' }), false);
  assert.strictEqual(ci.sameHost({}, {}), true, 'blank on both sides stays equal, as before #327');
});

test('#327 sameHost: machine ids decide when both sides carry one — a hostname cannot override them', () => {
  assert.strictEqual(ci.sameHost({ host: 'box', machine: 'iokit:A' }, { host: 'box', machine: 'iokit:B' }), false);
  assert.strictEqual(ci.sameHost({ host: 'oldname', machine: 'iokit:A' }, { host: 'newname', machine: 'iokit:A' }), true);
});

test('#327 sameHost: a claim comment digest compares equal to the raw id it was made from, and only to it', () => {
  const tok = machine.machineToken('iokit:A');
  assert.match(tok, /^m:[0-9a-f]{12}$/);
  assert.strictEqual(ci.sameHost({ host: 'x', machine: tok }, { host: 'y', machine: 'iokit:A' }), true);
  assert.strictEqual(ci.sameHost({ host: 'box', machine: tok }, { host: 'box', machine: 'iokit:B' }), false);
});

test('#327 sameHost: raw ids of DIFFERENT schemes cannot be compared → canonical hostname decides', () => {
  assert.strictEqual(ci.sameHost({ host: 'box.local', machine: 'iokit:A' }, { host: 'box', machine: 'mac:abc' }), true);
  assert.strictEqual(ci.sameHost({ host: 'crate', machine: 'iokit:A' }, { host: 'box', machine: 'mac:abc' }), false);
});

test('#327 sameHost: a legacy record (no machine id) is compared by canonical hostname', () => {
  assert.strictEqual(ci.sameHost({ host: 'BOX.local' }, { host: 'box', machine: 'iokit:A' }), true);
  assert.strictEqual(ci.sameHost({ host: 'crate' }, { host: 'box', machine: 'iokit:A' }), false);
});

test('#327 sameClaimant: login plus canonical machine — two spellings never read as two claimants', () => {
  assert.strictEqual(ci.sameClaimant({ login: 'me', host: 'Box.local.' }, { login: 'me', host: 'box' }, ci.DEFAULT_COMPONENTS), true);
  assert.strictEqual(ci.sameClaimant(
    { login: 'me', host: 'box', machine: 'iokit:A' }, { login: 'me', host: 'box', machine: 'iokit:B' }, ci.DEFAULT_COMPONENTS), false);
  assert.strictEqual(ci.sameClaimant({ login: 'me', host: 'box' }, { login: 'you', host: 'box' }, ci.DEFAULT_COMPONENTS), false);
});

test('#327 machineToken: idempotent on a token, blank on blank, never the raw id', () => {
  const tok = machine.machineToken('iokit:1234-ABCD');
  assert.strictEqual(machine.machineToken(tok), tok);
  assert.ok(!tok.includes('1234'));
  assert.strictEqual(machine.machineToken(''), '');
  assert.strictEqual(machine.machineToken(null), '');
});

// --- #326: planner intent ids --------------------------------------------------------------------

test('#326 isIntentSession: only the `intent:<id>` shape', () => {
  assert.strictEqual(ci.isIntentSession('intent:plan-42'), true);
  assert.strictEqual(ci.isIntentSession('  intent:x '), true);
  assert.strictEqual(ci.isIntentSession('intent:'), false);
  assert.strictEqual(ci.isIntentSession('https://claude.ai/code/session_abc'), false);
  assert.strictEqual(ci.isIntentSession(''), false);
  assert.strictEqual(ci.isIntentSession(null), false);
});

test('#326 sameClaimant: an intent id is never a DIFFERENT session under the fine setting — the spawn replaces it', () => {
  const fine = ci.FINE_COMPONENTS;
  assert.strictEqual(ci.sameClaimant(
    { login: 'me', host: 'box', session: 'intent:p1' }, { login: 'me', host: 'box', session: 'https://x/session_abc' }, fine), true);
  assert.strictEqual(ci.sameClaimant({ login: 'me', host: 'box', session: 's1' }, { login: 'me', host: 'box', session: 's2' }, fine), false);
  assert.strictEqual(ci.sameClaimant(
    { login: 'me', host: 'box', machine: 'iokit:A', session: 'intent:p1' }, { login: 'me', host: 'box', machine: 'iokit:B', session: 's1' }, fine),
  false, 'an intent id relaxes only the session compare, never the machine');
});
