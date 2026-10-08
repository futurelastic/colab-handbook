'use strict';
/**
 * Tests for the migration-grant marker (tools/lib/migration-grant.js, #98).
 *
 * Pure cases only — no git, no gh, no network. The subprocess/CLI half (the two `colab ship`
 * call sites, the `colab migration-grant` command, and the human-only enforcement) lives in
 * tools/lib/ship-migration-grant.test.js instead, because THIS module is deliberately built so
 * the safety-relevant decision can be pinned without a live `gh`.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet,
} = require('./migration-grant.js');

const HOST = 'build-box-01';
const NOW = '2026-08-02T10:00:00Z';
const LATER = '2026-08-02T11:00:00Z';
const LATEST = '2026-08-02T12:00:00Z';
const LABEL = 'migration-granted';

function comment(body, { createdAt = NOW, login = 'vo2vo', authorAssociation = 'MEMBER' } = {}) {
  return { body, createdAt, author: { login }, authorAssociation };
}

function grantComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(grantCommentBody(branch, opts.host || HOST, at), { ...opts, createdAt: at });
}

function revokeComment(branch, opts = {}) {
  const at = opts.at || NOW;
  return comment(revokeCommentBody(branch, opts.host || HOST, at), { ...opts, createdAt: at });
}

function openRecord({ labels = [LABEL], comments = [] } = {}) {
  return { state: 'OPEN', labels: labels.map((n) => ({ name: n })), comments };
}

// --- marker bodies round-trip through their own regex --------------------------------------

test('grantCommentBody round-trips through GRANT_RE, including a branch with / and -', () => {
  const body = grantCommentBody('feat/import-fixes-115-114-113', HOST, NOW);
  const m = body.match(GRANT_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'feat/import-fixes-115-114-113');
  assert.equal(m[2], HOST);
  assert.equal(m[3], NOW);
  assert.match(body, /THIS BRANCH only/);
});

test('revokeCommentBody round-trips through REVOKE_RE', () => {
  const body = revokeCommentBody('feat/x-1', HOST, NOW);
  const m = body.match(REVOKE_RE);
  assert.ok(m, body);
  assert.equal(m[1], 'feat/x-1');
  assert.equal(m[2], HOST);
  assert.equal(m[3], NOW);
});

test('GRANT_MARK and REVOKE_MARK never collide — a revoke body does not match GRANT_RE and vice versa', () => {
  const grant = grantCommentBody('feat/x-1', HOST, NOW);
  const revoke = revokeCommentBody('feat/x-1', HOST, NOW);
  assert.ok(!revoke.match(GRANT_RE), 'revoke body must never parse as a grant');
  assert.ok(!grant.match(REVOKE_RE), 'grant body must never parse as a revoke');
  // Compare full Unicode code points, not UTF-16 code units: both emoji sit in the same
  // astral-plane block (U+1F680-U+1F6FF, "Transport and Map Symbols") and SHARE a high
  // surrogate, so `GRANT_MARK[0] !== REVOKE_MARK[0]` would be a false positive here.
  assert.notEqual(GRANT_MARK.codePointAt(0), REVOKE_MARK.codePointAt(0),
    'the two marks must lead with different emoji code points');
});

// --- liveGrants: live / cancelled / revived resolution --------------------------------------

test('liveGrants: a lone grant comment is live', () => {
  const live = liveGrants([grantComment('feat/x-1')]);
  assert.equal(live.length, 1);
  assert.equal(live[0].branch, 'feat/x-1');
  assert.equal(live[0].login, 'vo2vo');
  assert.equal(live[0].authorAssociation, 'MEMBER');
});

test('liveGrants: a grant followed by a LATER revoke is cancelled', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW }),
    revokeComment('feat/x-1', { at: LATER }),
  ]);
  assert.equal(live.length, 0);
});

test('liveGrants: grant, revoke, then a LATER grant is live again', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW }),
    revokeComment('feat/x-1', { at: LATER }),
    grantComment('feat/x-1', { at: LATEST }),
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0].at, LATEST);
});

test('liveGrants: revocation is NOT author-scoped — a different login can cancel', () => {
  const live = liveGrants([
    grantComment('feat/x-1', { at: NOW, login: 'alice' }),
    revokeComment('feat/x-1', { at: LATER, login: 'bob' }),
  ]);
  assert.equal(live.length, 0, 'a revoke from a different identity must still cancel — no race to protect here');
});

test('liveGrants: resolution is by createdAt, not array order', () => {
  // revoke appears FIRST in the array but its timestamp is EARLIER — the grant must still be live.
  const live = liveGrants([
    revokeComment('feat/x-1', { at: NOW }),
    grantComment('feat/x-1', { at: LATER }),
  ]);
  assert.equal(live.length, 1);
});

test('liveGrants tolerates missing/malformed input', () => {
  assert.deepStrictEqual(liveGrants([]), []);
  assert.deepStrictEqual(liveGrants(null), []);
  assert.deepStrictEqual(liveGrants(undefined), []);
  assert.deepStrictEqual(liveGrants([{ body: 'unrelated comment', createdAt: NOW }]), []);
});

// --- evaluateIssue: branch binding, expiry, label, author trust ------------------------------

test('evaluateIssue: a failed read (null record) is never a grant', () => {
  const v = evaluateIssue(null, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not be read/);
});

test('evaluateIssue: a fully valid grant on the right branch reads ok', () => {
  const record = openRecord({ comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.grant.branch, 'feat/x-1');
});

test('evaluateIssue (req 2 — branch binding): a grant for one branch does not authorize another', () => {
  const record = openRecord({ comments: [grantComment('feat/a-1')] });
  const v = evaluateIssue(record, 'feat/b-2', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /feat\/a-1/);
  assert.match(v.reason, /feat\/b-2|not "feat\/b-2"/);
});

test('evaluateIssue (req 3 — expiry): a closed issue never reads granted, even with a live comment + label', () => {
  const record = { ...openRecord({ comments: [grantComment('feat/x-1')] }), state: 'CLOSED' };
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /closed|CLOSED/i);
});

test('evaluateIssue: label required — a live comment with the label absent still refuses', () => {
  const record = openRecord({ labels: [], comments: [grantComment('feat/x-1')] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(LABEL));
});

test('evaluateIssue: the label present with no live grant comment still refuses', () => {
  const record = openRecord({ comments: [] });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue: a revoked grant (label still on) refuses', () => {
  const record = openRecord({
    comments: [grantComment('feat/x-1', { at: NOW }), revokeComment('feat/x-1', { at: LATER })],
  });
  const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
});

test('evaluateIssue (author trust): NONE and CONTRIBUTOR are rejected, naming the association', () => {
  for (const assoc of ['NONE', 'CONTRIBUTOR']) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
    assert.equal(v.ok, false, assoc);
    assert.match(v.reason, new RegExp(assoc));
  }
});

test('evaluateIssue (author trust): OWNER, MEMBER, COLLABORATOR are all accepted', () => {
  for (const assoc of [...TRUSTED_ASSOCIATIONS]) {
    const record = openRecord({ comments: [grantComment('feat/x-1', { authorAssociation: assoc })] });
    const v = evaluateIssue(record, 'feat/x-1', 98, LABEL);
    assert.equal(v.ok, true, `${assoc}: ${v.reason}`);
  }
});

// --- evaluateShipSet: requirement 5 (group branch) + non-vacuity -----------------------------

test('evaluateShipSet (req 5): three issues, two granted and one not — refuses, naming exactly the ungranted one', () => {
  const branch = 'feat/schema-98-99-100';
  const records = {
    98: openRecord({ comments: [grantComment(branch)] }),
    99: openRecord({ comments: [grantComment(branch)] }),
    100: openRecord({ comments: [] }), // no grant
  };
  const v = evaluateShipSet([98, 99, 100], records, branch, LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [100]);
  assert.equal(v.granted.length, 2);
});

test('evaluateShipSet (req 5): flipping the third issue to granted makes the whole set ok', () => {
  const branch = 'feat/schema-98-99-100';
  const records = {
    98: openRecord({ comments: [grantComment(branch)] }),
    99: openRecord({ comments: [grantComment(branch)] }),
    100: openRecord({ comments: [grantComment(branch)] }),
  };
  const v = evaluateShipSet([98, 99, 100], records, branch, LABEL);
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted.length, 3);
});

test('evaluateShipSet: non-vacuity — zero claimed issues never reads granted by default', () => {
  const v = evaluateShipSet([], {}, 'feat/x-1', LABEL);
  assert.equal(v.ok, false);
  assert.match(v.missing[0].reason, /no claimed issue/);
});

test('evaluateShipSet tolerates a null issues array the same way', () => {
  const v = evaluateShipSet(null, {}, 'feat/x-1', LABEL);
  assert.equal(v.ok, false);
});

test('evaluateShipSet: a failed read for one issue in the set is reported, never silently granted', () => {
  const branch = 'feat/x-1-2';
  const records = { 1: openRecord({ comments: [grantComment(branch)] }), 2: null };
  const v = evaluateShipSet([1, 2], records, branch, LABEL);
  assert.equal(v.ok, false);
  assert.deepStrictEqual(v.missing.map((m) => m.issue), [2]);
  assert.match(v.missing[0].reason, /could not be read/);
});

// --- #397 role-tagged grants · #398 policy ---------------------------------------------------

const mg = require('./migration-grant.js');

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const BRANCH = 'feat/schema-change-1';

function rec(over = {}) {
  return {
    v: '1', role: 'migration-reviewer', reviewer: 'bot-a', head: HEAD,
    verdict: 'approve', checklist: 'pass', 'checklist-items': '7/7',
    escalation: 'destructive-ddl', 'escalation-result': 'clear', 'ci-roundtrip': 'pass', ...over,
  };
}

function reviewComment(r = rec(), opts = {}) {
  const at = opts.at || NOW;
  return comment(mg.reviewGrantCommentBody(opts.branch || BRANCH, opts.host || HOST, at, r), { ...opts, createdAt: at });
}

const CTX = { branch: BRANCH, headSha: HEAD, issueNum: 1, labelName: LABEL, policy: 'reviewer' };

test('reviewGrantCommentBody round-trips through REVIEW_GRANT_RE + parseReviewGrant', () => {
  const body = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec({ 'ci-run': 'https://ci.example.invalid/run/9' }));
  const p = mg.parseReviewGrant(body);
  assert.ok(p, body);
  assert.deepEqual(p.problems, []);
  assert.equal(p.marker.role, 'migration-reviewer');
  assert.equal(p.marker.reviewer, 'bot-a');
  assert.equal(p.marker.branch, BRANCH);
  assert.equal(p.marker.head, HEAD);
  assert.equal(p.record['ci-run'], 'https://ci.example.invalid/run/9');
  assert.match(body, /any new commit voids it/);
});

test('three-way mark collision: grant / revoke / review bodies match only their own RE', () => {
  const g = grantCommentBody(BRANCH, HOST, NOW);
  const r = revokeCommentBody(BRANCH, HOST, NOW);
  const v = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec());
  assert.ok(GRANT_RE.test(g) && !REVOKE_RE.test(g) && !mg.REVIEW_GRANT_RE.test(g));
  assert.ok(!GRANT_RE.test(r) && REVOKE_RE.test(r) && !mg.REVIEW_GRANT_RE.test(r));
  assert.ok(!GRANT_RE.test(v) && !REVOKE_RE.test(v) && mg.REVIEW_GRANT_RE.test(v));
});

test('the human grant body is unchanged and reads as role human', () => {
  assert.equal(grantCommentBody('feat/x-1', HOST, NOW),
    '🛢 Migration grant — branch `feat/x-1` · host `build-box-01` · 2026-08-02T10:00:00Z — this exempts THIS BRANCH only, and expires when this issue closes.');
  const live = mg.liveGrantRecords([grantComment('feat/x-1')]);
  assert.equal(live.length, 1);
  assert.equal(live[0].role, 'human');
});

test('liveGrants ignores reviewer grants — the ship gate is unchanged', () => {
  assert.deepEqual(liveGrants([reviewComment()]), []);
});

test('evaluateIssue: the label plus only a reviewer grant refuses (no live human grant)', () => {
  const v = evaluateIssue(openRecord({ comments: [reviewComment()] }), BRANCH, 1, LABEL);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no live grant comment/);
  const s = evaluateShipSet([1], { 1: openRecord({ comments: [reviewComment()] }) }, BRANCH, LABEL);
  assert.equal(s.ok, false);
});

test('a revoke cancels an earlier reviewer grant; a later one is live again', () => {
  const c = [reviewComment(rec(), { at: NOW }), revokeComment(BRANCH, { at: LATER })];
  assert.equal(mg.liveGrantRecords(c).length, 0);
  assert.equal(mg.evaluateReviewerGrant(openRecord({ comments: c }), CTX).ok, false);
  c.push(reviewComment(rec(), { at: LATEST }));
  assert.equal(mg.evaluateReviewerGrant(openRecord({ comments: c }), CTX).ok, true);
});

test('validateReviewRecord: missing key, unknown key, bad enum, bad sha → problems', () => {
  const cases = [
    [(() => { const r = rec(); delete r.verdict; return r; })(), /missing "verdict"/],
    [rec({ extra: 'x' }), /unknown key "extra"/],
    [rec({ verdict: 'yes' }), /"verdict" is "yes"/],
    [rec({ head: 'abc1234' }), /"head" is "abc1234"/],
    [rec({ reviewer: 'has space' }), /"reviewer"/],
    [rec({ 'checklist-items': '8/7' }), /N must be ≤ M/],
    [rec({ v: '2' }), /"v" is "2"/],
  ];
  for (const [r, rx] of cases) {
    const v = mg.validateReviewRecord(r);
    assert.equal(v.valid, false, JSON.stringify(r));
    assert.ok(v.problems.some((p) => rx.test(p)), `${rx}: ${v.problems.join(' | ')}`);
  }
  assert.deepEqual(mg.validateReviewRecord(rec()), { valid: true, passing: true, problems: [] });
});

test('validateReviewRecord: a well-formed failing review is valid but not passing', () => {
  for (const over of [{ verdict: 'reject' }, { checklist: 'fail' }, { 'escalation-result': 'escalated' }, { 'ci-roundtrip': 'pending' }]) {
    const v = mg.validateReviewRecord(rec(over));
    assert.equal(v.valid, true, JSON.stringify(over));
    assert.equal(v.passing, false, JSON.stringify(over));
    assert.ok(mg.reviewRecordFailure(rec(over)).length > 0);
  }
});

test('parseReviewGrant: record head or reviewer differing from the marker is a problem', () => {
  const body = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()).replace(`head: ${HEAD}`, `head: ${HEAD2}`);
  assert.ok(mg.parseReviewGrant(body).problems.some((p) => /differs from the marker's head/.test(p)));
  const body2 = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()).replace('reviewer: bot-a', 'reviewer: bot-b');
  assert.ok(mg.parseReviewGrant(body2).problems.some((p) => /differs from the marker's reviewer/.test(p)));
});

test('parseReviewGrant: a marker with no record block is a problem, never a grant', () => {
  const firstLine = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()).split('\n')[0];
  const p = mg.parseReviewGrant(firstLine);
  assert.equal(p.record, null);
  assert.match(p.problems[0], /without its review record/);
  const v = mg.evaluateReviewerGrant(openRecord({ comments: [comment(firstLine)] }), CTX);
  assert.equal(v.ok, false);
  assert.match(v.reason, /invalid review record/);
});

test('parseReviewGrant: text outside the fenced block is ignored; a duplicate key is a problem', () => {
  const body = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()) + '\n\nnotes: verdict: reject';
  assert.deepEqual(mg.parseReviewGrant(body).problems, []);
  const dup = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()).replace('verdict: approve', 'verdict: approve\nverdict: reject');
  assert.ok(mg.parseReviewGrant(dup).problems.some((p) => /appears twice/.test(p)));
});

test('grantHeadBinding: equal → ok; new commit → void; short/missing sha → not ok; human → unbound', () => {
  const g = { role: 'migration-reviewer', head: HEAD };
  assert.deepEqual(mg.grantHeadBinding(g, HEAD), { bound: true, ok: true, via: 'head', reason: '' });
  assert.deepEqual(mg.grantHeadBinding(g, HEAD.toUpperCase()).ok, true);
  const moved = mg.grantHeadBinding(g, HEAD2);
  assert.equal(moved.ok, false);
  assert.match(moved.reason, /a new commit voids it/);
  assert.equal(mg.grantHeadBinding(g, HEAD.slice(0, 7)).ok, false);
  assert.equal(mg.grantHeadBinding(g, '').ok, false);
  assert.deepEqual(mg.grantHeadBinding({ role: 'human', branch: 'x' }, ''), { bound: false, ok: true, via: null, reason: '' });
  // A record with no `migrations` id stays HEAD-bound even when a content id is offered (#508).
  assert.equal(mg.grantHeadBinding(g, HEAD2, 'a'.repeat(64)).ok, false);
});

// ── #508: bind to the reviewed migration content, not the HEAD ─────────────────────────────────
const BLOB_A = '1'.repeat(40);
const BLOB_B = '2'.repeat(40);
const MIG = [{ path: 'db/migrations/0001_init.sql', blob: BLOB_A }, { path: 'db/migrations/0002_add.sql', blob: BLOB_B }];

test('migrationContentId: order-independent; any path or blob change moves it; empty/unreadable → null', () => {
  const id = mg.migrationContentId(MIG);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(mg.migrationContentId([...MIG].reverse()), id, 'listing order is not content');
  assert.equal(mg.migrationContentId(MIG.map((e) => ({ ...e, blob: e.blob.toUpperCase() }))), id);
  assert.notEqual(mg.migrationContentId([MIG[0], { ...MIG[1], blob: '3'.repeat(40) }]), id, 'an edited migration');
  assert.notEqual(mg.migrationContentId([...MIG, { path: 'db/migrations/0003_more.sql', blob: BLOB_A }]), id, 'an added migration');
  assert.notEqual(mg.migrationContentId([MIG[0]]), id, 'a removed migration');
  assert.notEqual(mg.migrationContentId([MIG[0], { ...MIG[1], path: 'db/migrations/0002_renamed.sql' }]), id, 'a renamed migration');
  assert.notEqual(mg.migrationContentId([MIG[0], { ...MIG[1], blob: null }]), id, 'a deleted migration');
  assert.equal(mg.migrationContentId([]), null);
  assert.equal(mg.migrationContentId(null), null);
  assert.equal(mg.migrationContentId([{ path: 'x.sql', blob: 'nope' }]), null);
  assert.equal(mg.migrationContentId([{ path: '', blob: BLOB_A }]), null);
});

test('grantHeadBinding (#508): a content-bound grant survives a new head with byte-identical migrations', () => {
  const id = mg.migrationContentId(MIG);
  const g = { role: 'migration-reviewer', head: HEAD, record: { migrations: id } };
  assert.deepEqual(mg.grantHeadBinding(g, HEAD, null), { bound: true, ok: true, via: 'head', reason: '' }, 'the reviewed head itself needs no id');
  assert.deepEqual(mg.grantHeadBinding(g, HEAD2, id), { bound: true, ok: true, via: 'content', reason: '' });
  assert.equal(mg.grantHeadBinding(g, HEAD2, id.toUpperCase()).ok, true);
  const edited = mg.grantHeadBinding(g, HEAD2, mg.migrationContentId([MIG[0]]));
  assert.equal(edited.ok, false);
  assert.match(edited.reason, /a migration file changed since the review/);
  const unread = mg.grantHeadBinding(g, HEAD2, null);
  assert.equal(unread.ok, false);
  assert.match(unread.reason, /could not be read/);
  assert.equal(mg.grantHeadBinding(g, HEAD.slice(0, 7), id).ok, false, 'a short head is still never confirmed');
});

test('evaluateReviewerGrant + evaluateShipSet (#508): sync keeps a content-bound grant, an edit voids it, R still gates', () => {
  const id = mg.migrationContentId(MIG);
  const issue = openRecord({ comments: [reviewComment(rec({ migrations: id }))] });
  const synced = mg.evaluateReviewerGrant(issue, { ...CTX, headSha: HEAD2, contentId: id });
  assert.equal(synced.ok, true, synced.reason);
  assert.equal(synced.via, 'content');
  const edited = mg.evaluateReviewerGrant(issue, { ...CTX, headSha: HEAD2, contentId: 'f'.repeat(64) });
  assert.equal(edited.ok, false);
  assert.deepEqual(edited.checks, { policy: true, marker: true, head: false });
  // A legacy (HEAD-only) record is unchanged: a sync still voids it.
  const legacy = mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment()] }), { ...CTX, headSha: HEAD2, contentId: id });
  assert.match(legacy.reason, /a new commit voids it/);
  // Through the ship set: content-bound pass, and R is read for the SHIPPED head.
  let rtCalls = 0;
  const set = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL,
    { policy: 'reviewer', headSha: HEAD2, contentId: id, roundtrip: () => { rtCalls++; return { ok: true }; } });
  assert.equal(set.ok, true, JSON.stringify(set.missing));
  assert.equal(set.granted[0].via, 'content');
  assert.equal(set.granted[0].migrations, id);
  assert.equal(rtCalls, 1);
  const noRt = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL,
    { policy: 'reviewer', headSha: HEAD2, contentId: id, roundtrip: () => ({ ok: false, reason: 'no job' }) });
  assert.equal(noRt.ok, false);
  assert.equal(noRt.missing[0].failed, 'roundtrip');
});

test('reviewGrantCommentBody (#508): a content id is written, round-trips, and carries the content tail', () => {
  const id = mg.migrationContentId(MIG);
  const body = mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec({ migrations: id }));
  assert.match(body.split('\n')[0], /bound to the reviewed migration content/);
  assert.match(body, new RegExp(`\\nmigrations: ${id}\\n`));
  const p = mg.parseReviewGrant(body);
  assert.deepEqual(p.problems, []);
  assert.equal(p.record.migrations, id);
  assert.deepEqual(mg.parseReviewGrant(mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec({ migrations: 'abc' }))).problems.length > 0, true, 'a malformed id is a problem');
  // A legacy record keeps the HEAD tail, byte for byte.
  assert.match(mg.reviewGrantCommentBody(BRANCH, HOST, NOW, rec()).split('\n')[0], /bound to this HEAD: any new commit voids it/);
});

test('evaluateReviewerGrant: policy human refuses first, even with a perfect record', () => {
  const v = mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment()] }), { ...CTX, policy: 'human' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /policy is "human"/);
  assert.deepEqual(v.checks, { policy: false, marker: false, head: false });
});

test('evaluateReviewerGrant: the full pass, and each refusal in order', () => {
  const ok = mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment()] }), CTX);
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(ok.checks, { policy: true, marker: true, head: true });
  assert.match(mg.evaluateReviewerGrant(null, CTX).reason, /could not be read/);
  assert.match(mg.evaluateReviewerGrant({ ...openRecord({ comments: [reviewComment()] }), state: 'CLOSED' }, CTX).reason, /CLOSED/);
  assert.match(mg.evaluateReviewerGrant(openRecord({ labels: [], comments: [reviewComment()] }), CTX).reason, /does not carry/);
  assert.match(mg.evaluateReviewerGrant(openRecord({ comments: [grantComment(BRANCH)] }), CTX).reason, /no live reviewer grant/);
  assert.match(mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment(rec(), { branch: 'feat/other-2' })] }), CTX).reason, /bound to branch/);
  assert.match(mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment(rec(), { authorAssociation: 'NONE' })] }), CTX).reason, /not a repo owner/);
  assert.match(mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment(rec({ 'ci-roundtrip': 'fail' }))] }), CTX).reason, /does not pass: CI round-trip fail/);
  const moved = mg.evaluateReviewerGrant(openRecord({ comments: [reviewComment()] }), { ...CTX, headSha: HEAD2 });
  assert.match(moved.reason, /a new commit voids it/);
  assert.deepEqual(moved.checks, { policy: true, marker: true, head: false });
});

test('parseGrantPolicy: absent/null → human; human; reviewer (trimmed); anything else invalid → human', () => {
  assert.deepEqual(mg.parseGrantPolicy({}), { policy: 'human', declared: false, valid: true, reason: 'migration-grant absent — human grants only' });
  assert.equal(mg.parseGrantPolicy({ 'migration-grant': null }).declared, false);
  assert.equal(mg.parseGrantPolicy(null).policy, 'human');
  assert.equal(mg.parseGrantPolicy({ 'migration-grant': 'human' }).policy, 'human');
  assert.equal(mg.parseGrantPolicy({ 'migration-grant': ' reviewer ' }).policy, 'reviewer');
  for (const bad of ['Reviewer', 'yes', true, [], 1, '']) {
    const p = mg.parseGrantPolicy({ 'migration-grant': bad });
    assert.equal(p.valid, false, JSON.stringify(bad));
    assert.equal(p.policy, 'human', JSON.stringify(bad));
  }
});

// --- #494: roundtripJobWorkflows — is R reachable at all? ---------------------------------------
test('#494 roundtripJobWorkflows: a live job name counts (quoted or not, with or without a leg); a commented one never does', () => {
  const wf = {
    '.github/workflows/a.yml': 'jobs:\n  m:\n    name: Migration round-trip (${{ matrix.engine }})\n',
    '.github/workflows/b.yml': "jobs:\n  m:\n    name: 'Migration round-trip'\n",
    '.github/workflows/c.yml': 'jobs:\n  # m:\n  #   name: Migration round-trip (postgres)\n',
    '.github/workflows/d.yml': 'jobs:\n  m:\n    name: Migrations round trip\n',
  };
  const readFile = (p) => (p in wf ? wf[p] : null);
  assert.deepStrictEqual(
    mg.roundtripJobWorkflows({ readFile, workflows: ['a.yml', 'b.yml', 'c.yml', 'd.yml', 'missing.yml'] }),
    ['a.yml', 'b.yml']);
  assert.deepStrictEqual(mg.roundtripJobWorkflows({ readFile, workflows: [] }), []);
});
