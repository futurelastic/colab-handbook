'use strict';
/**
 * Tests for tools/lib/ci-verdict.js — the shared "is this non-completed run merely slow, or
 * structurally WEDGED" verdict (#155). Pure, so no git/gh fixture is needed: the run shape is
 * handed in directly, exactly as `classifyCiRun` (tools/colab) constructs it after a real
 * `ghRunForSha`/`ghRunJobs` read.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const v = require('./ci-verdict.js');

test('a completed run is never wedged, whatever its conclusion — that state is handled elsewhere', () => {
  const r = v.wedgedVerdict({ status: 'completed', conclusion: 'failure', jobCount: 0, createdAt: '2020-01-01T00:00:00Z' });
  assert.strictEqual(r.wedged, false);
  assert.strictEqual(r.reason, null);
});

test('status "none" (no run at all) is never wedged — a different, already-HUMAN_GATED case', () => {
  const r = v.wedgedVerdict({ status: 'none', conclusion: null, jobCount: null, createdAt: null });
  assert.strictEqual(r.wedged, false);
});

test('an ORDINARY still-running run (non-empty jobs, fresh) is not wedged — SELF_CLEARING stays SELF_CLEARING', () => {
  const r = v.wedgedVerdict({
    status: 'queued', conclusion: null, jobCount: 2,
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(), // 5 minutes old
  });
  assert.strictEqual(r.wedged, false);
});

test('#155 exactly: queued, ZERO jobs, unmoving for hours — wedged on the PRIMARY signal alone', () => {
  const r = v.wedgedVerdict({
    status: 'queued', conclusion: null, jobCount: 0,
    createdAt: new Date(Date.now() - 30 * 60000).toISOString(), // only 30 min old — age alone would not trigger
  });
  assert.strictEqual(r.wedged, true);
  assert.match(r.reason, /zero jobs/);
});

test('#171: zero jobs does NOT wedge on a run created moments ago — inside the age floor, jobs may simply not have materialized yet', () => {
  const r = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 0, createdAt: new Date().toISOString() });
  assert.strictEqual(r.wedged, false);
  assert.strictEqual(r.reason, null);
});

test('#171: zero jobs wedges once past the age floor', () => {
  const past = new Date(Date.now() - (v.ZERO_JOBS_AGE_FLOOR_MINUTES + 1) * 60000).toISOString();
  const r = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 0, createdAt: past });
  assert.strictEqual(r.wedged, true);
  assert.match(r.reason, /zero jobs/);
});

test('#171: zero jobs with no createdAt (age unknown) does not wedge — a missing signal never manufactures a positive', () => {
  const r1 = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 0, createdAt: null });
  assert.strictEqual(r1.wedged, false);
  const r2 = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 0, createdAt: 'not-a-date' });
  assert.strictEqual(r2.wedged, false);
});

test('the age backstop (signal A) catches a run whose jobs are non-empty but frozen — jobCount cannot see this', () => {
  const old = new Date(Date.now() - (v.WEDGE_AGE_HOURS + 1) * 3600000).toISOString();
  const r = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 3, createdAt: old });
  assert.strictEqual(r.wedged, true);
  assert.match(r.reason, /backstop/);
});

test('just under the age backstop, with non-empty jobs, is NOT wedged — the threshold is a floor, not a suggestion', () => {
  const almost = new Date(Date.now() - (v.WEDGE_AGE_HOURS - 0.1) * 3600000).toISOString();
  const r = v.wedgedVerdict({ status: 'in_progress', conclusion: null, jobCount: 1, createdAt: almost });
  assert.strictEqual(r.wedged, false);
});

test('jobCount null (not measured) falls back to the age backstop alone — never misread as zero', () => {
  const fresh = v.wedgedVerdict({ status: 'queued', conclusion: null, jobCount: null, createdAt: new Date().toISOString() });
  assert.strictEqual(fresh.wedged, false);

  const old = new Date(Date.now() - (v.WEDGE_AGE_HOURS + 1) * 3600000).toISOString();
  const stale = v.wedgedVerdict({ status: 'queued', conclusion: null, jobCount: null, createdAt: old });
  assert.strictEqual(stale.wedged, true);
});

test('createdAt null/unparseable with jobCount non-zero — cannot age-check, so not wedged (no false positive from a missing signal)', () => {
  const r1 = v.wedgedVerdict({ status: 'queued', conclusion: null, jobCount: 2, createdAt: null });
  assert.strictEqual(r1.wedged, false);
  const r2 = v.wedgedVerdict({ status: 'queued', conclusion: null, jobCount: 2, createdAt: 'not-a-date' });
  assert.strictEqual(r2.wedged, false);
});

test('nowMs is injectable for deterministic tests, independent of Date.now()', () => {
  const created = '2026-01-01T00:00:00Z';
  const justUnder = Date.parse(created) + (v.WEDGE_AGE_HOURS - 0.5) * 3600000;
  const justOver = Date.parse(created) + (v.WEDGE_AGE_HOURS + 0.5) * 3600000;
  assert.strictEqual(v.wedgedVerdict({ status: 'queued', jobCount: 1, createdAt: created }, { nowMs: justUnder }).wedged, false);
  assert.strictEqual(v.wedgedVerdict({ status: 'queued', jobCount: 1, createdAt: created }, { nowMs: justOver }).wedged, true);
});

test('a null run is not wedged — degrade, never throw', () => {
  assert.deepStrictEqual(v.wedgedVerdict(null), { wedged: false, reason: null, shape: null });
});

// --- #650: every job completed, the forge never concluded the run -------------------------------

// The measured shape, in ghRunJobs's own field names: the gate succeeded, two suites were skipped by
// it — their check runs written ~6 minutes late, so started_at is LATER than completed_at — and the
// duration job succeeded. The run itself stays in_progress.
const T0 = Date.parse('2026-10-20T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const STUCK_JOBS = [
  { name: 'gate', status: 'completed', conclusion: 'success', startedAt: at(0), completedAt: at(1) },
  { name: 'suite (a)', status: 'completed', conclusion: 'skipped', startedAt: at(7), completedAt: at(6.5) },
  { name: 'suite (b)', status: 'completed', conclusion: 'skipped', startedAt: at(7), completedAt: at(6.5) },
  { name: 'duration', status: 'completed', conclusion: 'success', startedAt: at(1), completedAt: at(2) },
];
const stuckRun = (jobs = STUCK_JOBS) => ({ status: 'in_progress', conclusion: null, createdAt: at(-1), jobCount: jobs.length, jobs });

test('#650 the measured shape — every job completed, run in_progress — past the floor reads WEDGED, shape unconcluded', () => {
  const r = v.wedgedVerdict(stuckRun(), { nowMs: T0 + 40 * 60000 });
  assert.strictEqual(r.wedged, true);
  assert.strictEqual(r.shape, 'unconcluded');
  assert.deepStrictEqual(r.failed, []);
  assert.match(r.reason, /every job completed \(2 skipped, 2 success\)/);
  assert.match(r.reason, /forge never concluded/);
  // 40m after start, 33m after the newest timestamp (the skipped jobs' late started_at, not completed_at)
  assert.match(r.reason, / 33m ago/);
});

test('#650 inside the floor it is still an ordinary run finishing up — not wedged', () => {
  const nowMs = Date.parse(at(7)) + (v.UNCONCLUDED_FLOOR_MINUTES - 1) * 60000;
  assert.deepStrictEqual(v.wedgedVerdict(stuckRun(), { nowMs }), { wedged: false, reason: null, shape: null });
});

test('#650 checked before the age backstop — an hours-old stuck run names the forge, not "status=in_progress for Nh"', () => {
  const r = v.wedgedVerdict(stuckRun(), { nowMs: T0 + 8 * 3600000 });
  assert.strictEqual(r.shape, 'unconcluded');
});

test('#650 one job still running is #155\'s frozen-job shape, not this one — only the age backstop can fire', () => {
  const jobs = STUCK_JOBS.map((j, i) => (i === 3 ? { ...j, status: 'in_progress', conclusion: null, completedAt: null } : j));
  assert.strictEqual(v.wedgedVerdict(stuckRun(jobs), { nowMs: T0 + 40 * 60000 }).wedged, false);
  assert.strictEqual(v.wedgedVerdict(stuckRun(jobs), { nowMs: T0 + 7 * 3600000 }).shape, 'age');
});

test('#650 a missing signal never manufactures the shape: jobs unread, or a job with no timestamp', () => {
  const late = { nowMs: T0 + 40 * 60000 };
  assert.strictEqual(v.wedgedVerdict({ ...stuckRun(), jobs: null }, late).wedged, false);
  assert.strictEqual(v.wedgedVerdict({ ...stuckRun(), jobs: undefined }, late).wedged, false);
  const blind = STUCK_JOBS.map((j, i) => (i === 0 ? { ...j, startedAt: null, completedAt: 'not-a-date' } : j));
  assert.strictEqual(v.wedgedVerdict(stuckRun(blind), late).wedged, false);
});

test('#650 zero jobs stays #155\'s zero-jobs shape', () => {
  const r = v.wedgedVerdict({ status: 'queued', createdAt: at(0), jobCount: 0, jobs: [] }, { nowMs: T0 + 40 * 60000 });
  assert.strictEqual(r.shape, 'zero-jobs');
});

test('#650 a job that concluded red is named — the run is red in substance', () => {
  const jobs = STUCK_JOBS.map((j, i) => (i === 0 ? { ...j, conclusion: 'failure' } : j));
  const r = v.wedgedVerdict(stuckRun(jobs), { nowMs: T0 + 40 * 60000 });
  assert.strictEqual(r.shape, 'unconcluded');
  assert.deepStrictEqual(r.failed, ['gate (failure)']);
  assert.match(v.wedgeExit(r), /red in substance — gate \(failure\)/);
});

test('#650 wedgeExit: the forge-stuck shape names what works and what the forge refuses; #155\'s shapes keep their words', () => {
  const e = v.wedgeExit(v.wedgedVerdict(stuckRun(), { nowMs: T0 + 40 * 60000 }));
  assert.match(e, /colab trunk-ci --fresh/);
  assert.match(e, /colab ci-grant <issue> --branch <branch>/);
  assert.match(e, /409 "not in progress"/);
  assert.match(e, /403 "already running"/);
  assert.match(e, /workflow_dispatch at this sha/);
  assert.doesNotMatch(e, /a human must look, not retry/);
  assert.strictEqual(v.wedgeExit({ wedged: true, shape: 'zero-jobs' }), 'a human must look, not retry');
  assert.strictEqual(v.wedgeExit({ wedged: true, shape: 'age' }), 'a human must look, not retry');
});

// --- #413: emptyReadVerdict — the grace window for "no run yet" -------------------------------

test('#413 emptyReadVerdict: a sha committed minutes ago is fresh (a run may not exist yet)', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const r = v.emptyReadVerdict(now - 3 * 60000, { nowMs: now });
  assert.strictEqual(r.fresh, true);
  assert.strictEqual(Math.round(r.minutes), 3);
});

test('#413 emptyReadVerdict: past the grace window an empty read is not fresh', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  assert.strictEqual(v.emptyReadVerdict(now - (v.EMPTY_READ_GRACE_MINUTES + 1) * 60000, { nowMs: now }).fresh, false);
});

test('#413 emptyReadVerdict: unknown age never manufactures a grace', () => {
  assert.deepStrictEqual(v.emptyReadVerdict(null), { fresh: false, minutes: null });
  assert.deepStrictEqual(v.emptyReadVerdict(NaN), { fresh: false, minutes: null });
});
