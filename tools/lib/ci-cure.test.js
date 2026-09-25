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

const { cureVerdict, redJobsProvenOnBranch, workflowCarveOut, shapeJobEvidence, MANIFEST_SCRIPTS_REFUSAL } = require('./ci-cure.js');

const RED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function okStacking() { return { ok: true, reason: '' }; }
function badStacking(reason) { return { ok: false, reason }; }
function okEvidence(sha = HEAD_SHA) { return { ok: true, sha }; }
function badEvidence(sha = HEAD_SHA) { return { ok: false, sha }; }

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

// Every case starts from a genuine cure: containment, a green run, the job red on trunk passing on
// the branch (2b, #297), clean stacking, and a measured diff touching neither instrument path.
function base(overrides = {}) {
  return {
    containsRedSha: true,
    evidence: okEvidence(),
    redSha: RED_SHA,
    stacking: okStacking(),
    workflowsTouched: false,
    manifestScriptsTouched: false,
    manifestPaths: [],
    jobEvidence: jobEvidence(),
    ...overrides,
  };
}

// --- the happy path -----------------------------------------------------------------------

test('cureVerdict: every condition satisfied → ok, names the red sha and the evidence sha, and the proven red job(s)', () => {
  const v = cureVerdict(base());
  assert.equal(v.ok, true);
  assert.deepEqual(v.provenJobs, ['browser']);
  assert.equal(v.carveOut, undefined);
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
  // #353: the rebase remedy is for the patch only — a bystander must not read it as its own.
  assert.match(v.reason, /IS the patch/);
  assert.match(v.reason, /bystander .*waits for green/);
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
  // #353: the "open a PR" remedy is scoped to the branch carrying the fix, and says why.
  assert.match(v.reason, /ONLY for the branch carrying the fix/);
  assert.match(v.reason, /merge ref that includes the red trunk/);
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
  // 2b holds (the red job passed), but the branch's job ran none of the steps trunk's did, so the
  // #321 carve-out cannot admit it — the plain condition-4 refusal is what remains.
  const v = cureVerdict(base({ workflowsTouched: true, jobEvidence: jobEvidence({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000, steps: [] }],
  }) }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /\.github\/workflows/);
  assert.match(v.reason, /human ci-grant/);
});

// --- ordering is stable and exhaustive: exactly one reason per failing case ----------------

test('cureVerdict: every condition failing at once still returns exactly one reason (containment wins, cheapest check first)', () => {
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

test('cureVerdict: NO job evidence at all (null) → refuses at 2b, before the workflow block is ever reached (#297)', () => {
  for (const wf of [false, true]) {
    const v = cureVerdict(base({ workflowsTouched: wf, jobEvidence: null }));
    assert.equal(v.ok, false);
    assert.match(v.reason, /check trunk is red on is not proven here/);
    assert.match(v.reason, /could not be measured/);
    assert.match(v.reason, /#297/);
    assert.equal(v.carveOut, undefined);
  }
});

test('cureVerdict: workflow touch where 4a holds but the step list is unreadable → keeps the plain condition-4 text', () => {
  const v = cureVerdict(carving({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'success', durationMs: 668000, steps: null }],
  }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /\.github\/workflows/);
  assert.match(v.reason, /#321 carve-out does not admit it/);
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

test('cureVerdict: without a workflow touch only 2b applies — the carve-out\'s step (4b) and duration (4c) sub-tests are never consulted', () => {
  // Steps skipped away and an implausibly fast job: both would fail the carve-out. On the ordinary
  // path they change nothing, because only 4a is hoisted (as 2b) — see the module header for why.
  const v = cureVerdict(base({ jobEvidence: jobEvidence({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'success', durationMs: 1, steps: [] }],
  }) }));
  assert.equal(v.ok, true);
  assert.equal(v.carveOut, undefined);
  assert.equal(v.reason, cureVerdict(base()).reason);
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

// --- #297 condition 2b: the check trunk is red on must pass on the branch --------------------

test('2b: the red job is ABSENT from the branch runs (a paths: filter or matrix change) → refuses despite a green run', () => {
  const v = cureVerdict(base({ jobEvidence: jobEvidence({
    branchJobs: [{ name: 'lint', status: 'completed', conclusion: 'success', durationMs: 5000, steps: [] }],
  }) }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /check trunk is red on is not proven here/);
  assert.match(v.reason, /job `browser` .*does not exist on the branch's run/);
});

test('2b: the red job concluded failure on the branch while the run read green (continue-on-error shape) → refuses', () => {
  const v = cureVerdict(base({ jobEvidence: jobEvidence({
    branchJobs: [{ name: 'browser', status: 'completed', conclusion: 'failure', durationMs: 668000, steps: [] }],
  }) }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /concluded `failure`/);
});

test('2b: the red job is still in flight on the branch → refuses', () => {
  const v = cureVerdict(base({ jobEvidence: jobEvidence({
    branchJobs: [{ name: 'browser', status: 'in_progress', conclusion: null, durationMs: null, steps: [] }],
  }) }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /has not COMPLETED/);
});

test('2b: no red JOB can be named on trunk (e.g. a startup failure) → refuses on the ordinary path too', () => {
  const v = cureVerdict(base({ jobEvidence: jobEvidence({ redJobs: [] }) }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /no red JOB could be named/);
});

test('2b ordering: containment before 2b, 2a before 2b, 2b before anti-stacking', () => {
  assert.match(cureVerdict(base({ containsRedSha: false, jobEvidence: null })).reason, /does not contain/);
  assert.match(cureVerdict(base({ evidence: badEvidence(), jobEvidence: null })).reason, /no completed, successful CI run/);
  assert.match(cureVerdict(base({ jobEvidence: null, stacking: badStacking('stacked') })).reason, /not proven here/);
});

test('2b: jobs match per WORKFLOW — a passing `test` in another workflow never stands in for the red one', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('test', { conclusion: 'failure', workflowName: 'CI' })],
    branchRunJobs: [rawJob('test', { workflowName: 'Nightly' })],
  });
  const v = cureVerdict(base({ jobEvidence: ev }));
  assert.equal(v.ok, false);
  assert.match(v.reason, /job `CI \/ test` .*does not exist/);

  const ok = cureVerdict(base({ jobEvidence: shapeJobEvidence({
    redRunJobs: [rawJob('test', { conclusion: 'failure', workflowName: 'CI' })],
    branchRunJobs: [rawJob('test', { workflowName: 'Nightly', conclusion: 'failure' }), rawJob('test', { workflowName: 'CI' })],
  }) }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.provenJobs, ['test']);
});

test('2b: the same job twice at the branch head — cancelled + success passes, failure + success refuses', () => {
  const red = [rawJob('test', { conclusion: 'failure', workflowName: 'CI' })];
  const cancelledThenGreen = cureVerdict(base({ jobEvidence: shapeJobEvidence({
    redRunJobs: red,
    branchRunJobs: [rawJob('test', { workflowName: 'CI', conclusion: 'cancelled' }), rawJob('test', { workflowName: 'CI' })],
  }) }));
  assert.equal(cancelledThenGreen.ok, true);

  const failedAndGreen = cureVerdict(base({ jobEvidence: shapeJobEvidence({
    redRunJobs: red,
    branchRunJobs: [rawJob('test', { workflowName: 'CI' }), rawJob('test', { workflowName: 'CI', conclusion: 'failure' })],
  }) }));
  assert.equal(failedAndGreen.ok, false);
  assert.match(failedAndGreen.reason, /both passed and failed at one sha/);

  const greenAndPending = cureVerdict(base({ jobEvidence: shapeJobEvidence({
    redRunJobs: red,
    branchRunJobs: [rawJob('test', { workflowName: 'CI' }), rawJob('test', { workflowName: 'CI', status: 'in_progress', conclusion: null })],
  }) }));
  assert.equal(greenAndPending.ok, false);
  assert.match(greenAndPending.reason, /has not COMPLETED/);
});

test('shapeJobEvidence: carries workflowName on both sides, defaulting to empty (legacy rows still match)', () => {
  const ev = shapeJobEvidence({
    redRunJobs: [rawJob('a', { conclusion: 'failure', workflowName: 'CI' }), rawJob('b', { conclusion: 'failure' })],
    branchRunJobs: [rawJob('a', { workflowName: 'CI' }), rawJob('b')],
  });
  assert.deepEqual(ev.redJobs.map((j) => j.workflowName), ['CI', '']);
  assert.deepEqual(ev.branchJobs.map((j) => j.workflowName), ['CI', '']);
  assert.equal(redJobsProvenOnBranch(ev).ok, true);
});

// --- #297 condition 5: package.json scripts are part of the instrument ------------------------

test('condition 5: the diff changes a package.json scripts block → refuses, names the path and the ci-grant door', () => {
  const v = cureVerdict(base({ manifestScriptsTouched: true, manifestPaths: ['package.json', 'packages/a/package.json'] }));
  assert.equal(v.ok, false);
  assert.ok(v.reason.startsWith(MANIFEST_SCRIPTS_REFUSAL));
  assert.match(v.reason, /changed: package\.json, packages\/a\/package\.json/);
  assert.match(v.reason, /human ci-grant/);
  assert.match(v.reason, /no carve-out/);
});

test('condition 5 / 4: an unmeasured diff (null or undefined on either signal) → refuses, never reads as untouched', () => {
  for (const over of [{ manifestScriptsTouched: null }, { manifestScriptsTouched: undefined }, { workflowsTouched: null }, { workflowsTouched: undefined }]) {
    const v = cureVerdict(base(over));
    assert.equal(v.ok, false, JSON.stringify(over));
    assert.match(v.reason, /diff could not be measured/);
  }
});

test('two doors: workflows AND manifest scripts touched, carve-out-admissible evidence → refuses on condition 5, no carveOut', () => {
  const v = cureVerdict(carving({}));
  assert.equal(v.ok, true, 'precondition: this evidence IS carve-out-admissible on its own');
  const both = cureVerdict({ ...carving({}), manifestScriptsTouched: true, manifestPaths: ['package.json'] });
  assert.equal(both.ok, false);
  assert.ok(both.reason.startsWith(MANIFEST_SCRIPTS_REFUSAL));
  assert.equal(both.carveOut, undefined);
});

test('the carve-out cure also carries provenJobs', () => {
  assert.deepEqual(cureVerdict(carving({})).provenJobs, ['browser']);
});
