'use strict';
/**
 * Tests for the reviewer role of the ci-grant marker (#504) — tools/lib/ci-grant.js. Pure cases
 * only; the CLI half (minting without COLAB_HUMAN=1 under the opt-in, and the refusals before any
 * network call) lives in tools/lib/ship-ci-grant-reviewer.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');

const ci = require('./ci-grant.js');
const codec = require('./codec/grants');

const LABEL = 'ci-granted';
const TRUNK = 'main';
const BRANCH = 'fix/trunk-red-audit-212';
const HEAD = '4f2a9c1e7b3d5a6f8e0c2b4d6a8f0e1c3b5d7a9f';
const OTHER_HEAD = '1111111111111111111111111111111111111111';
const RED = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d';
const OTHER_RED = '2222222222222222222222222222222222222222';
const AT = '2026-10-05T16:20:31.507Z';
const RED_JOBS = [{ name: 'test (ubuntu-latest, 22)', workflowName: 'CI' }, { name: 'self-audit', workflowName: 'CI' }];

function record(over = {}) {
  return { v: '1', role: 'ci-reviewer', reviewer: 'lucy', head: HEAD, red: RED, verdict: 'pass',
    cures: 'CI / test (ubuntu-latest, 22)', ...over };
}
function reviewComment(over = {}, opts = {}) {
  const rec = record(over);
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { body: ci.reviewGrantCommentBody(opts.branch || BRANCH, opts.trunk || TRUNK, 'h:abc', opts.at || AT, rec),
    createdAt: opts.at || AT, author: { login: opts.login || 'agent-bot' }, authorAssociation: opts.assoc || 'MEMBER' };
}
function issue({ title = 'TRUNK RED: self-audit fails on main', labels = [LABEL], comments = [reviewComment()], state = 'OPEN' } = {}) {
  return { state, title, labels: labels.map((name) => ({ name })), comments };
}
function ctx(over = {}) {
  return { branch: BRANCH, trunk: TRUNK, redTrunkSha: RED, evidence: { ok: true, sha: HEAD }, issueNum: 7,
    labelName: LABEL, policy: 'reviewer', now: '2026-10-05T17:00:00Z', redJobs: () => RED_JOBS, ...over };
}

test('parseGrantPolicy: absent → human; reviewer/human accepted; anything else fails toward human', () => {
  assert.deepStrictEqual(ci.parseGrantPolicy({}).policy, 'human');
  assert.strictEqual(ci.parseGrantPolicy({}).declared, false);
  assert.strictEqual(ci.parseGrantPolicy({ 'ci-grant': 'reviewer' }).policy, 'reviewer');
  assert.strictEqual(ci.parseGrantPolicy({ 'ci-grant': 'human' }).policy, 'human');
  const bad = ci.parseGrantPolicy({ 'ci-grant': 'agent' });
  assert.strictEqual(bad.policy, 'human');
  assert.strictEqual(bad.valid, false);
});

test('the reviewer mark never collides with the human CI grant, its revoke, or the migration marks', () => {
  const body = reviewComment().body;
  assert.ok(!ci.GRANT_RE.test(body));
  assert.ok(!ci.REVOKE_RE.test(body));
  assert.strictEqual(codec.decodeReviewGrant(body), null);
  assert.strictEqual(codec.decodeMigrationGrant(body), null);
  assert.strictEqual(ci.liveGrants([reviewComment()]).length, 0, 'the human reader stays blind to it');
});

test('validateReviewRecord: a full pass record is valid and passing; fail is valid but not passing', () => {
  assert.deepStrictEqual(ci.validateReviewRecord(record()), { valid: true, passing: true, problems: [] });
  const f = ci.validateReviewRecord(record({ verdict: 'fail' }));
  assert.strictEqual(f.valid, true);
  assert.strictEqual(f.passing, false);
});

test('validateReviewRecord: missing cures, short head, unknown key and bad not-before are problems', () => {
  const v = ci.validateReviewRecord(record({ cures: undefined, head: 'abc1234', extra: 'x', 'not-before': '2026-13-99Tnope' }));
  assert.strictEqual(v.valid, false);
  const all = v.problems.join(' | ');
  assert.match(all, /missing "cures"/);
  assert.match(all, /"head"/);
  assert.match(all, /unknown key "extra"/);
  assert.match(all, /not-before/);
});

test('parseCures/formatCures: "; " separated, commas inside a matrix name survive', () => {
  assert.deepStrictEqual(ci.parseCures('CI / test (ubuntu, 22); CI / audit'), ['CI / test (ubuntu, 22)', 'CI / audit']);
  assert.strictEqual(ci.formatCures(['a (x, y)', ' b ']), 'a (x, y); b');
});

test('curesAreRed: full label or a unique bare name matches; an ambiguous bare name or a green check does not', () => {
  assert.strictEqual(ci.curesAreRed(['CI / self-audit'], RED_JOBS).ok, true);
  assert.strictEqual(ci.curesAreRed(['self-audit'], RED_JOBS).ok, true);
  const dup = [{ name: 'test', workflowName: 'A' }, { name: 'test', workflowName: 'B' }];
  assert.strictEqual(ci.curesAreRed(['test'], dup).ok, false);
  const g = ci.curesAreRed(['CI / lint'], RED_JOBS);
  assert.strictEqual(g.ok, false);
  assert.deepStrictEqual(g.unmatched, ['CI / lint']);
  assert.strictEqual(ci.curesAreRed(['CI / self-audit'], null).ok, false, 'unmeasured red set never confirms');
  assert.strictEqual(ci.curesAreRed([], RED_JOBS).ok, false);
});

test('evaluateReviewerIssue: the full happy path is ok', () => {
  const r = ci.evaluateReviewerIssue(issue(), ctx());
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.grant.reviewer, 'lucy');
});

const REFUSALS = [
  ['a failed read', () => [null, ctx()], /failed read/],
  ['a closed issue', () => [issue({ state: 'CLOSED' }), ctx()], /CLOSED/],
  ['no label', () => [issue({ labels: [] }), ctx()], /label/],
  ['policy human', () => [issue(), ctx({ policy: 'human' })], /ci-grant: reviewer/],
  ['a title not TRUNK RED:', () => [issue({ title: 'fix: something' }), ctx()], /TRUNK RED:/],
  ['another branch', () => [issue(), ctx({ branch: 'fix/other-9' })], /bound to branch/],
  ['an untrusted author', () => [issue({ comments: [reviewComment({}, { assoc: 'CONTRIBUTOR' })] }), ctx()], /not a repo owner/],
  ['a fail verdict', () => [issue({ comments: [reviewComment({ verdict: 'fail' })] }), ctx()], /only a pass/],
  ['trunk moved to another red', () => [issue(), ctx({ redTrunkSha: OTHER_RED })], /trunk moved/],
  ['inside the revoke window', () => [issue({ comments: [reviewComment({ 'not-before': '2026-10-05T18:00:00Z' })] }), ctx()], /not yet usable/],
  ['evidence unreadable', () => [issue(), ctx({ evidence: null })], /failed evidence read/],
  ['evidence red', () => [issue(), ctx({ evidence: { ok: false, sha: HEAD } })], /none exists/],
  ['a new commit on the branch', () => [issue(), ctx({ evidence: { ok: true, sha: OTHER_HEAD } })], /new commit voids it/],
  ['a claimed cure that is not red', () => [issue({ comments: [reviewComment({ cures: 'CI / lint' })] }), ctx()], /not red on trunk/],
  ['red set unmeasured', () => [issue(), ctx({ redJobs: () => null })], /could not be measured/],
];
for (const [name, args, re] of REFUSALS) {
  test(`evaluateReviewerIssue refuses: ${name}`, () => {
    const r = ci.evaluateReviewerIssue(...args());
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, re);
  });
}

test('evaluateReviewerIssue: a revoke after the reviewer grant cancels it', () => {
  const rev = { body: ci.revokeCommentBody(BRANCH, 'h:abc', '2026-10-05T16:30:00Z'), createdAt: '2026-10-05T16:30:00Z',
    author: { login: 'boss' }, authorAssociation: 'OWNER' };
  const r = ci.evaluateReviewerIssue(issue({ comments: [reviewComment(), rev] }), ctx());
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /no live reviewer grant/);
});

test('evaluateReviewerIssue: past the revoke window it is usable', () => {
  const r = ci.evaluateReviewerIssue(issue({ comments: [reviewComment({ 'not-before': '2026-10-05T16:35:00Z' })] }), ctx());
  assert.strictEqual(r.ok, true, r.reason);
});

test('evaluateShipSet: a reviewer grant passes under the opt-in and is reported with its role', () => {
  const v = ci.evaluateShipSet([7], { 7: issue() }, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL,
    { policy: 'reviewer', now: '2026-10-05T17:00:00Z', redJobs: () => RED_JOBS });
  assert.strictEqual(v.ok, true, JSON.stringify(v.missing));
  assert.strictEqual(v.granted[0].role, 'ci-reviewer');
  assert.strictEqual(v.granted[0].reviewer, 'lucy');
  assert.strictEqual(v.granted[0].redSha, RED);
  assert.deepStrictEqual(v.granted[0].cures, ['CI / test (ubuntu-latest, 22)']);
});

test('evaluateShipSet: without the opt-in a reviewer grant does nothing', () => {
  const v = ci.evaluateShipSet([7], { 7: issue() }, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL, {});
  assert.strictEqual(v.ok, false);
  assert.match(v.missing[0].reason, /^reviewer grant: .*ci-grant: reviewer/);
});

test('evaluateShipSet: an issue with no reviewer marker keeps the human reason byte for byte', () => {
  const rec = issue({ comments: [] });
  const withOpts = ci.evaluateShipSet([7], { 7: rec }, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL, { policy: 'reviewer' });
  const without = ci.evaluateShipSet([7], { 7: rec }, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL);
  assert.deepStrictEqual(withOpts, without);
});

test('evaluateShipSet: the red-job thunk is read at most once per set', () => {
  let calls = 0;
  const recs = { 7: issue(), 8: issue() };
  const v = ci.evaluateShipSet([7, 8], recs, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL,
    { policy: 'reviewer', now: '2026-10-05T17:00:00Z', redJobs: () => { calls += 1; return RED_JOBS; } });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(calls, 1);
});

test('liveGrantRecords: lists human and reviewer grants together, oldest first', () => {
  const human = { body: ci.grantCommentBody(BRANCH, TRUNK, RED, HEAD, 'h:abc', '2026-10-05T16:00:00Z'),
    createdAt: '2026-10-05T16:00:00Z', author: { login: 'boss' }, authorAssociation: 'OWNER' };
  const all = ci.liveGrantRecords([reviewComment(), human]);
  assert.deepStrictEqual(all.map((g) => g.role), ['human', 'ci-reviewer']);
  assert.strictEqual(all[1].valid, true);
  assert.strictEqual(all[1].passing, true);
});

// ---- #730: a trunk red that is only a cancelled run whose one re-run is spent ----

const cure = require('./ci-cure.js');

const W = 'instruction-files';
const runRow = (over = {}) => ({ workflowName: W, status: 'completed', conclusion: 'cancelled', attempt: 2, databaseId: 101, ...over });
const job = (over = {}) => ({ name: 'check', status: 'completed', conclusion: 'cancelled', ...over });
/** The branch head's job rows as tools/colab branchHeadJobs tags them. */
const bjob = (over = {}) => ({ name: 'check', workflowName: W, status: 'completed', conclusion: 'success',
  runStatus: 'completed', runConclusion: 'success', ...over });
const CANCELLED_RED = cure.reviewerRedJobSet({ failedRunJobs: [], cancelledRunJobs: [{ ...job(), workflowName: W }] });

test('#730 spentCancelledRuns: only a named, completed, cancelled run past its first attempt, with no run of its workflow that ran', () => {
  assert.strictEqual(cure.spentCancelledRuns([runRow()]).length, 1);
  assert.strictEqual(cure.spentCancelledRuns([runRow({ attempt: 1 })]).length, 0, 'attempt 1: the re-run is still the next step');
  assert.strictEqual(cure.spentCancelledRuns([runRow({ attempt: null })]).length, 0, 'an unknown attempt is not a spent one');
  assert.strictEqual(cure.spentCancelledRuns([runRow({ attempt: undefined })]).length, 0);
  assert.strictEqual(cure.spentCancelledRuns([runRow({ workflowName: '' })]).length, 0, 'unnamed rows stay neutral (#92)');
  assert.strictEqual(cure.spentCancelledRuns([runRow({ conclusion: 'skipped' })]).length, 0);
  assert.strictEqual(cure.spentCancelledRuns([runRow({ status: 'in_progress', conclusion: null })]).length, 0);
  assert.strictEqual(cure.spentCancelledRuns([runRow(), runRow({ databaseId: 102, conclusion: 'success', attempt: 1 })]).length, 0,
    'a run of the same workflow that ran supersedes the cancelled one');
  assert.strictEqual(cure.spentCancelledRuns([runRow(), runRow({ databaseId: 103, workflowName: 'CI', conclusion: 'success' })]).length, 1,
    'a green sibling WORKFLOW never stands in for it');
  assert.deepStrictEqual(cure.spentCancelledRuns(null), []);
});

test('#730 reviewerRedJobSet: names the spent cancelled jobs, marked; the cure path\'s redJobSet still drops them', () => {
  assert.deepStrictEqual(CANCELLED_RED, [{ name: 'check', workflowName: W, spentCancelled: true }]);
  assert.strictEqual(cure.redJobSet([{ ...job(), workflowName: W }]).length, 0, 'the cure rule\'s set is unchanged (#689 rules that door)');
  // A passed or skipped job of the cancelled run is not red; a failed one is.
  const mixed = cure.reviewerRedJobSet({ failedRunJobs: [], cancelledRunJobs: [
    { ...job({ name: 'a', conclusion: 'success' }), workflowName: W },
    { ...job({ name: 'b', conclusion: 'skipped' }), workflowName: W },
    { ...job({ name: 'c', conclusion: 'failure' }), workflowName: W },
  ] });
  assert.deepStrictEqual(mixed.map((j) => j.name), ['c']);
  // The failed runs' red jobs come through unmarked, alongside.
  const both = cure.reviewerRedJobSet({ failedRunJobs: [{ name: 'test', workflowName: 'CI', status: 'completed', conclusion: 'failure' }],
    cancelledRunJobs: [{ ...job(), workflowName: W }] });
  assert.deepStrictEqual(both, [{ name: 'test', workflowName: 'CI' }, { name: 'check', workflowName: W, spentCancelled: true }]);
});

test('#730 reviewerRedJobSet: unmeasurable is null — unfinished job, non-array input, nothing red at all', () => {
  assert.strictEqual(cure.reviewerRedJobSet({ failedRunJobs: [], cancelledRunJobs: [{ ...job({ status: 'in_progress' }), workflowName: W }] }), null);
  assert.strictEqual(cure.reviewerRedJobSet({ failedRunJobs: null, cancelledRunJobs: [] }), null);
  assert.strictEqual(cure.reviewerRedJobSet({ failedRunJobs: [], cancelledRunJobs: null }), null);
  assert.strictEqual(cure.reviewerRedJobSet({ failedRunJobs: [], cancelledRunJobs: [] }), null);
  assert.strictEqual(cure.reviewerRedJobSet(), null);
});

test('#730 curesAreRed: a spent cancelled check is a cure target, by full label or unique bare name, and is returned matched', () => {
  const full = ci.curesAreRed([`${W} / check`], CANCELLED_RED);
  assert.strictEqual(full.ok, true, full.reason);
  assert.strictEqual(full.matched[0].spentCancelled, true);
  assert.strictEqual(ci.curesAreRed(['check'], CANCELLED_RED).matched[0].workflowName, W);
});

test('#730 spentCancelledCuresProven: accepted when the branch\'s own run of W and its job succeeded at the head', () => {
  const m = ci.curesAreRed([`${W} / check`], CANCELLED_RED).matched;
  assert.deepStrictEqual(ci.spentCancelledCuresProven(m, [bjob()]), { ok: true, reason: '' });
});

const UNPROVEN = [
  ['the branch run of W is itself cancelled', [bjob({ runConclusion: 'cancelled', conclusion: 'cancelled' })], /run cancelled \/ job cancelled/],
  ['the branch run of W is skipped', [bjob({ runConclusion: 'skipped', conclusion: 'skipped' })], /run skipped \/ job skipped/],
  ['the run passed but the job was skipped', [bjob({ conclusion: 'skipped' })], /run success \/ job skipped/],
  ['the run is still going', [bjob({ runStatus: 'in_progress', runConclusion: null, status: 'in_progress', conclusion: null })], /did not succeed/],
  ['only a green sibling workflow has the job', [bjob({ workflowName: 'CI' })], /no such job at the head/],
  ['the head has no such job', [], /no such job at the head/],
  ['the branch head could not be read', null, /could not be read/],
];
for (const [name, rows, re] of UNPROVEN) {
  test(`#730 spentCancelledCuresProven refuses: ${name}`, () => {
    const m = ci.curesAreRed([`${W} / check`], CANCELLED_RED).matched;
    const r = ci.spentCancelledCuresProven(m, rows);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, re);
  });
}

test('#730 spentCancelledCuresProven: an ordinary failed cure reads nothing from the branch', () => {
  let read = 0;
  const m = ci.curesAreRed(['CI / self-audit'], RED_JOBS).matched;
  assert.strictEqual(ci.spentCancelledCuresProven(m, () => { read += 1; return null; }).ok, true);
  assert.strictEqual(read, 0);
});

test('#730 evaluateReviewerIssue (ship): a spent cancelled cure passes only with the branch proof', () => {
  const rec = issue({ comments: [reviewComment({ cures: `${W} / check` })] });
  const ok = ci.evaluateReviewerIssue(rec, ctx({ redJobs: () => CANCELLED_RED, branchJobs: () => [bjob()] }));
  assert.strictEqual(ok.ok, true, ok.reason);
  const cancelled = ci.evaluateReviewerIssue(rec, ctx({ redJobs: () => CANCELLED_RED,
    branchJobs: () => [bjob({ runConclusion: 'cancelled', conclusion: 'cancelled' })] }));
  assert.strictEqual(cancelled.ok, false);
  assert.match(cancelled.reason, /proves nothing/);
  const skipped = ci.evaluateReviewerIssue(rec, ctx({ redJobs: () => CANCELLED_RED,
    branchJobs: () => [bjob({ runConclusion: 'skipped', conclusion: 'skipped' })] }));
  assert.strictEqual(skipped.ok, false);
  const absent = ci.evaluateReviewerIssue(rec, ctx({ redJobs: () => CANCELLED_RED }));
  assert.strictEqual(absent.ok, false, 'no branchJobs reader is unmeasured, never a pass');
  assert.match(absent.reason, /could not be read/);
});

test('#730 evaluateShipSet: passes branchJobs through, read at most once per set', () => {
  let calls = 0;
  const recs = { 7: issue({ comments: [reviewComment({ cures: `${W} / check` })] }), 8: issue({ comments: [reviewComment({ cures: `${W} / check` })] }) };
  const v = ci.evaluateShipSet([7, 8], recs, BRANCH, TRUNK, RED, { ok: true, sha: HEAD }, LABEL,
    { policy: 'reviewer', now: '2026-10-05T17:00:00Z', redJobs: () => CANCELLED_RED, branchJobs: () => { calls += 1; return [bjob()]; } });
  assert.strictEqual(v.ok, true, JSON.stringify(v.missing));
  assert.strictEqual(calls, 1);
});
