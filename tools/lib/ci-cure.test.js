'use strict';
/**
 * Tests for the cure rule (tools/lib/ci-cure.js, #281).
 *
 * Pure cases only — no git, no gh, no network. The subprocess/CLI half (wiring into `colab
 * ship`'s trunk-CI-green precondition, the additive `ciCure` JSON field, and proof that the
 * ordinary ci-grant path is undisturbed) lives in tools/lib/ship-ci-cure.test.js, same split
 * ci-grant.js/ship-ci-grant.test.js already use.
 */

const test = require('node:test');
const assert = require('node:assert');

const { cureVerdict } = require('./ci-cure.js');

const RED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function okStacking() { return { ok: true, reason: '' }; }
function badStacking(reason) { return { ok: false, reason }; }
function okEvidence(sha = HEAD_SHA) { return { ok: true, sha }; }
function badEvidence(sha = HEAD_SHA) { return { ok: false, sha }; }

function base(overrides = {}) {
  return {
    containsRedSha: true,
    evidence: okEvidence(),
    redSha: RED_SHA,
    stacking: okStacking(),
    workflowsTouched: false,
    ...overrides,
  };
}

// --- the happy path -----------------------------------------------------------------------

test('cureVerdict: all four conditions satisfied → ok, names the red sha and the evidence sha', () => {
  const v = cureVerdict(base());
  assert.equal(v.ok, true);
  assert.match(v.reason, new RegExp(RED_SHA));
  assert.match(v.reason, new RegExp(HEAD_SHA));
});

// --- condition 1: containment ------------------------------------------------------------

test('cureVerdict: branch does not contain the red sha → refuses, names the red sha and the rebase remedy', () => {
  const v = cureVerdict(base({ containsRedSha: false }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not contain/);
  assert.match(v.reason, new RegExp(RED_SHA));
  assert.match(v.reason, /rebas/);
});

test('cureVerdict: containment is checked BEFORE evidence — a branch missing both fails on containment, not evidence', () => {
  const v = cureVerdict(base({ containsRedSha: false, evidence: null }));
  assert.match(v.reason, /does not contain/);
});

// --- condition 2: evidence -----------------------------------------------------------------

test('cureVerdict: evidence read failed (null) → refuses, distinct reason from "no successful run"', () => {
  const v = cureVerdict(base({ evidence: null }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not be measured/);
});

test('cureVerdict: evidence present but not ok (no successful run at current head) → refuses', () => {
  const v = cureVerdict(base({ evidence: badEvidence() }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /no completed, successful CI run/);
});

test('cureVerdict: evidence checked before stacking/workflows — a branch failing all three still reports the evidence reason', () => {
  const v = cureVerdict(base({ evidence: null, stacking: badStacking('stacked'), workflowsTouched: true }));
  assert.match(v.reason, /could not be measured/);
});

// --- condition 3: anti-stacking (reused verbatim from ci-grant.js's stackingVerdict) -------

test('cureVerdict: stacking verdict not ok → refuses with the STACKING reason verbatim, not a generic one', () => {
  const v = cureVerdict(base({ stacking: badStacking('a CI grant already merged X against this red trunk and trunk has been red ever since') }));
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'a CI grant already merged X against this red trunk and trunk has been red ever since');
});

test('cureVerdict: missing stacking argument entirely (undefined) → refuses, does not throw', () => {
  const v = cureVerdict(base({ stacking: undefined }));
  assert.equal(v.ok, false);
});

// --- condition 4: no workflow-file changes --------------------------------------------------

test('cureVerdict: branch touches .github/workflows/** → refuses even with containment+evidence+stacking all clean', () => {
  const v = cureVerdict(base({ workflowsTouched: true }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /\.github\/workflows/);
  assert.match(v.reason, /human ci-grant/);
});

// --- ordering is stable and exhaustive: exactly one reason per failing case ----------------

test('cureVerdict: all four conditions failing at once still returns exactly one reason (containment wins, cheapest check first)', () => {
  const v = cureVerdict({
    containsRedSha: false, evidence: null, redSha: RED_SHA,
    stacking: badStacking('stacked'), workflowsTouched: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not contain/);
});
