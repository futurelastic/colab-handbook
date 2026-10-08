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

test('#548 selectCandidate: --tag may name an older open candidate — marked older, newer ones named and left open', () => {
  const tags = [rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2'), rcTag('v1.3.0-rc.1')];
  const newest = rf.selectCandidate(tags, 'v1.3.0-rc.1');
  assert.strictEqual(newest.kind, 'candidate');
  assert.ok(!newest.older);
  const old = rf.selectCandidate(tags, 'v1.2.1-rc.1');
  assert.strictEqual(old.kind, 'candidate');
  assert.strictEqual(old.older, true);
  assert.strictEqual(old.newest, 'v1.3.0-rc.1');
  assert.deepStrictEqual([old.candidate.tag, old.candidate.version, old.candidate.n], ['v1.2.1-rc.1', 'v1.2.1', 1]);
  assert.deepStrictEqual(old.superseded, [], 'nothing below v1.2.1 is open; v1.3.0 is newer and stays open');
  assert.match(old.detail, /older candidate, judged on its own clock \(newer, still open: v1\.2\.1-rc\.2, v1\.3\.0-rc\.1\)/);
  assert.strictEqual(rf.selectCandidate([rcTag('v1.2.0-rc.1'), ...tags], 'v1.2.1-rc.2').superseded.join(), 'v1.2.0');
  // an older pin is still held to the cut contract
  assert.match(rf.selectCandidate([rcTag('v1.2.1-rc.1', { onMain: false }), rcTag('v1.2.1-rc.2')], 'v1.2.1-rc.1').detail, /not on origin\/main/);
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

test('#437 windowBranches: main alone on trunk: main; trunk: dev reads dev AND main', () => {
  assert.deepStrictEqual(rf.windowBranches('main'), ['main']);
  assert.deepStrictEqual(rf.windowBranches(undefined), ['main'], 'no trunk: declared reads main, as before');
  assert.deepStrictEqual(rf.windowBranches('dev'), ['dev', 'main']);
  assert.deepStrictEqual(rf.windowBranches('develop'), ['develop', 'main'], 'any trunk: spelling, not a fixed one');
});

test('#437 mergeWindowRuns: tags each row with its branch, dedups by databaseId, fails closed on any unread branch', () => {
  const m = rf.mergeWindowRuns([
    { branch: 'dev', read: { runs: [run({ databaseId: 1 }), run({ databaseId: 2 })], truncated: false } },
    { branch: 'main', read: { runs: [run({ databaseId: 2 }), run({ databaseId: 3 })], truncated: false } },
  ]);
  assert.deepStrictEqual(m.runs.map((r) => [r.databaseId, r.branch]), [[1, 'dev'], [2, 'dev'], [3, 'main']]);
  assert.strictEqual(m.truncated, false);
  assert.strictEqual(rf.mergeWindowRuns([{ branch: 'dev', read: null }, { branch: 'main', read: { runs: [], truncated: false } }]), null, 'a window missing one branch is not clean');
  assert.strictEqual(rf.mergeWindowRuns([{ branch: 'dev', read: { runs: [], truncated: true } }, { branch: 'main', read: { runs: [], truncated: false } }]).truncated, true);
  assert.strictEqual(rf.mergeWindowRuns([]), null);
});

test('#437 trunkGreenVerdict over dev + main: a red dev run vetoes; a later run on another branch never settles a cancellation', () => {
  const B = { ...TG, branches: ['dev', 'main'] };
  const red = rf.trunkGreenVerdict([run({ branch: 'main' }), run({ branch: 'dev', conclusion: 'failure' })], B);
  assert.deepStrictEqual([red.ok, red.permanent], [false, true]);
  assert.match(red.detail, /failure on dev/);
  const cross = rf.trunkGreenVerdict([run({ branch: 'dev', conclusion: 'cancelled' }), run({ branch: 'main', createdAt: at(1.1) })], B);
  assert.strictEqual(cross.ok, false, 'main\'s later success tested other code than the cancelled dev run');
  assert.match(cross.detail, /cancelled on dev/);
  const same = rf.trunkGreenVerdict([run({ branch: 'dev', conclusion: 'cancelled' }), run({ branch: 'dev', createdAt: at(1.1) })], B);
  assert.strictEqual(same.ok, true);
  assert.match(same.detail, /on dev \+ main/);
  assert.match(rf.trunkGreenVerdict(null, B).detail, /on dev \+ main failed/);
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
    ci: OK, suite: OK, cutRun: OK, schema: OK, switches: OK,
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

test('#549 decide, human row with test-period 0d: no period — the bar finalizes at once, an agent run is candidate-ready', () => {
  const ZERO = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: 'https://x.invalid', deploy: 'tag', release: { 'test-period': '0d' } });
  assert.deepStrictEqual(ZERO.findings, []);
  const period = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 0, now: T0 });
  assert.strictEqual(period.elapsed, true);
  assert.strictEqual(period.days, 0);
  assert.match(period.detail, /no test period/);
  const ready = rf.decide(facts({ policy: ZERO, period }));
  assert.strictEqual(ready.state, 'candidate-ready');
  const tp = ready.checks.find((c) => c.condition === 'test-period');
  assert.strictEqual(tp.required, false);
  assert.strictEqual(tp.ok, true);
  const done = rf.decide(facts({ policy: ZERO, period, human: { bar: true, answeredBy: 'Ops' } }));
  assert.strictEqual(done.state, 'finalized');
  const msg = rf.tagMessage(done, { candidate: { version: 'v1.2.1', tag: 'v1.2.1-rc.1', sha: 'a'.repeat(40) }, period, actor: 'Ops' });
  assert.match(msg, /Test period: none \(release\.test-period: 0d/);
  assert.strictEqual(rf.decide(facts({ policy: ZERO, period, human: { bar: true, answeredBy: 'Ops' }, tracking: { number: 12, createdAt: T0, held: true } })).state, 'held', 'no period never lifts a hold');
});

test('#548 decide, human row, older --tag: its own clean period -> candidate-ready / finalized; still testing, a regression or red in its window -> no final', () => {
  const selection = rf.selectCandidate([rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2', { date: at(3.5) })], 'v1.2.1-rc.1');
  const bar = { bar: true, answeredBy: 'Ops' };
  const elapsed = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(4) });
  const young = rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(2) });
  const older = (over) => rf.decide(facts({ policy: HUMAN, selection, period: elapsed, ...over }));

  // older eligible
  const ready = older();
  assert.strictEqual(ready.state, 'candidate-ready');
  assert.match(ready.handoff, /--tag v1\.2\.1-rc\.1 /, 'the handoff names the older candidate, not the newest');
  const tp = ready.checks.find((c) => c.condition === 'test-period');
  assert.strictEqual(tp.required, true, 'an older pin is held to its own period, on a human row too');
  assert.match(tp.detail, /#548/);
  assert.strictEqual(ready.checks.find((c) => c.condition === 'trunk-green').required, true);
  const done = older({ human: bar });
  assert.strictEqual(done.state, 'finalized');
  assert.strictEqual(done.finalTag, 'v1.2.1');

  // older still testing — the human bar does not shorten its period
  assert.strictEqual(older({ period: young, human: bar }).state, 'testing');
  assert.strictEqual(older({ human: bar, trunk: { ok: false, permanent: false, pending: true, detail: 'in flight' } }).state, 'testing');
  // older with a regression
  assert.strictEqual(older({ human: bar, regressions: { ok: false, permanent: false, detail: 'open #7' } }).state, 'refused');
  assert.strictEqual(older({ human: bar, regressions: { ok: false, permanent: true, detail: 'fixed after start' } }).state, 'needs-new-candidate');
  // red inside its own window
  assert.strictEqual(older({ human: bar, trunk: { ok: false, permanent: true, pending: false, detail: 'red' } }).state, 'needs-new-candidate');
  // a hold still wins
  assert.strictEqual(older({ human: bar, supersededHeld: [9] }).state, 'held');

  // the newest pin on the same row keeps #549's rule: the period is informational
  const newest = rf.selectCandidate([rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2')], 'v1.2.1-rc.2');
  assert.strictEqual(rf.decide(facts({ policy: HUMAN, selection: newest, period: young, human: bar })).state, 'finalized');
});

test('#548 decide, auto row, older --tag: same rule as the newest — its own clean period finalizes', () => {
  const selection = rf.selectCandidate([rcTag('v1.2.1-rc.1'), rcTag('v1.2.1-rc.2', { date: at(3.5) })], 'v1.2.1-rc.1');
  assert.strictEqual(rf.decide(facts({ selection })).state, 'finalized');
  assert.strictEqual(rf.decide(facts({ selection, period: rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(2) }) })).state, 'testing');
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
  // #484: AUTO (public-tool) defaults to version-source: tag, so a refusing manifest is declared
  const pinned = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: null, deploy: 'none', release: { 'version-source': 'manifest' } });
  const man = rf.decide(facts({ policy: pinned, manifests: [{ file: 'VERSION', version: '1.2.0' }] }));
  assert.strictEqual(man.state, 'refused');
  assert.deepStrictEqual(name(man), ['manifest-version']);
  const shallow = rf.decide(facts({ ancestry: { ok: false, shallow: true } }));
  assert.deepStrictEqual(name(shallow), ['on-trunk']);
  const back = rf.decide(facts({ tags: ['v1.2.0', 'v1.4.0', 'v1.2.1-rc.1'] }));
  assert.strictEqual(back.state, 'refused');
  assert.deepStrictEqual(name(back), ['outranks-final']);
});

test('#484: under the default, a lagging manifest does not refuse a final — cut and finalize agree', () => {
  const blocked = (v) => v.checks.filter((c) => c.required && !c.ok).map((c) => c.condition);
  for (const policy of [AUTO, HUMAN]) {
    assert.strictEqual(policy.effective.versionSource, 'tag');
    const v = rf.decide(facts({ policy, manifests: [{ file: 'VERSION', version: '1.2.0' }] }));
    assert.ok(!blocked(v).includes('manifest-version'), `${policy.effective.route}: ${JSON.stringify(blocked(v))}`);
  }
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

// ---- #441: an operator-granted automatic final on deploy-tag -------------------------------------

const GRANTED = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: 'https://x.invalid', deploy: 'tag', release: { final: 'auto', 'final-grant': 77 } });
const GRANT_OK = { ok: true, ruledBy: 'Operator', detail: 'release.final-grant #77: decision recorded, ruled by Operator' };
const NO_MIGRATION = rf.migrationGrantVerdict({ paths: [], grant: null, since: 'v1.2.0' });

test('#441 (a): deploy-tag with no grant -> a human final, as today', () => {
  const v = rf.decide(facts({ policy: HUMAN }));
  assert.strictEqual(v.state, 'candidate-ready');
  assert.strictEqual(v.grant, null);
  assert.ok(!v.checks.some((c) => c.condition === 'final-grant'));
});

test('#441 (b): a valid grant -> an automatic final, and the tag message names whose choice it was', () => {
  assert.deepStrictEqual(GRANTED.findings, []);
  const f = facts({ policy: GRANTED, finalGrant: GRANT_OK, migrations: NO_MIGRATION });
  const v = rf.decide(f);
  assert.strictEqual(v.state, 'finalized');
  assert.strictEqual(v.finalTag, 'v1.2.1');
  assert.deepStrictEqual(v.grant, { issue: 77, ruledBy: 'Operator' });
  for (const c of v.checks) assert.ok(rf.CONDITIONS.includes(c.condition), c.condition);
  const msg = rf.tagMessage(v, { candidate: f.selection.candidate, period: f.period, actor: 'automatic' });
  assert.match(msg, /Automatic final granted by: release\.final-grant -> decision #77, ruled by Operator/);
  // the auto conditions still apply: before the period ends it is testing, a hold still holds
  assert.strictEqual(rf.decide({ ...f, period: rf.periodVerdict({ cutAt: T0, trackingCreatedAt: T0, testPeriodDays: 3, now: at(1) }) }).state, 'testing');
  assert.strictEqual(rf.decide({ ...f, tracking: { number: 12, createdAt: T0, held: true } }).state, 'held');
});

test('#441 (c): a valid grant + an ungranted migration -> no automatic final; the human command is handed over', () => {
  const migrations = rf.migrationGrantVerdict({ paths: ['database/migrations/2026_10_02_add_x.php'], grant: { issue: 12, ok: false, reason: '#12 does not carry the `migration-granted` label' }, since: 'v1.2.0' });
  assert.strictEqual(migrations.ok, false);
  const v = rf.decide(facts({ policy: GRANTED, finalGrant: GRANT_OK, migrations }));
  assert.strictEqual(v.state, 'candidate-ready');
  assert.strictEqual(v.finalTag, null);
  assert.strictEqual(v.grant, null);
  assert.match(v.handoff, /COLAB_HUMAN=1 colab release finalize --tag v1\.2\.1-rc\.1/);
  const m = v.checks.find((c) => c.condition === 'migration-grant');
  assert.strictEqual(m.ok, false);
  assert.match(m.detail, /add_x\.php.*falls back to a human act/);
  // granted on the tracking issue -> automatic again
  const granted = rf.migrationGrantVerdict({ paths: ['database/migrations/2026_10_02_add_x.php'], grant: { issue: 12, ok: true }, since: 'v1.2.0' });
  assert.strictEqual(rf.decide(facts({ policy: GRANTED, finalGrant: GRANT_OK, migrations: granted })).state, 'finalized');
  // unread migrations never count as none
  assert.strictEqual(rf.migrationGrantVerdict({ paths: null }).ok, false);
});

test('#441: a grant that no longer resolves (reopened, unread) falls back to a human final; the human bar still works', () => {
  const reopened = { ok: false, ruledBy: null, detail: 'release.final-grant #77 does not grant an automatic final: its decision was reopened' };
  const v = rf.decide(facts({ policy: GRANTED, finalGrant: reopened, migrations: NO_MIGRATION }));
  assert.strictEqual(v.state, 'candidate-ready');
  assert.match(v.checks.find((c) => c.condition === 'final-grant').detail, /reopened — the final falls back to a human act/);
  assert.strictEqual(rf.decide(facts({ policy: GRANTED, migrations: NO_MIGRATION })).state, 'candidate-ready', 'unresolved = no grant');
  const human = rf.decide(facts({ policy: GRANTED, finalGrant: GRANT_OK, migrations: NO_MIGRATION, human: { bar: true, answeredBy: 'Ops' } }));
  assert.strictEqual(human.state, 'finalized');
  assert.strictEqual(human.grant, null, 'a human-bar final is the human\'s, not the grant\'s');
});

// ---- #446: deploy-tag-fast has no candidate to finalize --------------------------------------------

test('#446 deploy-tag-fast: finalize reports no-candidate and never finalizes a leftover -rc', () => {
  const fast = releasePolicy.evaluateRelease({ trunk: 'main', exposure: 'released', production: 'https://x.invalid', deploy: 'tag',
    release: { route: 'deploy-tag-fast', 'final-grant': 77, 'health-url': 'https://x.invalid/health', rollback: 'auto' } });
  assert.deepStrictEqual(fast.findings, []);
  const v = rf.decide(facts({ policy: fast, finalGrant: GRANT_OK, migrations: NO_MIGRATION }));
  assert.strictEqual(v.state, 'no-candidate');
  assert.strictEqual(v.finalTag, null);
  assert.match(v.checks.find((c) => c.condition === 'candidate').detail, /deploy-tag-fast cuts its finals/);
});

// ---- #468: why no final -------------------------------------------------------------------------

test('#468 trunkGreenVerdict carries redAt; windowHasRed reads the same half-open window', () => {
  const red = rf.trunkGreenVerdict([run({ conclusion: 'failure', createdAt: at(1) })], TG);
  assert.deepStrictEqual(red.redAt, [at(1)]);
  const period = { start: at(0), endsAt: at(1) };
  assert.strictEqual(rf.windowHasRed(period, [at(0.5)]), at(0.5));
  assert.strictEqual(rf.windowHasRed(period, [at(0)]), at(0), 'the start is inside');
  assert.strictEqual(rf.windowHasRed(period, [at(1)]), null, 'endsAt is outside, as in trunkGreenVerdict');
  assert.strictEqual(rf.windowHasRed(period, []), null);
});

test('#468 pickNewestClean: every skipped candidate says why, and when its own period ends', () => {
  const p = dailyWalk({ days: 4, now: 2 }); // nothing has elapsed yet
  assert.strictEqual(p.verdict.state, 'testing');
  // dailyWalk judges only the newest when none elapsed — so evaluate several by hand.
  const evals = ['v1.3.0-rc.3', 'v1.3.0-rc.2'].map((tag, i) => ({
    candidate: { tag },
    verdict: { state: i ? 'needs-new-candidate' : 'testing', checks: [
      { condition: 'test-period', ok: !!i, required: true, detail: '3d test period … (20h left)' },
      { condition: 'trunk-green', ok: !i, required: true, detail: 'trunk went red at X' },
    ] },
    period: { start: at(i), endsAt: at(3 + i) },
  }));
  const pick = rf.pickNewestClean(evals);
  assert.deepStrictEqual(pick.skipped, [{ tag: 'v1.3.0-rc.2', state: 'needs-new-candidate', detail: 'trunk-green: trunk went red at X', endsAt: at(4) }]);
});

test('#468 whyNoFinal: all testing names the earliest end; a stuck state names its check; a final explains nothing', () => {
  const checks = [{ condition: 'test-period', ok: false, required: true, detail: 'ends later (40h left)' }];
  const testing = rf.whyNoFinal({
    state: 'testing', candidate: { tag: 'v1.3.0-rc.5' }, checks, period: { endsAt: at(5) },
    skipped: [{ tag: 'v1.3.0-rc.4', state: 'testing', endsAt: at(4.5) }, { tag: 'v1.3.0-rc.1', state: 'testing', endsAt: at(3) }],
    now: at(2),
  });
  assert.deepStrictEqual(testing.next, { tag: 'v1.3.0-rc.1', endsAt: at(3), hoursLeft: 24 });
  assert.match(testing.line, /^no candidate's own test period has elapsed clean — v1\.3\.0-rc\.1 is first, its own test period ends .* \(24h left\)$/);

  const mixed = rf.whyNoFinal({
    state: 'testing', candidate: { tag: 'v1.3.0-rc.5' }, checks, period: { endsAt: at(5) },
    skipped: [{ tag: 'v1.3.0-rc.2', state: 'needs-new-candidate', endsAt: at(4) }], now: at(2),
  });
  assert.match(mixed.line, /v1\.3\.0-rc\.5 is still testing \(test-period: ends later \(40h left\)\); v1\.3\.0-rc\.5 is first.*; older candidates: 1 needs-new-candidate$/);

  const stuck = rf.whyNoFinal({
    state: 'needs-new-candidate', candidate: { tag: 'v1.3.0-rc.5' },
    checks: [{ condition: 'trunk-green', ok: false, required: true, detail: 'trunk went red during the test period: ci failure' }],
    skipped: [], now: at(2),
  });
  assert.strictEqual(stuck.next, null);
  assert.strictEqual(stuck.line, 'v1.3.0-rc.5: needs-new-candidate — trunk-green: trunk went red during the test period: ci failure');

  assert.strictEqual(rf.whyNoFinal({ state: 'finalized', now: at(2) }), null);
  assert.strictEqual(rf.whyNoFinal({ state: 'already-final', now: at(2) }), null);
  assert.match(rf.whyNoFinal({ state: 'no-candidate', checks: [{ condition: 'candidate', ok: false, detail: 'no rc tag' }], now: at(2) }).line, /^no open candidate to finalize — candidate: no rc tag$/);
});

// ---- #566: the run that cut the candidate --------------------------------------------------------

const CUT = '2026-10-07T10:00:00.000Z';
const off = (min) => new Date(Date.parse(CUT) + min * 60000).toISOString();
const cutRow = (over) => ({ headSha: 'a'.repeat(40), status: 'completed', conclusion: 'success', workflowName: 'Release (auto)', event: 'workflow_run', ...over });

test('#566 cutRunVerdict: the cutter cancelled, an older green run at the same sha that cut nothing -> not ok, names the run', () => {
  const rows = [
    cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(20), conclusion: 'cancelled' }), // cut at CUT, then its publish was cancelled
    cutRow({ databaseId: 901, createdAt: off(-60), updatedAt: off(-50), conclusion: 'success' }), // earlier run, "nothing to cut"
    cutRow({ databaseId: 800, createdAt: off(-90), updatedAt: off(-70), workflowName: 'CI' }),
  ];
  const v = rf.cutRunVerdict(rows, { tag: 'v1.2.1-rc.3', cutAt: CUT });
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.runs, [902]);
  assert.match(v.detail, /Release \(auto\) run 902 concluded cancelled/);
  assert.match(v.detail, /v1\.2\.1-rc\.3's artifacts may not exist/);
  assert.match(v.detail, /gh run rerun 902 --failed/);
  assert.doesNotMatch(v.detail, /901/);
});

test('#566 cutRunVerdict: a green cutter is ok; failed or still-running cutters are not', () => {
  const ok = rf.cutRunVerdict([cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(30) }), cutRow({ databaseId: 800, createdAt: off(-90), updatedAt: off(-70), workflowName: 'CI' })], { tag: 't', cutAt: CUT });
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.runs, [902]);
  assert.strictEqual(rf.cutRunVerdict([cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(30), conclusion: 'failure' })], { tag: 't', cutAt: CUT }).ok, false);
  const live = rf.cutRunVerdict([cutRow({ databaseId: 902, createdAt: off(-3), status: 'in_progress', conclusion: null })], { tag: 't', cutAt: CUT });
  assert.strictEqual(live.ok, false);
  assert.match(live.detail, /is still in_progress/);
  assert.match(live.detail, /Wait for it to finish/);
});

test('#566 cutRunVerdict: no run around the cut (cut by hand) is ok; an unread list or cut time is not', () => {
  const v = rf.cutRunVerdict([cutRow({ databaseId: 1, createdAt: off(-60), updatedAt: off(-50) }), cutRow({ databaseId: 2, createdAt: off(10), updatedAt: off(20), conclusion: 'cancelled' })], { tag: 't', cutAt: CUT });
  assert.strictEqual(v.ok, true);
  assert.match(v.detail, /cut by hand/);
  assert.strictEqual(rf.cutRunVerdict([], { tag: 't', cutAt: CUT }).ok, true);
  assert.strictEqual(rf.cutRunVerdict(null, { tag: 't', cutAt: CUT }).ok, false);
  assert.strictEqual(rf.cutRunVerdict([], { tag: 't', cutAt: null }).ok, false);
  // A completed row with no updatedAt cannot be placed around the cut — never a refusal on its own.
  assert.strictEqual(rf.cutRunVerdict([cutRow({ databaseId: 3, createdAt: off(-3), conclusion: 'cancelled' })], { tag: 't', cutAt: CUT }).ok, true);
});

test('#566 cutRunVerdict: the calling run is not its own cutter; a cancelled run with zero jobs never ran', () => {
  const rows = [cutRow({ databaseId: 902, createdAt: off(-3), status: 'in_progress', conclusion: null })];
  assert.strictEqual(rf.cutRunVerdict(rows, { tag: 't', cutAt: CUT, ownRunId: '902' }).ok, true);
  assert.strictEqual(rf.cutRunVerdict(rows, { tag: 't', cutAt: CUT, ownRunId: 903 }).ok, false);
  // A pending run cancelled out of the concurrency group overlapping the cut, beside the green cutter.
  const displaced = [cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(30) }), cutRow({ databaseId: 903, createdAt: off(-1), updatedAt: off(2), conclusion: 'cancelled' })];
  assert.strictEqual(rf.cutRunVerdict(displaced, { tag: 't', cutAt: CUT, jobCount: (id) => (id === 903 ? 0 : 3) }).ok, true);
  assert.strictEqual(rf.cutRunVerdict(displaced, { tag: 't', cutAt: CUT, jobCount: () => null }).ok, false, 'an unread job count keeps the row');
  assert.strictEqual(rf.cutRunVerdict(displaced, { tag: 't', cutAt: CUT }).ok, false);
});

test('#566 decide: a candidate whose cutting run was cancelled is refused on the human row; a green one stays candidate-ready', () => {
  const rows = [
    cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(20), conclusion: 'cancelled' }),
    cutRow({ databaseId: 901, createdAt: off(-60), updatedAt: off(-50) }),
  ];
  const bad = rf.decide(facts({ policy: HUMAN, cutRun: rf.cutRunVerdict(rows, { tag: 'v1.2.1-rc.1', cutAt: CUT }) }));
  assert.strictEqual(bad.state, 'refused');
  const c = bad.checks.find((x) => x.condition === 'cut-run');
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.required, true);
  assert.match(c.detail, /run 902 concluded cancelled/);
  const good = rf.decide(facts({ policy: HUMAN, cutRun: rf.cutRunVerdict([cutRow({ databaseId: 902, createdAt: off(-3), updatedAt: off(30) })], { tag: 'v1.2.1-rc.1', cutAt: CUT }) }));
  assert.strictEqual(good.state, 'candidate-ready');
  assert.strictEqual(rf.decide(facts({ cutRun: undefined })).state, 'refused', 'an unmeasured cut-run never passes');
});
