'use strict';
/**
 * Unit tests for tools/lib/release-finalize.js (#339) — the pure decision behind
 * `colab release finalize`. The measuring half is release-finalize-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const rf = require('./release-finalize.js');
const releasePolicy = require('./release-policy.js');

const DAY = 86400000;
const T0 = '2026-09-01T00:00:00.000Z';
const at = (days) => new Date(Date.parse(T0) + days * DAY).toISOString();

const AUTO = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: null, deploy: 'none' });
const HUMAN = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: 'https://x.invalid', deploy: 'tag' });

function rcTag(name, extra = {}) {
  return { name, annotated: true, sha: 'a'.repeat(40), date: T0, subject: `${name} — release candidate (colab release cut)`, onMain: true, ...extra };
}

// ---- candidate selection ------------------------------------------------------------------------

test('selectCandidate: the highest open version wins, then the highest N', () => {
  const s = rf.selectCandidate([
    { name: 'v1.2.0', annotated: true, sha: 'b', date: T0, subject: 'v1.2.0', onMain: true },
    rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.3'), rcTag('v1.3.0-rc.1'), rcTag('v1.3.0-rc.2'),
  ]);
  assert.strictEqual(s.kind, 'candidate');
  assert.strictEqual(s.candidate.tag, 'v1.3.0-rc.2');
  assert.deepStrictEqual(s.superseded, ['v1.2.1']);
});

test('selectCandidate: a candidate whose version is already final is not open', () => {
  const s = rf.selectCandidate([rcTag('v1.2.1-rc.1'), { name: 'v1.2.1', annotated: true, sha: 'a', date: T0, subject: 'v1.2.1', onMain: true }]);
  assert.strictEqual(s.kind, 'already-final');
  assert.strictEqual(s.version, 'v1.2.1');
  assert.strictEqual(rf.selectCandidate([]).kind, 'none');
});

test('selectCandidate: a lightweight, hand-annotated or off-main candidate is refused', () => {
  assert.match(rf.selectCandidate([rcTag('v1.2.1-rc.1', { annotated: false, subject: '' })]).detail, /not made by `colab release cut`/);
  assert.match(rf.selectCandidate([rcTag('v1.2.1-rc.1', { subject: 'my own rc' })]).detail, /not made by `colab release cut`/);
  const off = rf.selectCandidate([rcTag('v1.2.1-rc.1', { onMain: false })]);
  assert.strictEqual(off.kind, 'refused');
  assert.match(off.detail, /not on origin\/main/);
});

test('selectCandidate: --tag must be the newest candidate', () => {
  const tags = [rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2')];
  assert.strictEqual(rf.selectCandidate(tags, 'v1.2.1-rc.2').kind, 'candidate');
  const old = rf.selectCandidate(tags, 'v1.2.1-rc.1');
  assert.strictEqual(old.kind, 'refused');
  assert.match(old.detail, /not the newest candidate \(v1\.2\.1-rc\.2\)/);
  assert.strictEqual(rf.selectCandidate(tags, 'v9.9.9-rc.1').kind, 'refused');
  assert.strictEqual(rf.selectCandidate(tags, 'v1.2.1').kind, 'refused');
});

// ---- tracking issue contract ---------------------------------------------------------------------

test('tracking issue: the body starts with the version marker and names the veto; markers round-trip', () => {
  const body = rf.trackingBody({ version: 'v1.2.1', row: 'released-no-production', final: 'auto', testPeriodDays: 3 });
  assert.strictEqual(body.split('\n')[0], '<!-- colab:release version=v1.2.1 -->');
  assert.strictEqual(rf.parseReleaseMarker(body), 'v1.2.1');
  assert.match(body, /release-hold/);
  assert.match(body, /colab blocked/);
  assert.strictEqual(rf.parseReleaseMarker('release: v1.2.1'), null, 'the title alone never counts');
  assert.strictEqual(rf.trackingTitle('v1.2.1'), 'release: v1.2.1');
  const fields = { state: 'finalized', tag: 'v1.2.1' };
  assert.ok(rf.hasEvent([{ body: `${rf.eventMarker(fields)}\ntext` }], fields));
  assert.ok(!rf.hasEvent([{ body: rf.eventMarker({ candidate: 'v1.2.1-rc.1' }) }], fields));
});

// ---- period -------------------------------------------------------------------------------------

test('periodVerdict: starts at the later of the cut and the tracking issue, ends exactly N days on', () => {
  const late = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: at(1), testPeriodDays: 3, now: at(3.5) });
  assert.strictEqual(late.start, at(1), 'a late tracking issue never shortens the window');
  assert.strictEqual(late.endsAt, at(4));
  assert.strictEqual(late.elapsed, false);
  assert.strictEqual(rf.periodVerdict({ cutAt: T0, trackingCreatedAt: at(1), testPeriodDays: 3, now: at(4) }).elapsed, true, 'the boundary itself counts as elapsed');
  const early = rf.periodVerdict({ cutAt: at(1), trackingCreatedAt: T0, testPeriodDays: 3, now: at(3) });
  assert.strictEqual(early.start, at(1));
  const none = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: null, testPeriodDays: 3, now: at(5) });
  assert.strictEqual(none.start, at(5), 'no tracking issue yet: it would open now, so the period starts now');
});

// ---- trunk green --------------------------------------------------------------------------------

const run = (o) => ({ headSha: 'c'.repeat(40), status: 'completed', conclusion: 'success', workflowName: 'ci', event: 'push', createdAt: at(1), ...o });
const TG = { periodStart: at(0.5), suiteWorkflows: ['ci'], truncated: false };

test('trunkGreenVerdict: a red run in the window is permanent; before the window it does not count', () => {
  const red = rf.trunkGreenVerdict([run({ conclusion: 'failure' })], TG);
  assert.deepStrictEqual([red.ok, red.permanent], [false, true]);
  assert.strictEqual(rf.trunkGreenVerdict([run({ conclusion: 'failure', createdAt: at(0.1) })], TG).ok, true);
});

test('trunkGreenVerdict: cancelled is fine only with a later success; in flight is pending', () => {
  assert.strictEqual(rf.trunkGreenVerdict([run({ conclusion: 'cancelled' }), run({ createdAt: at(1.1) })], TG).ok, true);
  const alone = rf.trunkGreenVerdict([run({ conclusion: 'cancelled' })], TG);
  assert.deepStrictEqual([alone.ok, alone.permanent, alone.pending], [false, false, false]);
  const later = rf.trunkGreenVerdict([run({ conclusion: 'cancelled' }), run({ status: 'in_progress', conclusion: '', createdAt: at(1.1) })], TG);
  assert.deepStrictEqual([later.ok, later.pending], [false, true]);
  const flying = rf.trunkGreenVerdict([run({ status: 'queued', conclusion: '' })], TG);
  assert.deepStrictEqual([flying.ok, flying.permanent, flying.pending], [false, false, true]);
});

test('trunkGreenVerdict: a foreign workflow or a pull_request run cannot veto; unread or truncated fails closed', () => {
  assert.strictEqual(rf.trunkGreenVerdict([run({ conclusion: 'failure', workflowName: 'nightly-scan' })], TG).ok, true);
  assert.strictEqual(rf.trunkGreenVerdict([run({ conclusion: 'failure', event: 'pull_request' })], TG).ok, true);
  assert.strictEqual(rf.trunkGreenVerdict(null, TG).ok, false);
  assert.strictEqual(rf.trunkGreenVerdict([], { ...TG, truncated: true }).ok, false);
  assert.strictEqual(rf.trunkGreenVerdict([], TG).ok, true, 'no run in the window is clean');
});

// ---- regressions --------------------------------------------------------------------------------

test('regressionVerdict: open refuses; closed after the start needs a new candidate; closed before is fine', () => {
  const start = { periodStart: at(1) };
  const open = rf.regressionVerdict([{ number: 7, state: 'open' }], start);
  assert.deepStrictEqual([open.ok, open.permanent], [false, false]);
  const after = rf.regressionVerdict([{ number: 7, state: 'closed', closedAt: at(2) }], start);
  assert.deepStrictEqual([after.ok, after.permanent], [false, true]);
  assert.strictEqual(rf.regressionVerdict([{ number: 7, state: 'closed', closedAt: at(0.5) }], start).ok, true);
  assert.strictEqual(rf.regressionVerdict([], start).ok, true);
  assert.strictEqual(rf.regressionVerdict(null, start).ok, false);
});

// ---- decide -------------------------------------------------------------------------------------

const OK = { ok: true, detail: 'ok' };
function facts(over = {}) {
  const selection = rf.selectCandidate([rcTag('v1.2.1-rc.1')]);
  return {
    policy: AUTO,
    selection,
    tracking: { number: 12, createdAt: T0, held: false },
    supersededHeld: [],
    period: rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(4) }),
    trunk: { ok: true, permanent: false, pending: false, detail: 'green' },
    regressions: { ok: true, permanent: false, detail: 'none' },
    ci: OK, suite: OK, schema: OK, switches: OK,
    manifests: [], ancestry: { ok: true, shallow: false }, tags: ['v1.2.0', 'v1.2.1-rc.1'],
    human: { bar: false, answeredBy: null },
    ...over,
  };
}

test('decide: every state and condition name is in the frozen vocabulary', () => {
  const v = rf.decide(facts());
  assert.ok(rf.STATES.includes(v.state));
  for (const c of v.checks) assert.ok(rf.CONDITIONS.includes(c.condition), c.condition);
});

test('decide, auto row: clean period -> finalized; before its end -> testing; pending trunk -> testing', () => {
  const v = rf.decide(facts());
  assert.strictEqual(v.state, 'finalized');
  assert.strictEqual(v.finalTag, 'v1.2.1');
  assert.strictEqual(rf.decide(facts({ period: rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(2) }) })).state, 'testing');
  assert.strictEqual(rf.decide(facts({ trunk: { ok: false, permanent: false, pending: true, detail: 'in flight' } })).state, 'testing');
});

test('decide: release-hold wins over everything after the candidate — on the current or a superseded issue', () => {
  assert.strictEqual(rf.decide(facts({ tracking: { number: 12, createdAt: T0, held: true } })).state, 'held');
  const sup = rf.decide(facts({ supersededHeld: [9] }));
  assert.strictEqual(sup.state, 'held');
  assert.match(sup.checks.find((c) => c.condition === 'release-hold').detail, /#9/);
  assert.strictEqual(rf.decide(facts({ tracking: { number: 12, createdAt: T0, held: true }, regressions: { ok: false, permanent: true, detail: 'x' } })).state, 'held');
});

test('decide: a regression fixed after the start, or a red trunk on the auto row, needs a new candidate', () => {
  assert.strictEqual(rf.decide(facts({ regressions: { ok: false, permanent: true, detail: 'x' } })).state, 'needs-new-candidate');
  assert.strictEqual(rf.decide(facts({ trunk: { ok: false, permanent: true, pending: false, detail: 'red' } })).state, 'needs-new-candidate');
  assert.strictEqual(rf.decide(facts({ regressions: { ok: false, permanent: false, detail: 'open' } })).state, 'refused');
  assert.strictEqual(rf.decide(facts({ ci: { ok: false, detail: 'red' } })).state, 'refused');
  assert.strictEqual(rf.decide(facts({ schema: { ok: false, detail: 'drop' } })).state, 'refused');
});

test('decide, human row: no bar -> candidate-ready with the pinned handoff; bar -> finalized; the period is informational', () => {
  const early = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(1) });
  const ready = rf.decide(facts({ policy: HUMAN, period: early, trunk: { ok: false, permanent: true, pending: false, detail: 'red' } }));
  assert.strictEqual(ready.state, 'candidate-ready');
  assert.strictEqual(ready.finalTag, null);
  assert.match(ready.handoff, /--tag v1\.2\.1-rc\.1/);
  assert.match(ready.handoff, /--answered-by/);
  assert.strictEqual(ready.checks.find((c) => c.condition === 'test-period').required, false);
  const done = rf.decide(facts({ policy: HUMAN, period: early, human: { bar: true, answeredBy: 'Ops' } }));
  assert.strictEqual(done.state, 'finalized');
  assert.strictEqual(rf.decide(facts({ policy: HUMAN, human: { bar: true, answeredBy: 'Ops' }, tracking: { number: 12, createdAt: T0, held: true } })).state, 'held', 'the bar never overrides a hold');
});

test('decide: rows with nothing to finalize refuse; no candidate and already-final are their own states', () => {
  for (const cfg of [{ exposure: 'self' }, { exposure: 'live', deploy: 'push-main' }, { tier: 'B' }]) {
    assert.strictEqual(rf.decide(facts({ policy: releasePolicy.evaluateRelease({ trunk: 'main', ...cfg }) })).state, 'refused', JSON.stringify(cfg));
  }
  assert.strictEqual(rf.decide(facts({ selection: rf.selectCandidate([]) })).state, 'no-candidate');
  assert.strictEqual(rf.decide(facts({ selection: { kind: 'already-final', version: 'v1.2.1', detail: 'x' } })).state, 'already-final');
  assert.strictEqual(rf.decide(facts({ selection: rf.selectCandidate([rcTag('v1.2.1-rc.1', { onMain: false })]) })).state, 'refused');
  assert.strictEqual(rf.decide(facts({ tracking: { error: 'two open' } })).state, 'refused');
});

test('handoff and tag message', () => {
  assert.strictEqual(rf.handoffCommand('v1.2.1-rc.2'), 'COLAB_HUMAN=1 colab release finalize --tag v1.2.1-rc.2 --answered-by "<your name>"');
  const f = facts();
  const v = rf.decide(f);
  const msg = rf.tagMessage(v, { candidate: f.selection.candidate, period: f.period, actor: 'automatic' });
  assert.match(msg.split('\n')[0], /^v1\.2\.1 — release \(colab release finalize\)$/);
  assert.match(msg, /Candidate: v1\.2\.1-rc\.1/);
  assert.match(msg, /- trunk-green: ok/);
});

// ---- --auto: newest clean candidate, each on its own clock (#423) -------------------------------

/**
 * A repo cutting one candidate a day: rc.1 at day 0, rc.2 at day 1, … rc.K at day K-1, all v1.3.0
 * (the version only moves on a feat). Judges each the way the CLI's --auto walk does: its own
 * period from its own cut, trunk read over its own window, then pickNewestClean.
 */
function dailyWalk({ days, now, redAt = null, regressions = [], held = false }) {
  const tags = [{ name: 'v1.2.0', annotated: true, sha: 'f'.repeat(40), date: at(-10), subject: 'v1.2.0', onMain: true }];
  for (let d = 0; d < days; d++) tags.push(rcTag(`v1.3.0-rc.${d + 1}`, { date: at(d), sha: String(d).repeat(40).slice(0, 40) }));
  const runs = [];
  for (let d = 0; d <= now; d += 0.25) runs.push({ workflowName: 'ci', status: 'completed', conclusion: redAt !== null && Math.abs(d - redAt) < 0.01 ? 'failure' : 'success', createdAt: at(d), headSha: 'x', event: 'push' });
  const evals = [];
  for (const c of rf.openCandidates(tags)) {
    const period = rf.periodVerdict({ cutAt: c.cutAt, trackingCreatedAt: T0, testPeriodDays: 3, now: at(now) });
    if (!period.elapsed && evals.length) continue;
    const trunk = rf.trunkGreenVerdict(runs, { periodStart: period.start, periodEnd: period.endsAt, suiteWorkflows: ['ci'] });
    const verdict = rf.decide(facts({
      selection: { kind: 'candidate', candidate: c, superseded: [], detail: c.tag },
      tracking: { number: 12, createdAt: T0, held }, period, trunk,
      regressions: rf.regressionVerdict(regressions, { periodStart: period.start }), tags: tags.map((t) => t.name),
    }));
    evals.push({ candidate: c, verdict });
  }
  return rf.pickNewestClean(evals);
}

test('--auto: with a candidate cut every day, a final still lands every test period', () => {
  // day 3: rc.1 (cut day 0) has had its full 3 days; rc.2..rc.4 are younger. Before #423 the newest
  // (rc.4) was the only one judged, and it is always < 3 days old — no final, ever.
  const p = dailyWalk({ days: 4, now: 3.1 });
  assert.strictEqual(p.verdict.state, 'finalized');
  assert.strictEqual(p.candidate.tag, 'v1.3.0-rc.1');
  // day 6: rc.4 (cut day 3) is the newest one whose own period elapsed — newer ones do not restart it.
  const later = dailyWalk({ days: 7, now: 6.1 });
  assert.strictEqual(later.candidate.tag, 'v1.3.0-rc.4');
  assert.strictEqual(later.verdict.state, 'finalized');
  // day 2: nobody's period elapsed yet — the newest is reported testing.
  assert.strictEqual(dailyWalk({ days: 3, now: 2 }).verdict.state, 'testing');
});

test('--auto: a red trunk run inside a candidate\'s own window disqualifies it, not older or newer ones outside it', () => {
  // red at day 3.5: rc.4 (window day 3..6) saw it; rc.3 (window day 2..5) saw it; rc.1 (0..3) did not.
  const p = dailyWalk({ days: 7, now: 6.1, redAt: 3.5 });
  assert.notStrictEqual(p.candidate.tag, 'v1.3.0-rc.4');
  assert.strictEqual(p.verdict.state, 'finalized');
  assert.strictEqual(p.candidate.tag, 'v1.3.0-rc.1');
});

test('--auto: the hold and the regression rules are unchanged', () => {
  assert.strictEqual(dailyWalk({ days: 4, now: 3.1, held: true }).verdict.state, 'held');
  const open = dailyWalk({ days: 4, now: 3.1, regressions: [{ number: 7, state: 'open' }] });
  assert.notStrictEqual(open.verdict.state, 'finalized');
  // fixed at day 1.5: rc.1/rc.2 periods began before the fix (not in them) — rc.3 (cut day 2) carries it.
  const fixed = dailyWalk({ days: 6, now: 5.1, regressions: [{ number: 7, state: 'closed', closedAt: at(1.5) }] });
  assert.strictEqual(fixed.candidate.tag, 'v1.3.0-rc.3');
  assert.strictEqual(fixed.verdict.state, 'finalized');
});

test('openCandidates: newest first; a hand-made or off-main one is listed with its refusal', () => {
  const c = rf.openCandidates([rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2', { onMain: false }), rcTag('v1.3.0-rc.1', { subject: 'mine' }), { name: 'v1.2.0', annotated: true, sha: 'b', date: T0, subject: 'x', onMain: true }]);
  assert.deepStrictEqual(c.map((x) => x.tag), ['v1.3.0-rc.1', 'v1.2.1-rc.2', 'v1.2.1-rc.1']);
  assert.match(c[0].refused, /not made by/);
  assert.match(c[1].refused, /not on origin\/main/);
  assert.strictEqual(c[2].refused, null);
});

test('trunkGreenVerdict: periodEnd bounds the window', () => {
  const runs = [{ workflowName: 'ci', status: 'completed', conclusion: 'failure', createdAt: at(5), headSha: 'x', event: 'push' }];
  assert.strictEqual(rf.trunkGreenVerdict(runs, { periodStart: at(0), suiteWorkflows: ['ci'] }).ok, false);
  assert.strictEqual(rf.trunkGreenVerdict(runs, { periodStart: at(0), periodEnd: at(3), suiteWorkflows: ['ci'] }).ok, true);
});

// ---- pre-tag checks before a final (#424) -------------------------------------------------------

test('decide: each pre-tag check refuses a final under its own name', () => {
  const name = (v) => v.checks.filter((c) => c.required && !c.ok).map((c) => c.condition);
  const man = rf.decide(facts({ manifests: [{ file: 'VERSION', version: '1.2.0' }] }));
  assert.strictEqual(man.state, 'refused');
  assert.deepStrictEqual(name(man), ['manifest-version']);
  const shallow = rf.decide(facts({ ancestry: { ok: false, shallow: true } }));
  assert.deepStrictEqual(name(shallow), ['on-trunk']);
  const back = rf.decide(facts({ tags: ['v1.2.0', 'v1.4.0', 'v1.2.1-rc.1'] }));
  assert.strictEqual(back.state, 'refused');
  assert.deepStrictEqual(name(back), ['outranks-final']);
});

// ---- announcing the final (#426) ----------------------------------------------------------------

test('carriedIssues: every GitHub closing keyword, deduplicated and sorted, tracking issues excluded', () => {
  const msgs = [
    'fix: a bug (#40)\n\nCloses #12',
    'feat: thing\n\nFixes: #3\nresolved #12\nRefs #77',
    'chore: release record\n\nCloses #100',
    '',
  ];
  assert.deepStrictEqual(rf.carriedIssues(msgs, { exclude: [100] }), [3, 12]);
  assert.deepStrictEqual(rf.carriedIssues(['docs: mentions #5 and (#6)']), [], 'a bare reference is not carried — only what trunk closed');
});

test('previousFinal: the highest final strictly below the version, never a candidate', () => {
  const tags = ['v1.1.0', 'v1.2.0', 'v1.2.1-rc.1', 'v1.3.0', 'v1.2.1'];
  assert.strictEqual(rf.previousFinal(tags, 'v1.3.0'), 'v1.2.1');
  assert.strictEqual(rf.previousFinal(tags, 'v1.1.0'), null);
});

test('releasedComment: carries the per-version event marker hasEvent finds', () => {
  const body = rf.releasedComment('v1.3.0', 'abcdef1234567');
  assert.match(body, /Released in \*\*v1\.3\.0\*\* \(`abcdef1`\)/);
  assert.ok(rf.hasEvent([{ body }], rf.releasedEvent('v1.3.0')));
  assert.ok(!rf.hasEvent([{ body }], rf.releasedEvent('v1.3.1')));
});
