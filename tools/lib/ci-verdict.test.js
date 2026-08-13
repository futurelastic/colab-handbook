'use strict';
/**
 * Tests for tools/lib/ci-verdict.js — the shared "is this non-completed run merely slow, or
 * structurally WEDGED" verdict (#155). Pure, so no git/gh fixture is needed: the run shape is
 * handed in directly, exactly as `classifyCiRun` (tools/colab) constructs it after a real
 * `ghRunForSha`/`ghRunJobCount` read.
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
  assert.deepStrictEqual(v.wedgedVerdict(null), { wedged: false, reason: null });
});
