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

const { cureVerdict, redJobsProvenOnBranch, workflowCarveOut, shapeJobEvidence } = require('./ci-cure.js');

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

// --- condition 4's #321 carve-out: shapeJobEvidence (the pure red-job selection rule) -------
//
// These exercise the shaping the CALLER's raw `gh run view --json jobs` rows go through before any
// verdict sees them. It lives in the pure module precisely so this rule is testable without a live
// `gh` — see the module header.

function rawJob(name, over = {}) {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:10:00Z',
    steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success' }],
    ...over,
  };
}

test('shapeJobEvidence: selects only NOT-green trunk jobs as red — success/cancelled/skipped are not red', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [
      rawJob('browser', { conclusion: 'failure' }),
      rawJob('ci'),
      rawJob('lint', { conclusion: 'cancelled' }),
      rawJob('optional', { conclusion: 'skipped' }),
    ],
    branchRunJobs: [rawJob('browser'), rawJob('ci')],
  });
  assert.deepEqual(ev.redJobs.map((j) => j.name), ['browser']);
});

test('shapeJobEvidence: an unlisted new conclusion value is treated as RED (inverted allowlist, not a denylist)', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('browser', { conclusion: 'some_future_conclusion' })],
    branchRunJobs: [rawJob('browser')],
  });
  assert.deepEqual(ev.redJobs.map((j) => j.name), ['browser']);
});

test('shapeJobEvidence: ANY trunk job still in flight → null, a half-finished red run cannot be adjudicated', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('browser', { conclusion: 'failure' }), rawJob('ci', { status: 'in_progress', conclusion: null })],
    branchRunJobs: [rawJob('browser')],
  });
  assert.equal(ev, null);
});

test('shapeJobEvidence: non-array input on either side → null', () => {
  assert.equal(shapeJobEvidence({ redRunJobs: null, branchRunJobs: [] }), null);
  assert.equal(shapeJobEvidence({ redRunJobs: [], branchRunJobs: null }), null);
  assert.equal(shapeJobEvidence(), null);
});

test('shapeJobEvidence: durationMs is derived from the timestamps; unparseable/absent ones give null, never 0', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('a', { conclusion: 'failure', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:36Z' }),
      rawJob('b', { conclusion: 'failure', completedAt: null })],
    branchRunJobs: [rawJob('a')],
  });
  assert.equal(ev.redJobs[0].durationMs, 36000);
  assert.equal(ev.redJobs[1].durationMs, null);
});

test('shapeJobEvidence: ranSteps holds only steps that actually RAN — skipped and cancelled are excluded', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('browser', { conclusion: 'failure', steps: [
      { name: 'Set up job', status: 'completed', conclusion: 'success' },
      { name: 'Wait for MySQL', status: 'completed', conclusion: 'failure' },
      { name: 'Run tests', status: 'completed', conclusion: 'skipped' },
      { name: 'Upload', status: 'completed', conclusion: 'cancelled' },
    ] })],
    branchRunJobs: [rawJob('browser')],
  });
  assert.deepEqual(ev.redJobs[0].ranSteps, ['Set up job', 'Wait for MySQL']);
});

test('shapeJobEvidence: a job with no steps array shapes to ranSteps/steps null — unmeasurable, not empty', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('browser', { conclusion: 'failure', steps: null })],
    branchRunJobs: [rawJob('browser', { steps: null })],
  });
  assert.equal(ev.redJobs[0].ranSteps, null);
  assert.equal(ev.branchJobs[0].steps, null);
});

// --- condition 4's #321 carve-out: the verdict ---------------------------------------------
//
// The measured case from #321: a Tier A repo whose shared runner pool could not reach the job's
// MySQL service container. `browser` was SIGTERMed at "Wait for MySQL" after 36s on trunk; the
// repair pinned the jobs to a correctly-networked pool and `browser` came back green at 11m8s.

const RED_STEPS = ['Set up job', 'Start services', 'Wait for MySQL'];

function jobEvidence(over = {}) {
  return {
    redJobs: [{ name: 'browser', conclusion: 'failure', durationMs: 36000, ranSteps: RED_STEPS.slice() }],
    branchJobs: [{
      name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000,
      steps: RED_STEPS.map((n) => ({ name: n, conclusion: 'success' }))
        .concat([{ name: 'Run tests', conclusion: 'success' }]),
    }],
    ...over,
  };
}

function carving(over = {}) {
  return base({ workflowsTouched: true, jobEvidence: jobEvidence(over) });
}

test('cureVerdict: the measured #321 case — workflow touch, every red job green with every step it ran → ok, names the carve-out', () => {
  const v = cureVerdict(carving());
  assert.equal(v.ok, true);
  assert.match(v.reason, /#321 workflow carve-out/);
  assert.match(v.reason, /browser/);
  assert.match(v.reason, /36000ms/);
  assert.match(v.reason, /668000ms/);
  assert.deepEqual(v.carveOut, { jobs: [{ name: 'browser', redMs: 36000, branchMs: 668000 }] });
});

test('cureVerdict: workflow touch with NO job evidence at all (null) → refuses, keeps the plain condition-4 text', () => {
  const v = cureVerdict(base({ workflowsTouched: true, jobEvidence: null }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /\.github\/workflows/);
  assert.match(v.reason, /could not be measured/);
  assert.equal(v.carveOut, undefined);
});

test('cureVerdict: workflow touch with an EMPTY redJobs → refuses — a vacuous .every() must never read as a pass', () => {
  const v = cureVerdict(carving({ redJobs: [] }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /no red JOB could be named/);
});

test('cureVerdict: redJobs unmeasurable (null / not an array) → refuses', () => {
  assert.equal(cureVerdict(carving({ redJobs: null })).ok, false);
  assert.equal(cureVerdict(carving({ redJobs: 'browser' })).ok, false);
});

test('cureVerdict: branchJobs empty or null → refuses', () => {
  assert.match(cureVerdict(carving({ branchJobs: [] })).reason, /reported no jobs/);
  assert.equal(cureVerdict(carving({ branchJobs: null })).ok, false);
});

test('cureVerdict: 4a — the red job was DELETED or RENAMED away on the branch → refuses, says so', () => {
  const v = cureVerdict(carving({
    branchJobs: [{ name: 'browser-v2', status: 'completed', conclusion: 'success', durationMs: 668000, steps: [] }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not exist on the branch's run/);
  assert.match(v.reason, /deleted, renamed, or filtered away/);
});

test('cureVerdict: 4a — the red job exists on the branch but did not conclude success → refuses', () => {
  const v = cureVerdict(carving({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'failure', durationMs: 668000, steps: [] }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /concluded `failure` on the branch's run/);
});

test('cureVerdict: 4a — the red job has not COMPLETED on the branch → refuses (in flight is not passed)', () => {
  const v = cureVerdict(carving({
    branchJobs: [{ name: 'browser', status: 'in_progress', conclusion: null, durationMs: 668000, steps: [] }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /has not COMPLETED/);
});

test('cureVerdict: 4b — a step that RAN on trunk is now SKIPPED on the branch → refuses ("I made it exit early")', () => {
  const v = cureVerdict(carving({
    branchJobs: [{
      name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000,
      steps: RED_STEPS.map((n) => ({ name: n, conclusion: n === 'Wait for MySQL' ? 'skipped' : 'success' })),
    }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /Wait for MySQL/);
  assert.match(v.reason, /skipped away is not a step repaired/);
});

test('cureVerdict: 4b — a step that RAN on trunk is ABSENT from the branch job → refuses', () => {
  const v = cureVerdict(carving({
    branchJobs: [{
      name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000,
      steps: [{ name: 'Set up job', conclusion: 'success' }, { name: 'Start services', conclusion: 'success' }],
    }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /absent from the branch's run/);
});

test('cureVerdict: 4b — a job whose step list could not be read on either side → refuses, never assumes empty', () => {
  const noRed = cureVerdict(carving({
    redJobs: [{ name: 'browser', conclusion: 'failure', durationMs: 36000, ranSteps: null }],
  }));
  assert.equal(noRed.ok, false);
  assert.match(noRed.reason, /steps that ran in job `browser` on trunk could not be read/);

  const noBranch = cureVerdict(carving({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000, steps: null }],
  }));
  assert.equal(noBranch.ok, false);
  assert.match(noBranch.reason, /on the branch's run could not be read/);
});

test('cureVerdict: 4c — the branch job is FASTER than the failure it replaces → refuses, and names the timeout false-refusal', () => {
  const v = cureVerdict(carving({
    branchJobs: [{
      name: 'browser', status: 'completed', conclusion: 'success', durationMs: 2000,
      steps: RED_STEPS.map((n) => ({ name: n, conclusion: 'success' })),
    }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /too fast to have done the work/);
  assert.match(v.reason, /TIMEOUT/);
});

test('cureVerdict: 4c — equal durations are admitted; the floor is >=, not >', () => {
  const v = cureVerdict(carving({
    branchJobs: [{
      name: 'browser', status: 'completed', conclusion: 'success', durationMs: 36000,
      steps: RED_STEPS.map((n) => ({ name: n, conclusion: 'success' })),
    }],
  }));
  assert.equal(v.ok, true);
});

test('cureVerdict: 4c — an unusable duration (null, 0, negative) on either side → refuses, never satisfies the floor', () => {
  for (const bad of [null, 0, -1, undefined, '668000']) {
    const red = cureVerdict(carving({
      redJobs: [{ name: 'browser', conclusion: 'failure', durationMs: bad, ranSteps: RED_STEPS.slice() }],
    }));
    assert.equal(red.ok, false, `red durationMs ${String(bad)} must refuse`);
    assert.match(red.reason, /no usable wall-clock duration/);

    const branch = cureVerdict(carving({
      branchJobs: [{
        name: 'browser', status: 'completed', conclusion: 'success', durationMs: bad,
        steps: RED_STEPS.map((n) => ({ name: n, conclusion: 'success' })),
      }],
    }));
    assert.equal(branch.ok, false, `branch durationMs ${String(bad)} must refuse`);
  }
});

test('cureVerdict: EVERY red job must be proven, not merely the first', () => {
  const v = cureVerdict(carving({
    redJobs: [
      { name: 'browser', conclusion: 'failure', durationMs: 36000, ranSteps: RED_STEPS.slice() },
      { name: 'ci', conclusion: 'failure', durationMs: 5000, ranSteps: ['Set up job'] },
    ],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /job `ci`/);
});

test('cureVerdict: the carve-out is NEVER consulted when workflowsTouched is false — malformed evidence changes nothing', () => {
  const withGarbage = cureVerdict(base({ workflowsTouched: false, jobEvidence: { redJobs: 'nonsense' } }));
  const without = cureVerdict(base());
  assert.deepEqual(withGarbage, without);
  assert.equal(withGarbage.ok, true);
  assert.equal(withGarbage.carveOut, undefined);
});

test('cureVerdict: the carve-out never reorders the earlier conditions — containment still wins over a perfect carve-out', () => {
  const v = cureVerdict(carving({}));
  assert.equal(v.ok, true);
  const blocked = cureVerdict({ ...carving({}), containsRedSha: false });
  assert.match(blocked.reason, /does not contain/);
  const stacked = cureVerdict({ ...carving({}), stacking: badStacking('already cured once') });
  assert.equal(stacked.reason, 'already cured once');
});

// --- the exported predicates #297 is meant to reuse ------------------------------------------

test('redJobsProvenOnBranch: exported on its own, and answers 4a WITHOUT applying 4b/4c', () => {
  // A job whose steps were skipped away and which finished implausibly fast still passes 4a alone —
  // that is the point of the split: #297 wants this predicate for condition 2, where the step and
  // duration sub-tests are not what it is asking about.
  const ev = jobEvidence({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'success', durationMs: 1, steps: [] }],
  });
  assert.deepEqual(redJobsProvenOnBranch(ev), { ok: true, jobs: ['browser'], reason: '' });
  assert.equal(workflowCarveOut(ev).ok, false);
});

test('redJobsProvenOnBranch: null / non-object evidence → refuses, does not throw', () => {
  for (const bad of [null, undefined, 'x', 7]) {
    const r = redJobsProvenOnBranch(bad);
    assert.equal(r.ok, false);
    assert.deepEqual(r.jobs, []);
  }
});

test('workflowCarveOut: on success returns the per-job audit detail the trailer and JSON payload carry', () => {
  const r = workflowCarveOut(jobEvidence());
  assert.equal(r.ok, true);
  assert.deepEqual(r.jobs, [{ name: 'browser', redMs: 36000, branchMs: 668000 }]);
});
