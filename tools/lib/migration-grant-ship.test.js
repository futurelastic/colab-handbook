'use strict';
/**
 * #401 — `colab ship` honours a reviewer grant only with P + M + HEAD + R.
 *
 * The rule is ONE pure function (tools/lib/migration-grant.js evaluateShipSet with a ctx) plus the
 * pure R verdict (roundtripVerdict). Every ship path reaches it through tools/colab's single
 * shipMigrationGate — pinned at the bottom by a source-level test, because the accept path cannot
 * be reached end to end through the CLI (no fake-gh backdoor, deliberately).
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mg = require('./migration-grant.js');

const LABEL = 'migration-granted';
const BRANCH = 'feat/schema-change-1';
const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const NOW = '2026-09-30T10:00:00Z';

function comment(body, { createdAt = NOW, login = 'vo2vo', authorAssociation = 'MEMBER' } = {}) {
  return { body, createdAt, author: { login }, authorAssociation };
}
function rec(over = {}) {
  return {
    v: '1', role: 'migration-reviewer', reviewer: 'bot-a', head: HEAD,
    verdict: 'approve', checklist: 'pass', 'checklist-items': '7/7',
    escalation: 'destructive-ddl', 'escalation-result': 'clear', 'ci-roundtrip': 'pass', ...over,
  };
}
const reviewC = (r = rec(), o = {}) => comment(mg.reviewGrantCommentBody(o.branch || BRANCH, 'box', NOW, r), o);
const humanC = (branch = BRANCH, o = {}) => comment(mg.grantCommentBody(branch, 'box', NOW), o);
const openRec = (comments, labels = [LABEL]) => ({ state: 'OPEN', labels: labels.map((name) => ({ name })), comments });

/** A ctx whose R thunk counts its calls and returns `rt`. */
function ctxWith(over = {}, rt = { ok: true, reason: '' }) {
  const calls = { n: 0 };
  const ctx = { policy: 'reviewer', headSha: HEAD, roundtrip: () => { calls.n += 1; return rt; }, ...over };
  return { ctx, calls };
}
const one = (record, ctx) => mg.evaluateShipSet([1], { 1: record }, BRANCH, LABEL, ctx);

// ---- all four hold -------------------------------------------------------------------------

test('P+M+HEAD+R all hold → ok, granted role reviewer, R read exactly once', () => {
  const { ctx, calls } = ctxWith();
  const v = one(openRec([reviewC()]), ctx);
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted[0].role, 'reviewer');
  assert.equal(v.granted[0].reviewer, 'bot-a');
  assert.equal(v.granted[0].head, HEAD);
  assert.equal(calls.n, 1);
});

// ---- each condition failing alone ----------------------------------------------------------

test('P: policy human + a perfect reviewer grant → refused, failed policy, names migration-grant; R never read', () => {
  const { ctx, calls } = ctxWith({ policy: 'human' });
  const v = one(openRec([reviewC()]), ctx);
  assert.equal(v.ok, false);
  assert.equal(v.missing[0].failed, 'policy');
  assert.match(v.missing[0].reason, /^reviewer grant \[P policy\]: .*migration-grant/);
  assert.equal(calls.n, 0);
});

test('P: an unknown policy value reads as human', () => {
  const v = one(openRec([reviewC()]), ctxWith({ policy: 'Reviewer' }).ctx);
  assert.equal(v.missing[0].failed, 'policy');
});

test('M: invalid record, failing record, untrusted author, wrong branch → failed marker; R never read', () => {
  const cases = [
    reviewC(rec({ verdict: 'maybe' })),
    reviewC(rec({ verdict: 'reject' })),
    reviewC(rec({ checklist: 'fail' })),
    reviewC(rec({ 'ci-roundtrip': 'pending' })),
    reviewC(rec(), { authorAssociation: 'NONE' }),
    reviewC(rec(), { branch: 'feat/other-2' }),
  ];
  for (const c of cases) {
    const { ctx, calls } = ctxWith();
    const v = one(openRec([c]), ctx);
    assert.equal(v.ok, false);
    assert.equal(v.missing[0].failed, 'marker', v.missing[0].reason);
    assert.match(v.missing[0].reason, /^reviewer grant \[M record\]: /);
    assert.equal(calls.n, 0);
  }
});

test('HEAD: grant head ≠ headSha, or headSha short / null → failed head; R never read', () => {
  for (const headSha of [HEAD2, HEAD.slice(0, 7), null]) {
    const { ctx, calls } = ctxWith({ headSha });
    const v = one(openRec([reviewC()]), ctx);
    assert.equal(v.ok, false);
    assert.equal(v.missing[0].failed, 'head', String(headSha));
    assert.match(v.missing[0].reason, /^reviewer grant \[HEAD\]: /);
    assert.equal(calls.n, 0);
  }
});

test('R: a thunk verdict not ok, null, missing, or throwing → failed roundtrip, reason carried', () => {
  const cases = [
    [{ ok: false, reason: 'the CI round-trip at aaaaaaa failed: "Migration round-trip (mysql)" did not pass (failure)' }, /did not pass \(failure\)/],
    [null, /could not be read/],
  ];
  for (const [rt, re] of cases) {
    const v = one(openRec([reviewC()]), ctxWith({}, rt).ctx);
    assert.equal(v.ok, false);
    assert.equal(v.missing[0].failed, 'roundtrip');
    assert.match(v.missing[0].reason, /^reviewer grant \[R round-trip\]: #1: /);
    assert.match(v.missing[0].reason, re);
  }
  assert.equal(one(openRec([reviewC()]), { policy: 'reviewer', headSha: HEAD }).missing[0].failed, 'roundtrip');
  const boom = one(openRec([reviewC()]), { policy: 'reviewer', headSha: HEAD, roundtrip: () => { throw new Error('x'); } });
  assert.equal(boom.missing[0].failed, 'roundtrip');
});

// ---- the human grant is unchanged ----------------------------------------------------------

test('no ctx → byte-identical to the pre-#401 human-only output', () => {
  const recs = { 1: openRec([humanC()]), 2: openRec([reviewC()]) };
  assert.deepEqual(mg.evaluateShipSet([1, 2], recs, BRANCH, LABEL), {
    ok: false,
    granted: [{ issue: 1, branch: BRANCH, by: 'vo2vo', at: NOW }],
    missing: [{ issue: 2, reason: '#2 carries the label but has no live grant comment (revoked, or never posted)' }],
  });
});

test('a human grant passes under either policy, wins over a reviewer grant, and never reads R', () => {
  for (const policy of ['human', 'reviewer']) {
    const { ctx, calls } = ctxWith({ policy, headSha: HEAD2 }, null);
    const v = one(openRec([humanC(), reviewC()]), ctx);
    assert.equal(v.ok, true, policy);
    assert.equal(v.granted[0].role, 'human');
    assert.equal(calls.n, 0);
  }
});

test('no grant at all: policy human → the human reason verbatim; reviewer → plus "no reviewer grant either"', () => {
  const plain = mg.evaluateShipSet([1], { 1: openRec([]) }, BRANCH, LABEL).missing[0].reason;
  const h = one(openRec([]), ctxWith({ policy: 'human' }).ctx).missing[0];
  assert.equal(h.failed, 'human');
  assert.equal(h.reason, plain);
  const r = one(openRec([]), ctxWith().ctx).missing[0];
  assert.equal(r.failed, 'human');
  assert.equal(r.reason, `${plain}, and no live reviewer grant either`);
});

test('a closed issue, a missing label, or a failed read → failed issue, whatever grants exist', () => {
  for (const record of [null, { ...openRec([reviewC()]), state: 'CLOSED' }, openRec([reviewC()], [])]) {
    const v = one(record, ctxWith().ctx);
    assert.equal(v.missing[0].failed, 'issue');
  }
});

// ---- the whole set ---------------------------------------------------------------------------

test('group branch: one reviewer-granted, one with nothing → refused (no sibling carries another)', () => {
  const { ctx } = ctxWith();
  const v = mg.evaluateShipSet([1, 2], { 1: openRec([reviewC()]), 2: openRec([]) }, BRANCH, LABEL, ctx);
  assert.equal(v.ok, false);
  assert.deepEqual(v.granted.map((g) => g.issue), [1]);
  assert.deepEqual(v.missing.map((m) => m.issue), [2]);
});

test('group branch: two reviewer-granted issues share ONE R read', () => {
  const { ctx, calls } = ctxWith();
  const v = mg.evaluateShipSet([2, 1], { 1: openRec([reviewC()]), 2: openRec([reviewC()]) }, BRANCH, LABEL, ctx);
  assert.equal(v.ok, true);
  assert.deepEqual(v.granted.map((g) => g.issue), [2, 1], 'reported in the branch\'s own issue order');
  assert.equal(calls.n, 1);
});

test('zero issues → refused with a ctx too (non-vacuity)', () => {
  const v = mg.evaluateShipSet([], {}, BRANCH, LABEL, ctxWith().ctx);
  assert.equal(v.ok, false);
  assert.equal(v.missing[0].issue, null);
});

// ---- roundtripVerdict (R, pure) --------------------------------------------------------------

const ran = [{ name: 'Run migrations', status: 'completed', conclusion: 'success' }];
const skipped = [{ name: 'Run migrations', status: 'completed', conclusion: 'skipped' }];
const job = (name, over = {}) => ({ name, status: 'completed', conclusion: 'success', steps: ran, ...over });

test('roundtripVerdict: every leg passed with a step that ran → ok', () => {
  const v = mg.roundtripVerdict([job('Migration round-trip (mysql)'), job('Migration round-trip (sqlite)'), job('Unit tests')], { headSha: HEAD });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.legs.length, 2);
});

test('roundtripVerdict: no round-trip job, a failed leg, a pending leg, an all-skipped leg → refused, named', () => {
  const cases = [
    [[job('Unit tests')], /no "Migration round-trip" job ran at aaaaaaa/],
    [[job('Migration round-trip (mysql)', { conclusion: 'failure' })], /"Migration round-trip \(mysql\)" did not pass \(failure\)/],
    [[job('Migration round-trip (mysql)', { status: 'in_progress', conclusion: null })], /did not pass \(in_progress\)/],
    [[job('Migration round-trip (mysql)', { steps: skipped })], /success with no step run/],
    [[job('Migration round-trip (mysql)', { steps: null })], /success with no step run/],
    [[job('Migration round-trip (mysql)'), job('Migration round-trip (sqlite)', { conclusion: 'failure' })], /\(sqlite\)" did not pass/],
  ];
  for (const [jobs, re] of cases) {
    const v = mg.roundtripVerdict(jobs, { headSha: HEAD });
    assert.equal(v.ok, false);
    assert.match(v.reason, re);
  }
});

test('roundtripVerdict: a cancelled duplicate beside a passing instance of the same leg is fine', () => {
  const v = mg.roundtripVerdict([job('Migration round-trip (mysql)', { conclusion: 'cancelled' }), job('Migration round-trip (mysql)')], { headSha: HEAD });
  assert.equal(v.ok, true, v.reason);
});

test('roundtripVerdict: unreadable jobs (null) or a branch editing .github/workflows/ → refused', () => {
  assert.match(mg.roundtripVerdict(null, { headSha: HEAD }).reason, /could not be read/);
  const w = mg.roundtripVerdict([job('Migration round-trip (mysql)')], { headSha: HEAD, workflowsTouched: true });
  assert.equal(w.ok, false);
  assert.match(w.reason, /\.github\/workflows\/.*human grant/);
});

test('ROUNDTRIP_JOB_PREFIX matches the job name the Laravel template actually ships', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'ci-laravel.yml'), 'utf8');
  const names = [...tpl.matchAll(/^\s+name:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(names.some((n) => n.startsWith(mg.ROUNDTRIP_JOB_PREFIX)), `no job named "${mg.ROUNDTRIP_JOB_PREFIX}…" in templates/ci-laravel.yml`);
});

// ---- one rule for every path -----------------------------------------------------------------

test('tools/colab: evaluateShipSet and newMigrations are called only inside shipMigrationGate, and every ship path calls it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'colab'), 'utf8');
  const fnBody = (name) => {
    const start = src.indexOf(`\nfunction ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    const next = src.indexOf('\nfunction ', start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  };
  const gate = fnBody('shipMigrationGate');
  const count = (s, re) => (s.match(re) || []).length;
  assert.equal(count(src, /migrationGrant\.evaluateShipSet\(/g), 1, 'one migration evaluateShipSet call in tools/colab');
  assert.equal(count(gate, /migrationGrant\.evaluateShipSet\(/g), 1);
  const newMigCalls = count(src, /\bnewMigrations\(/g) - 1; // minus the definition
  assert.equal(newMigCalls, count(gate, /\bnewMigrations\(/g), 'newMigrations is called from nowhere but shipMigrationGate');
  // #508: the reviewer-grant mint computes its content id over the SAME path rule, so it is the
  // one other caller — the rule is still never recomputed, only called. #563: it calls the variant
  // that answers null on an unreadable diff (so it can refuse), which newMigrations itself wraps.
  const mint = fnBody('migrationGrantReviewRecord');
  assert.equal(count(mint, /\bnewMigrationsOrNull\(/g), 1, 'the mint reads the gate\'s own path rule');
  assert.match(fnBody('newMigrations'), /return newMigrationsOrNull\(/);
  assert.equal(count(src, /\bnewMigrationsOrNull\(/g) - 1, 2, 'newMigrationsOrNull is called from nowhere but newMigrations and the mint');
  // Both bind through the one content-id helper.
  assert.match(mint, /migrationContentAt\(/);
  assert.match(fnBody('shipMigrationCtx'), /migrationContentAt\(/);
  assert.match(fnBody('cmdShip'), /shipMigrationGate\(/);
  assert.match(fnBody('cmdShipDryJson'), /shipMigrationGate\(/);
});

// ---- #457: the mint-time checks --------------------------------------------------------------

const runAt = (id, jobs, over = {}) => ({ databaseId: id, workflowName: 'CI', jobs, ...over });

test('mintRoundtripCheck: ci-roundtrip pass with a passing round-trip job at the head → ok', () => {
  const c = mg.mintRoundtripCheck(rec({ 'ci-run': '42' }), [runAt(42, [job('Gitleaks'), job('Migration round-trip (mysql)')])]);
  assert.equal(c.ok, true, c.reason);
});

test('mintRoundtripCheck: the observed case — a pass whose run has only a secret scan and a build → refused, names the missing job and the fix', () => {
  const c = mg.mintRoundtripCheck(rec({ 'ci-run': '42' }), [runAt(42, [job('Gitleaks'), job('Build')])]);
  assert.equal(c.ok, false);
  assert.match(c.reason, /ci-roundtrip: pass, but no "Migration round-trip" job ran at aaaaaaa/);
  assert.match(c.reason, /must run the template's migrations job/);
});

test('mintRoundtripCheck: a failed or pending leg, unread runs, unread jobs, a workflows-editing branch → refused', () => {
  assert.equal(mg.mintRoundtripCheck(rec(), [runAt(1, [job('Migration round-trip (mysql)', { conclusion: 'failure' })])]).ok, false);
  assert.equal(mg.mintRoundtripCheck(rec(), [runAt(1, [job('Migration round-trip (mysql)', { status: 'in_progress', conclusion: null })])]).ok, false);
  assert.match(mg.mintRoundtripCheck(rec(), null).reason, /could not be read/);
  assert.match(mg.mintRoundtripCheck(rec(), [runAt(1, null)]).reason, /could not be read/);
  assert.match(mg.mintRoundtripCheck(rec(), []).reason, /no "Migration round-trip" job/);
  assert.match(mg.mintRoundtripCheck(rec(), [runAt(1, [job('Migration round-trip (mysql)')])], { workflowsTouched: true }).reason, /\.github\/workflows\//);
});

test('mintRoundtripCheck: ci-run must resolve, be a run at the head, and itself carry the job', () => {
  const runs = [runAt(7, [job('Build')]), runAt(8, [job('Migration round-trip (mysql)')])];
  assert.equal(mg.mintRoundtripCheck(rec({ 'ci-run': 'https://github.com/o/r/actions/runs/8' }), runs).ok, true);
  assert.match(mg.mintRoundtripCheck(rec({ 'ci-run': 'latest' }), runs).reason, /does not name a run id/);
  assert.match(mg.mintRoundtripCheck(rec({ 'ci-run': '9' }), runs).reason, /ci-run 9 is not a run at aaaaaaa/);
  assert.match(mg.mintRoundtripCheck(rec({ 'ci-run': '7' }), runs).reason, /ci-run 7 has no "Migration round-trip" job/);
  assert.equal(mg.mintRoundtripCheck(rec(), runs).ok, true, 'ci-run stays optional');
});

test('mintRoundtripCheck: a record not claiming pass is not its to judge', () => {
  assert.equal(mg.mintRoundtripCheck(rec({ 'ci-roundtrip': 'pending' }), null).ok, true);
});

test('parseRunId: digits, or a /runs/<id> URL — anything else is null', () => {
  assert.equal(mg.parseRunId('123'), '123');
  assert.equal(mg.parseRunId('https://github.com/o/r/actions/runs/123/job/9'), '123');
  assert.equal(mg.parseRunId('https://github.com/o/r/actions/runs/123?pr=1'), '123');
  assert.equal(mg.parseRunId('run-123'), null);
  assert.equal(mg.parseRunId('https://ci.example.invalid/run/9'), null);
});

test('mintRecordProblems: denominator must be the checklist size; checklist pass needs N = M; absent is fine', () => {
  assert.deepEqual(mg.mintRecordProblems(rec({ 'checklist-items': '10/10' })), []);
  assert.deepEqual(mg.mintRecordProblems(rec({ 'checklist-items': undefined })), []);
  assert.match(mg.mintRecordProblems(rec({ 'checklist-items': '4/4' })).join(';'), /checklist has 10 items/);
  assert.match(mg.mintRecordProblems(rec({ 'checklist-items': '9/10' })).join(';'), /a pass means every item passed/);
  assert.deepEqual(mg.mintRecordProblems(rec({ checklist: 'fail', 'checklist-items': '9/10' })), []);
});

test('mintRecordProblems stays off the READ path — an older 7/7 record still validates and passes for ship', () => {
  const v = mg.validateReviewRecord(rec({ 'checklist-items': '7/7' }));
  assert.equal(v.valid, true);
  assert.equal(v.passing, true);
});

test('REVIEW_CHECKLIST_ITEMS matches the checklist the migration-review skill documents', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'migration-review', 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`\`checklist-items\` in the record is \`<passed>/${mg.REVIEW_CHECKLIST_ITEMS}\``));
  const rows = skill.split('## The checklist')[1].split('\n---')[0].match(/^\| \d+ \|/gm) || [];
  assert.equal(rows.length, mg.REVIEW_CHECKLIST_ITEMS);
});
