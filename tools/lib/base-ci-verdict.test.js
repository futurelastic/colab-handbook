'use strict';
/**
 * Tests for tools/lib/base-ci-verdict.js — the "was the sha this branch was cut from actually
 * green" classifier (#293). Pure, so no git/gh fixture is needed: verdict shapes are handed in
 * directly, exactly as tools/colab constructs them after a real `ghRunForCommit`/`ghRunForSha` read.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const { classify, isGreen, isMeasuredRed } = require('./base-ci-verdict.js');

// --- the null case: nothing to flag unless the base is MEASURABLY red -----------------------

test('base green, own green — nothing to flag', () => {
  const r = classify({ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'success' });
  assert.strictEqual(r.severity, null);
});

test('base has no run at all (status: none) — never asserts red on an absent measurement', () => {
  const r = classify({ status: 'none', conclusion: null }, { status: 'completed', conclusion: 'success' });
  assert.strictEqual(r.severity, null);
});

test('base still running — not yet measurably red, stays silent rather than guessing', () => {
  const r = classify({ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'success' });
  assert.strictEqual(r.severity, null);
});

test('base cancelled — cancelled is neutral, same allowlist the green checks use elsewhere', () => {
  const r = classify({ status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: 'success' });
  assert.strictEqual(r.severity, null);
});

test('base verdict object itself is null/undefined — degrades to "nothing to flag", never throws', () => {
  assert.strictEqual(classify(null, { status: 'completed', conclusion: 'success' }).severity, null);
  assert.strictEqual(classify(undefined, { status: 'completed', conclusion: 'success' }).severity, null);
});

// --- the loud case: base red, own green -------------------------------------------------------

test('#293 the dangerous shape: base red, branch own head green — suspect-green', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'success' });
  assert.strictEqual(r.severity, 'suspect-green');
  assert.match(r.why, /may be inherited/);
});

test('suspect-green fires for any non-success/non-cancelled base conclusion, not just "failure"', () => {
  for (const conclusion of ['timed_out', 'action_required', 'cancelled_manually', 'startup_failure']) {
    const r = classify({ status: 'completed', conclusion }, { status: 'completed', conclusion: 'success' });
    assert.strictEqual(r.severity, 'suspect-green', `expected suspect-green for base conclusion=${conclusion}`);
  }
});

// --- both red -----------------------------------------------------------------------------------

test('base red, own also red — inherited-red, not suspect-green', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'failure' });
  assert.strictEqual(r.severity, 'inherited-red');
  assert.match(r.why, /pre-existing/);
});

test('base red, own red with a DIFFERENT conclusion value — still inherited-red (both measurably red)', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'timed_out' });
  assert.strictEqual(r.severity, 'inherited-red');
});

// --- base red, own CI absent/pending -------------------------------------------------------------

test('base red, own head has no run at all — unresolved', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, { status: 'none', conclusion: null });
  assert.strictEqual(r.severity, 'unresolved');
});

test('base red, own head still running — unresolved, not suspect-green and not inherited-red', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, { status: 'in_progress', conclusion: null });
  assert.strictEqual(r.severity, 'unresolved');
});

test('base red, own verdict object missing entirely — unresolved, never throws', () => {
  const r = classify({ status: 'completed', conclusion: 'failure' }, null);
  assert.strictEqual(r.severity, 'unresolved');
});

// --- the two exported predicates, directly ---------------------------------------------------

test('isGreen requires BOTH completed status and success conclusion', () => {
  assert.strictEqual(isGreen('completed', 'success'), true);
  assert.strictEqual(isGreen('completed', 'cancelled'), false);
  assert.strictEqual(isGreen('in_progress', 'success'), false);
});

test('isMeasuredRed excludes cancelled and non-completed statuses', () => {
  assert.strictEqual(isMeasuredRed('completed', 'failure'), true);
  assert.strictEqual(isMeasuredRed('completed', 'cancelled'), false);
  assert.strictEqual(isMeasuredRed('completed', 'success'), false);
  assert.strictEqual(isMeasuredRed('none', null), false);
  assert.strictEqual(isMeasuredRed('in_progress', null), false);
});
