'use strict';
/**
 * The cure rule (#281) — a machine-checkable arm added to `colab ship`'s trunk-CI-green
 * precondition, alongside the human-only ci-grant (tools/lib/ci-grant.js, #105), which
 * survives UNCHANGED for everything this rule does not cover.
 *
 * WHY THIS NEEDS NO HUMAN ATTESTATION, where a ci-grant does. A ci-grant's whole job is to
 * let a human certify a fact the gate cannot measure on its own: "this branch is the cure for
 * this specific red." The cure rule instead measures that fact directly, from two git+CI
 * signals stronger than what a grant checks today:
 *
 *   1. CONTAINMENT — the branch contains trunk's current red head sha (a real ancestor, not
 *      merely "no conflicts"). A ci-grant's evidence guard checks the branch's own head is
 *      green, but never containment — a branch cut from an OLDER, green base can carry a
 *      green run that proves nothing about the redness it is being exempted from.
 *   2. EVIDENCE — the branch's own CI is green AT ITS OWN CURRENT HEAD, measured (never
 *      asserted), same "ask by sha" discipline ci-grant.js already uses (2a) — AND, since #297,
 *      every job that is RED on trunk at the red sha exists in the branch's runs at that head,
 *      completed and concluded `success` (2b, `redJobsProvenOnBranch`). A green run alone never
 *      proved the check trunk is failing ran here: a `paths:` filter, a matrix change or a
 *      renamed job leaves the run green while the named check never ran.
 *
 * Containment + evidence TOGETHER mean the branch's tree passed the full suite INCLUDING the
 * tests trunk is currently failing — merging it provably turns trunk green. That is the one
 * thing the human click on a ci-grant is supposed to certify, mechanically checkable instead.
 *
 * THREE CONDITIONS THIS RULE ADDS ON TOP, deliberately narrowing it rather than trusting
 * containment+evidence alone:
 *
 *   3. ANTI-STACKING — the identical guard ci-grant.js's stackingVerdict already computes,
 *      reused VERBATIM (not re-derived): a repo that auto-cures once and stays red anyway must
 *      not auto-cure again on the same continuous red — that is how a permanently broken repo
 *      ships anyway, exactly the failure trunk-CI-green exists to prevent. The caller widens the
 *      trailer scan that feeds this (tools/colab's computeAntiStacking) to recognise BOTH a
 *      prior `CI-Grant:` trailer and a prior `CI-Cure:` trailer as "an exemption already merged
 *      against this red" — a cure and a grant are both exemptions for this guard's purposes.
 *      ONE NARROW ADMISSION (#477): PROGRESS. When the guard refuses because a prior exemption
 *      already merged on this continuous red, a further cure is still admitted iff trunk's red-job
 *      set at the current red sha is a STRICT subset of the red-job set at the red sha the prior
 *      exemption was measured against (`redSetShrank`, below). A fix that repaired one of two red
 *      jobs, or two independent failures healed by two successive fixes, then needs no human step;
 *      a cure that left the set unchanged — or grew it — still stops the chain, which is the loop
 *      condition 3 exists to break. Every other condition still applies to the remaining set.
 *   4. NO WORKFLOW-FILE CHANGES — the branch diff must not touch `.github/workflows/**`. A
 *      branch that edits the CI configuration doing the grading is not allowed to grade itself;
 *      that door stays behind a human ci-grant (condition 4 in the original proposal, #281).
 *      ONE GUARDED CARVE-OUT (#321), below, is the single way through it. The diff is read with
 *      `--no-renames` (tools/lib/cure-diff.js, #297), so moving a workflow file away counts.
 *   5. NO MANIFEST-SCRIPTS CHANGES (#297) — the branch diff must not change the `scripts` block of
 *      any `package.json`. The Node CI template decides from that block whether typecheck, lint
 *      and test run at all, and a skipped step leaves the job `success` — so deleting
 *      `scripts.test` weakens the instrument without touching a workflow file. No carve-out: see
 *      below for why the #321 door cannot adjudicate it.
 *      ONE NARROW ADMISSION (#475): an ADD-ONLY scripts change — keys added, none removed or changed,
 *      no lifecycle hook — makes the template run MORE, so it passes condition 5 on step evidence
 *      (`manifestStepProof`, below) instead of refusing.
 *   6. NO PYTHON DEPENDENCY-MANIFEST CHANGES (#377) — the branch diff must not change a file the
 *      Python CI template installs from (`pyproject.toml`/`setup.py`/`setup.cfg`, `requirements*`
 *      files and what they include — tools/lib/cure-diff.js names the set). That template runs
 *      ruff/mypy/pytest only when the tool is importable after install, so removing `pytest` from
 *      `requirements-dev.txt` skips the Test step and leaves the job `success`. Same shape as 5, a
 *      sibling door with no carve-out, for the same reason. ONE NARROW ADMISSION (#476): a PIN-ONLY
 *      change — only the version specifier of requirements present on both sides — passes on step
 *      evidence plus the no-late-skip test (`manifestStepProof`, below).
 *
 * THE STEP PROOF BEHIND BOTH ADMISSIONS (#475, #476). Every step that RAN in each red job on trunk —
 * the failing one included — ran on the branch and concluded `success`: the 4b read, applied here
 * without the carve-out's duration floor (no workflow changed, so no `run:` body can have been
 * gutted). Check-runs name steps, not commands, so "the step that runs the added script" is not
 * measurable as such; "the step trunk failed in now passes" is, and it is the claim a cure makes.
 * The pin admission adds one test (#476's open question, answered): a pin can drop a TRANSITIVELY
 * installed tool, and the Python template then skips that tool's step with the job still `success`.
 * Steps before trunk's failure point are covered by the superset; steps AFTER it were skipped on
 * trunk and so say nothing. So no step after the last one that ran on trunk may be `skipped` on the
 * branch. That refuses a repo that never had, say, mypy when its red came before the Typecheck step
 * — a false refusal, falling through to the ci-grant, the safe direction.
 *
 * THE WORKFLOW CARVE-OUT (#321) — why condition 4 could not simply stay absolute. The repair for
 * a CI-INFRASTRUCTURE outage is, by construction, a workflow change: when trunk goes red because
 * the runner pool cannot reach a service container, the branch that fixes it necessarily edits
 * `.github/workflows/**`, and was therefore permanently cure-ineligible however green it was. The
 * only exit was a human ci-grant — and a human reading a one-line grant prompt is measurably
 * BADLY placed to judge this particular case: a genuine repair and a "CI fix" that pins every job
 * to a runner missing a shared library read identically in prose, and granting the wrong one
 * converts a stalled trunk into a permanently red one. The CI evidence tells them apart; the
 * prompt does not.
 *
 * So condition 4 stays a refusal BY DEFAULT and gains exactly one guarded door, admissible only
 * on evidence this gate can actually measure (`workflowCarveOut`, below). On top of conditions
 * 1-3, ALL of:
 *
 *   4a. JOB-NAME SUPERSET — every job that is RED on trunk's run at the red sha exists on the
 *       branch's own green run, completed, concluded `success`. "I made the red job disappear"
 *       (deleted, renamed, filtered away) fails here.
 *   4b. EXECUTED-STEP SUPERSET — for each of those jobs, every step that actually RAN on trunk
 *       (reached a terminal, non-skipped conclusion) is present on the branch's job and concluded
 *       `success`. Steps AFTER the failing one are `skipped` on trunk and so constrain nothing —
 *       only steps that demonstrably ran do. "I made it exit early" fails here. This sub-test is
 *       the structural, primary one: it embeds no constant, is self-calibrating, and is symmetric
 *       with 4a one level down.
 *   4c. DURATION FLOOR — each of those jobs cost at least the wall time its failure did on trunk
 *       (`branchMs >= redMs`, both measurable and > 0). 4b proves the STEPS ran; it cannot see a
 *       step's `run:` body gutted to a no-op inside the very workflow file this door is carving
 *       an exception for, and duration is the only signal that touches that. The comparison is
 *       against a measurement taken in the SAME repo, on the SAME job, on the same runner class,
 *       minutes apart — so there is no repo-specific constant to tune and no floor to defend.
 *
 * WHY `conclusion === 'success'` ALONE IS NOT ENOUGH, even though it carries real weight: GitHub
 * reports a job whose steps were ALL skipped as `conclusion: success`. Run-level and job-level
 * success are both blind to the skip; step-level is not. That is why 4b exists rather than
 * trusting the conclusion, and it is the same shape #297's `package.json`-scripts scenario
 * produces.
 *
 * WHY `package.json`'s `scripts` BLOCK IS A SIBLING CONDITION (5), NOT A WIDENED
 * `workflowsTouched` (the seam #321 left, filled by #297 in exactly this shape). It is tempting to fold every path that
 * forms "the instrument" into one boolean and let this carve-out serve them all. It must not be:
 * the carve-out's evidence CANNOT adjudicate a `package.json`-scripts weakening in the general
 * case — that change happens inside a step whose name and conclusion are unchanged and whose
 * duration delta may sit below any signal, so 4b and 4c would both silently pass a change they
 * are structurally unable to see. Two instrument paths, two different doors. What this module
 * names once is the carve-out PREDICATE (`workflowCarveOut`, `redJobsProvenOnBranch`), never the
 * path list. Condition 5 is checked BEFORE the workflow block (see `cureVerdict`), because that
 * block returns success when the carve-out admits — a branch touching both must still meet door 5.
 *
 * WHY ONLY 4a IS HOISTED (as 2b), NOT 4b/4c (#297). The executed-step superset refuses genuine
 * cures often on the ordinary path — a cache-conditional step that ran on trunk is skipped on a
 * cache hit, and a push-only step that ran on trunk is skipped on the `pull_request` run a branch
 * frequently offers as evidence. It would catch the scripts case, but condition 5 already does,
 * without those false refusals. 4b/4c stay the carve-out's, where the workflow itself changed.
 *
 * HONEST LIMIT, stated rather than glossed (same posture as the #281 proposal): test-file
 * self-weakening is not detectable at this gate. A branch can go green by gutting the failing
 * tests. Check-runs name jobs, not files, so this module cannot see it; condition 4 closes only
 * the adjacent, checkable door (weakening the CI config itself). Content weakening is caught
 * where it is caught today — review/grade time, downstream of ship.
 *
 * HONEST LIMIT OF THE CARVE-OUT (#321), in the same register: it proves the red jobs still
 * exist, still ran the steps they ran on trunk, and still cost at least the wall time the failure
 * did. It cannot see what those steps ASSERTED. A workflow edit that preserves every step name
 * and every second of wall time while weakening what the commands actually check passes this
 * door — the same content-blindness the rule already confesses at test-file level, moved one
 * layer down into the workflow itself. What the carve-out closes is the STRUCTURAL form:
 * deleting, renaming, `if:`-ing away, or fast-exiting the job trunk is red on.
 *
 * KNOWN, ACCEPTED FALSE REFUSAL (4c): a trunk job that failed by TIMEOUT or hang ran longer than
 * any healthy green run, so the duration floor refuses the genuine repair. The direction of that
 * error is the safe one — it falls through to the ordinary ci-grant, exactly as before this
 * carve-out existed — and the refusal reason says so in as many words. Relaxing 4c when the red
 * job concluded `timed_out`/`cancelled` is a DELIBERATELY UNMADE decision: it is one `if`, and it
 * is the obvious first follow-up the moment that refusal is observed in the field, but adding it
 * unmeasured is precisely the speculative loosening condition 4 exists to resist.
 *
 * DRY-RUN EVIDENCE FOR A MAIN-ONLY WORKFLOW (#474). Some checks never run on a branch at all:
 * `release-auto.yml` fires on `workflow_run` after trunk CI, or on a schedule. 2b then refuses every
 * fix for a red in it (the job is absent on the branch), and a human ci-grant was the only door,
 * even for a mechanical defect. The workflow template therefore offers a DRY RUN: dispatched on the
 * fix branch, it runs the same job and the same steps, but with every external write turned off. Steps
 * that would publish are skipped, and their names end in `PUBLISH_STEP_MARKER`. A sentinel step named
 * `DRY_RUN_STEP` runs only in that mode, and is how a job instance is recognised as a dry run here.
 * Such an instance counts as the job's evidence for 2b (and hence 4a) only when, on top of 2b:
 *
 *   D1. both step lists are measurable — trunk's ran-steps and the dry run's steps;
 *   D2. every step that RAN on trunk, the failing one included, concluded `success` in the dry run.
 *       This is the not-a-back-door proof: a red INSIDE a publishing step can never be cured this way,
 *       because the dry run skips exactly that step. It is 4b, applied to dry-run instances on every
 *       path, not only the carve-out's;
 *   D3. every step the dry run did NOT run to success is a skipped publishing step. A dry run that
 *       also skipped some ordinary step past trunk's failure point has not run the job, it has run
 *       part of it.
 *
 * Why a NAME marker and not a list declared in the workflow: steps are matched by exact name (D2/4b),
 * so marking the very step that failed on trunk renames it, and D2 then reads it as absent and
 * refuses. A list inside the workflow would be read from the branch, which is the party being graded.
 *
 * Limit, stated: a red in a publishing step, or in a later job that only runs after a tag (npm,
 * deploy), cannot be cured by a dry run. That stays a ci-grant. So does a red job that ran ZERO steps
 * (a runner that never picked it up) on the carve-out path: 4c has no usable duration for it and
 * refuses, which is the safe direction and a deliberately unmade loosening, like the timeout case.
 *
 * PURE BY CONSTRUCTION, identical posture to ci-grant.js / migration-grant.js / readiness.js /
 * shipguard.js: signals in, verdict out. No git, no network, no `gh`. The caller (tools/colab)
 * measures containment, evidence, anti-stacking and the workflow-file diff, and hands them in.
 * The carve-out's job-level signal is shaped here too (`shapeJobEvidence`), from raw `gh run view
 * --json jobs` rows the caller reads — so the red-job SELECTION rule is unit-testable and the
 * caller's untestable residue stays plain I/O.
 *
 * DELIBERATELY NOT THE SAME DOOR AS A CI GRANT: no label, no per-issue tracker comment, no
 * `COLAB_HUMAN=1` bar to pass through — the whole point of proving the fact mechanically is
 * that nothing here needs a human write. If any condition fails, the ordinary ci-grant remains
 * available as the fallback door, unaffected by anything in this module.
 */

/**
 * The condition-4 refusal, verbatim — the text a workflow-touching branch gets when the carve-out
 * (#321) does not admit it. Held as a constant so the plain refusal and the carve-out's more
 * specific one can never drift apart: the carve-out appends its own reason to THIS string rather
 * than restating it.
 */
const WORKFLOW_REFUSAL =
  'branch diff touches .github/workflows/** — the cure rule refuses to let a branch self-certify ' +
  'a change to the CI configuration that is grading it; a human ci-grant is the door for this case';

/**
 * The condition-5 refusal (#297) — the text a branch gets when its diff changes the `scripts` block
 * of any `package.json`. No carve-out follows it, deliberately: the #321 carve-out's evidence (job
 * names, executed steps, duration) cannot see a scripts weakening, which happens INSIDE a step whose
 * name and conclusion are unchanged.
 */
const MANIFEST_SCRIPTS_REFUSAL =
  'branch diff changes the `scripts` block of package.json — CI templates read that block to decide which ' +
  'checks run, so it is part of the instrument grading this branch and the cure rule will not let a branch ' +
  'change it and grade itself; there is no carve-out for this case, a human ci-grant is the door';

/**
 * The condition-6 refusal (#377) — a branch whose diff changes a Python dependency manifest. No
 * carve-out, for the same reason as condition 5: the skip happens inside a job whose name and
 * conclusion are unchanged.
 */
const PYTHON_MANIFEST_REFUSAL =
  'branch diff changes a Python dependency manifest — the Python CI template runs lint, typecheck and test only ' +
  'when the tool is installed from those files, so they are part of the instrument grading this branch and the cure ' +
  'rule will not let a branch change them and grade itself (a version pin counts too); there is no carve-out for ' +
  'this case, a human ci-grant is the door';

/** Conclusions that do NOT make a completed job red. Inverted allowlist, the same shape (and for
 *  the same reason) as tools/lib/git.js's run-level rule: a denylist gets chased value by value,
 *  an allowlist closes the family once. `skipped` joins the run-level pair here because a job that
 *  never ran is not a job that failed. */
const NOT_RED_CONCLUSIONS = new Set(['success', 'cancelled', 'skipped']);

/** The suffix a step name carries when the dry run skips it because it writes outside the run (#474).
 *  The template names its publishing steps with it; D3 admits no other skipped step. */
const PUBLISH_STEP_MARKER = '[publish]';

/** The sentinel step a dry-run job instance runs and an ordinary one skips (#474). Its successful
 *  presence is the only thing that marks an instance as a dry run here. Must match the template's
 *  step name byte for byte. */
const DRY_RUN_STEP = 'Dry run — nothing is tagged, released or published';

function isPublishStepName(name) {
  return typeof name === 'string' && name.trimEnd().endsWith(PUBLISH_STEP_MARKER);
}

/** A job instance is a dry run iff its sentinel step concluded `success`. A skipped sentinel is an
 *  ordinary run (the template's `if:` was false), never a dry one. */
function isDryRunSteps(steps) {
  return Array.isArray(steps) && steps.some((s) => s && s.name === DRY_RUN_STEP && s.conclusion === 'success');
}

/** A step "ran" on trunk iff it reached a terminal conclusion that is not `skipped`/`cancelled`.
 *  Steps after the failing one are skipped by GitHub, and a skipped step constrains nothing. */
function stepRan(s) {
  return !!s && s.status === 'completed' && s.conclusion !== 'skipped' && s.conclusion !== 'cancelled';
}

/** Milliseconds between two ISO timestamps, or null when either is missing/unparseable. Never 0-by
 *  default: an unmeasurable duration must reach the caller as null so it can fail closed, not as a
 *  zero that would silently satisfy a `>= 0` comparison. */
function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(completedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = b - a;
  return Number.isFinite(d) ? d : null;
}

/** A duration is usable for the 4c comparison only if it is a finite, strictly positive number.
 *  `0` is not "instant", it is "not measured" — a job GitHub reports with equal start and end
 *  timestamps tells us nothing, and admitting it would let a fast-exit satisfy the floor. */
function usableMs(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Shapes the raw `gh run view --json jobs` rows the caller read into the `jobEvidence` structure
 * `workflowCarveOut` consumes — PURE, so the red-job selection rule is unit-testable rather than
 * buried in tools/colab's I/O.
 *
 * `redRunJobs` — every job of every NOT-GREEN workflow run at trunk's red sha, concatenated. The
 * caller must pass jobs from ALL such runs, not just one: a sha can carry several workflow runs,
 * and building the red set from one picked row could miss a second failing workflow and admit a
 * carve-out while a job is still red.
 *
 * `branchRunJobs` — every job of EVERY run at the branch's own head, concatenated (#297). Not just
 * the one green row the evidence read picked: once 2b applies to every cure, a red job living in a
 * sibling workflow would otherwise read as "absent on the branch" and refuse a genuine cure.
 *
 * Each row may carry `workflowName` (the caller tags it from the run it came from); it is carried
 * through on both sides so jobs are matched per workflow, never by bare name across workflows.
 *
 * Returns `null` — meaning "unmeasurable", which every consumer below fails closed on — when
 * either input is not an array, or when ANY trunk job at the red sha has not COMPLETED. A
 * half-finished red run cannot be adjudicated: a job still in flight may yet become the red one
 * the branch would have to prove it repaired.
 */
function shapeJobEvidence({ redRunJobs, branchRunJobs } = {}) {
  if (!Array.isArray(redRunJobs) || !Array.isArray(branchRunJobs)) return null;
  if (redRunJobs.some((j) => !j || j.status !== 'completed')) return null;

  const redJobs = redRunJobs
    .filter((j) => !NOT_RED_CONCLUSIONS.has(j.conclusion))
    .map((j) => ({
      name: j.name,
      workflowName: j.workflowName || '',
      conclusion: j.conclusion,
      durationMs: durationMs(j.startedAt, j.completedAt),
      ranSteps: Array.isArray(j.steps) ? j.steps.filter(stepRan).map((s) => s.name) : null,
    }));

  const branchJobs = branchRunJobs.map((j) => ({
    name: j && j.name,
    workflowName: (j && j.workflowName) || '',
    status: j && j.status,
    conclusion: j && j.conclusion,
    durationMs: j ? durationMs(j.startedAt, j.completedAt) : null,
    steps: j && Array.isArray(j.steps) ? j.steps.map((s) => ({ name: s && s.name, conclusion: s && s.conclusion })) : null,
    dryRun: !!j && isDryRunSteps(j.steps),
  }));

  return { redJobs, branchJobs };
}

/** How a job is named in a reason string: `workflow / job` when the workflow is known. */
function jobLabel(j) {
  return j.workflowName ? `${j.workflowName} / ${j.name}` : j.name;
}

/** The matching key: workflow AND job name (#297). A bare-name key over the union of every run at
 *  the branch head would let a passing `test` in one workflow stand in for a missing or failed
 *  `test` in another — fail-open. A row with no workflow name keys under `''` on both sides. */
function jobKey(j) {
  return `${j.workflowName || ''}\u0000${j.name}`;
}

/**
 * Index the branch's jobs by `jobKey`. The same key legitimately appears more than once — the push
 * and the `pull_request` run of one workflow at one sha, or a cancelled attempt beside a green one.
 * The instance kept is a completed `success` one when any exists; `hasRed` records that ANY instance
 * completed with a red conclusion, and `hasPending` that any instance has not completed. Both refuse
 * in `redJobsProvenOnBranch`: a job that passed once and failed once at the same sha has not proven
 * anything, and one still in flight has not passed.
 */
function indexBranchJobs(branchJobs) {
  const idx = new Map();
  for (const j of branchJobs) {
    if (!j || !j.name) continue;
    const k = jobKey(j);
    const prev = idx.get(k);
    const isRed = j.status === 'completed' && !NOT_RED_CONCLUSIONS.has(j.conclusion);
    const isPending = j.status !== 'completed';
    if (!prev) { idx.set(k, { job: j, hasRed: isRed, hasPending: isPending }); continue; }
    const ok = (x) => x.status === 'completed' && x.conclusion === 'success';
    // A green ORDINARY instance outranks a green dry run (#474): the dry-run rules only apply when
    // a dry run is the sole evidence the branch has for that job.
    const better = ok(j) && (!ok(prev.job) || (prev.job.dryRun && !j.dryRun));
    idx.set(k, { job: better ? j : prev.job, hasRed: prev.hasRed || isRed, hasPending: prev.hasPending || isPending });
  }
  return idx;
}

/**
 * The dry-run rules (#474), D1–D3 — see the module header. `red` is a trunk red job (with
 * `ranSteps`), `mine` the branch's dry-run instance of the same job (with `steps`). Returns a refusal
 * reason, or '' when the dry run is admissible evidence for this job.
 */
function dryRunEvidence(red, mine) {
  const label = jobLabel(red);
  if (!Array.isArray(red.ranSteps) || !Array.isArray(mine.steps)) {
    return `job \`${label}\` is proven only by a dry run, and its step lists could not be read — a dry run is admissible only step by step`;
  }
  const mySteps = new Map();
  for (const s of mine.steps) if (s && s.name) mySteps.set(s.name, s);
  for (const stepName of red.ranSteps) {
    const s = mySteps.get(stepName);
    if (!s) {
      return `step \`${stepName}\` RAN in job \`${label}\` on trunk and is absent from the branch's dry run — a dry run proves only the steps it executes`;
    }
    if (s.conclusion !== 'success') {
      return `step \`${stepName}\` RAN in job \`${label}\` on trunk and concluded \`${s.conclusion}\` in the branch's dry run — ` +
        'a dry run cannot cure a red in a step it does not execute (a red in a publishing step stays a ci-grant)';
    }
  }
  for (const s of mine.steps) {
    if (!s || s.conclusion === 'success') continue;
    if (s.conclusion === 'skipped' && isPublishStepName(s.name)) continue;
    return `step \`${s && s.name}\` concluded \`${s && s.conclusion}\` in the branch's dry run of job \`${label}\` and is not a publishing step ` +
      `(name ending \`${PUBLISH_STEP_MARKER}\`) — a dry run may skip only the steps that write outside the run`;
  }
  return '';
}

/**
 * Sub-test 4a (#321), and — since #297 — condition 2b of EVERY cure: every job RED on trunk exists
 * on the branch's runs at its own head, completed and successful.
 *
 * WHY HOISTED (#297). Condition 2 used to read a single run-level conclusion. That is weaker than
 * the rule's own claim — "the branch's tree provably turns trunk green" — because nothing checked
 * that the check trunk is red ON ran here and passed: a `paths:` filter, a matrix change, or a job
 * that simply no longer exists can leave a run green while the named check never ran. "The one
 * check that was failing must now pass" is the claim stated exactly. It is scoped to trunk's RED
 * set, so it never inherits a fold-every-check-run consumer's sensitivity to an advisory failure
 * that exists only on the branch: this certifies that the branch cures trunk's red, not that the
 * branch is spotless.
 *
 * Returns `{ok, reason, jobs, dryRunJobs}` — `jobs` is the list of red job names proven on the branch,
 * `dryRunJobs` the subset proven only by a dry run (#474), each having passed D1–D3.
 * Every unmeasurable input is a refusal, never a pass.
 */
function redJobsProvenOnBranch(jobEvidence) {
  if (!jobEvidence || typeof jobEvidence !== 'object') {
    return { ok: false, jobs: [], reason: 'the job-level evidence needed to judge it could not be measured (a failed read, or no run to read)' };
  }
  const { redJobs, branchJobs } = jobEvidence;
  if (!Array.isArray(redJobs) || redJobs.length === 0) {
    // An EMPTY red set is the dangerous shape, not a vacuous pass: trunk is red at run level, so
    // "I could not name a single red job" is an unmeasurable state. Every `.every()` below would
    // be trivially true over it.
    return { ok: false, jobs: [], reason: 'trunk is red but no red JOB could be named on its run — an unmeasurable red is never cured' };
  }
  if (!Array.isArray(branchJobs) || branchJobs.length === 0) {
    return { ok: false, jobs: [], reason: "the branch's own run reported no jobs to compare against" };
  }
  const idx = indexBranchJobs(branchJobs);
  const dryRunJobs = [];

  for (const red of redJobs) {
    if (!red || !red.name) {
      return { ok: false, jobs: [], reason: 'a job red on trunk has no name — it cannot be matched on the branch' };
    }
    const label = jobLabel(red);
    const entry = idx.get(jobKey(red));
    if (!entry) {
      return { ok: false, jobs: [],
        reason: `job \`${label}\` is red on trunk and does not exist on the branch's run — a cure may not make the failing job disappear (deleted, renamed, or filtered away)` };
    }
    const mine = entry.job;
    if (mine.status !== 'completed' || entry.hasPending) {
      return { ok: false, jobs: [],
        reason: `job \`${label}\` is red on trunk and has not COMPLETED on the branch's run — a job still in flight has not passed` };
    }
    if (mine.conclusion !== 'success') {
      return { ok: false, jobs: [],
        reason: `job \`${label}\` is red on trunk and concluded \`${mine.conclusion}\` on the branch's run — every red job must pass, not merely exist` };
    }
    if (entry.hasRed) {
      return { ok: false, jobs: [],
        reason: `job \`${label}\` is red on trunk and failed in another run at the branch's own head — a job that both passed and failed at one sha has proven nothing` };
    }
    if (mine.dryRun) {
      const why = dryRunEvidence(red, mine);
      if (why) return { ok: false, jobs: [], reason: why };
      dryRunJobs.push(red.name);
    }
  }
  return { ok: true, jobs: redJobs.map((r) => r.name), ...(dryRunJobs.length ? { dryRunJobs } : {}), reason: '' };
}

/**
 * The guarded carve-out through condition 4 (#321) — 4a (via `redJobsProvenOnBranch`), then 4b
 * (executed-step superset) and 4c (duration floor). See the module header for why each sub-test
 * exists and what the carve-out is honestly blind to.
 *
 * Returns `{ok, reason, jobs}` — on success `jobs` is `[{name, redMs, branchMs}]`, the audit
 * detail the caller folds into the `CI-Cure:` trailer and the `--dry --json` payload so a later
 * reader can tell WHICH door spent this red episode's single permitted exemption.
 */
function workflowCarveOut(jobEvidence) {
  const proven = redJobsProvenOnBranch(jobEvidence);
  if (!proven.ok) return { ok: false, jobs: [], reason: proven.reason };

  const idx = indexBranchJobs(jobEvidence.branchJobs);

  const jobs = [];
  for (const red of jobEvidence.redJobs) {
    const mine = idx.get(jobKey(red)).job; // present: redJobsProvenOnBranch above refused otherwise

    // 4b — executed-step superset.
    if (!Array.isArray(red.ranSteps)) {
      return { ok: false, jobs: [], reason: `the steps that ran in job \`${red.name}\` on trunk could not be read — an unmeasurable step list is never a cure` };
    }
    if (!Array.isArray(mine.steps)) {
      return { ok: false, jobs: [], reason: `the steps of job \`${red.name}\` on the branch's run could not be read — an unmeasurable step list is never a cure` };
    }
    const mySteps = new Map();
    for (const s of mine.steps) if (s && s.name) mySteps.set(s.name, s);
    for (const stepName of red.ranSteps) {
      const s = mySteps.get(stepName);
      if (!s) {
        return { ok: false, jobs: [],
          reason: `step \`${stepName}\` RAN in job \`${red.name}\` on trunk and is absent from the branch's run — a cure may not delete the steps the failure went through` };
      }
      if (s.conclusion !== 'success') {
        return { ok: false, jobs: [],
          reason: `step \`${stepName}\` RAN in job \`${red.name}\` on trunk and concluded \`${s.conclusion}\` on the branch — a step skipped away is not a step repaired` };
      }
    }

    // 4c — duration floor, relative to the failure it replaces.
    if (!usableMs(red.durationMs) || !usableMs(mine.durationMs)) {
      return { ok: false, jobs: [],
        reason: `job \`${red.name}\` has no usable wall-clock duration on one or both runs — the carve-out cannot tell a real run from a fast exit without it` };
    }
    if (mine.durationMs < red.durationMs) {
      return { ok: false, jobs: [],
        reason: `job \`${red.name}\` took ${mine.durationMs}ms on the branch but ${red.durationMs}ms to fail on trunk — too fast to have done the work the failure did. ` +
          '(If trunk went red by TIMEOUT or hang, that failure ran LONGER than any healthy run and this refusal is a known false one — take the ordinary ci-grant door, which is unaffected.)' };
    }

    jobs.push({ name: red.name, redMs: red.durationMs, branchMs: mine.durationMs });
  }

  return { ok: true, jobs, reason: '' };
}

/**
 * The step proof behind the #475/#476 manifest admissions — 4b without 4c, plus (for a pin) the
 * no-late-skip test. See the module header. Returns `{ok, reason}`; every unmeasurable input refuses.
 * Called only after `redJobsProvenOnBranch` passed, so every red job has a successful branch instance.
 */
function manifestStepProof(jobEvidence, { noLateSkip = false } = {}) {
  if (!jobEvidence || !Array.isArray(jobEvidence.redJobs) || !Array.isArray(jobEvidence.branchJobs)) {
    return { ok: false, reason: 'the job-level evidence could not be measured' };
  }
  const idx = indexBranchJobs(jobEvidence.branchJobs);
  for (const red of jobEvidence.redJobs) {
    // A dry-run instance (#474) is the job's branch evidence like any other — redJobsProvenOnBranch
    // already held it to D1–D3, which imply the superset below. See the late-skip note.
    const entry = idx.get(jobKey(red));
    if (!entry) return { ok: false, reason: `job \`${jobLabel(red)}\` is absent on the branch` };
    const mine = entry.job;
    if (!Array.isArray(red.ranSteps) || !red.ranSteps.length) {
      return { ok: false, reason: `the steps that ran in job \`${jobLabel(red)}\` on trunk could not be read` };
    }
    if (!Array.isArray(mine.steps)) {
      return { ok: false, reason: `the steps of job \`${jobLabel(red)}\` on the branch could not be read` };
    }
    let last = -1;
    for (const stepName of red.ranSteps) {
      const at = mine.steps.findIndex((s) => s && s.name === stepName);
      if (at === -1) {
        return { ok: false, reason: `step \`${stepName}\` ran in job \`${jobLabel(red)}\` on trunk and is absent on the branch` };
      }
      if (mine.steps[at].conclusion !== 'success') {
        return { ok: false,
          reason: `step \`${stepName}\` ran in job \`${jobLabel(red)}\` on trunk and concluded \`${mine.steps[at].conclusion}\` on the branch` };
      }
      if (at > last) last = at;
    }
    if (noLateSkip) {
      // A dry run (#474) skips its `[publish]` steps by design, and D3 already refused any OTHER skip
      // in it — so those, and only those, are not a dropped tool.
      const late = mine.steps.slice(last + 1)
        .find((s) => s && s.conclusion === 'skipped' && !(mine.dryRun && isPublishStepName(s.name)));
      if (late) {
        return { ok: false,
          reason: `step \`${late.name}\` in job \`${jobLabel(red)}\` comes after trunk's failure point and was skipped on the branch — ` +
            'trunk never reached it, so whether the pin dropped the tool it needs is unmeasurable' };
      }
    }
  }
  return { ok: true, reason: '' };
}

/**
 * Would a dry run on the branch supply the evidence 2b is missing (#474)? PURE. Returns the sorted
 * workflow names to dispatch, or `[]`. Non-empty only when EVERY red job is either already passing
 * on the branch (completed `success`, nothing red or pending beside it) or ABSENT from the branch's
 * runs in a workflow listed in `dryRunCapable` — and at least one is absent. A red job that is
 * present-but-failing, pending, or absent in a workflow without a dry-run mode means no dispatch
 * would help, so none is asked for. Whether the dry run, once it exists, passes D1–D3 is decided
 * then, not predicted now.
 */
function dryRunDispatchPlan(jobEvidence, dryRunCapable) {
  const capable = new Set(Array.isArray(dryRunCapable) ? dryRunCapable : dryRunCapable instanceof Set ? [...dryRunCapable] : []);
  if (!capable.size || !jobEvidence || !Array.isArray(jobEvidence.redJobs) || !jobEvidence.redJobs.length) return [];
  const idx = indexBranchJobs(Array.isArray(jobEvidence.branchJobs) ? jobEvidence.branchJobs : []);
  const want = new Set();
  for (const red of jobEvidence.redJobs) {
    if (!red || !red.name) return [];
    const entry = idx.get(jobKey(red));
    if (!entry) {
      if (!red.workflowName || !capable.has(red.workflowName)) return [];
      want.add(red.workflowName);
      continue;
    }
    const mine = entry.job;
    if (mine.status !== 'completed' || entry.hasPending || mine.conclusion !== 'success' || entry.hasRed) return [];
  }
  return [...want].sort();
}

/**
 * The prior exemption's red sha (#477), read off its merge commit's message: both trailers carry
 * `over-red <trunk>@<sha>` — `CI-Grant:` (#105) and `CI-Cure:` (#281) — and that sha is what the
 * prior exemption was measured against. Returns the hex string as written (usually short) or `null`
 * when no such trailer line is present. Only a line STARTING with one of the two prefixes counts,
 * the same anchoring `computeAntiStacking`'s `--grep` uses, so prose quoting a trailer cannot feed it.
 */
function priorRedShaFromMessage(message) {
  if (typeof message !== 'string') return null;
  for (const line of message.split('\n')) {
    const m = /^CI-(?:Grant|Cure):.*\bover-red \S*@([0-9a-f]{7,40})\b/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * The red-job SET at one trunk sha (#477), from the raw job rows of every not-green run there —
 * the same selection `shapeJobEvidence` makes (an incomplete job → `null`, unmeasurable), reduced
 * to `{name, workflowName}` identities.
 */
function redJobSet(redRunJobs) {
  const shaped = shapeJobEvidence({ redRunJobs, branchRunJobs: [] });
  if (!shaped) return null;
  return shaped.redJobs.map((j) => ({ name: j.name, workflowName: j.workflowName }));
}

/**
 * Progress past condition 3 (#477) — PURE. `prior` is the red-job set at the red sha the most recent
 * exemption on this continuous red was measured against; `current` the red-job set at trunk's red
 * sha now (the `redJobs` of `shapeJobEvidence`). Jobs are compared by `jobKey` — workflow AND name,
 * the same identity 2b matches on.
 *
 * ok only when `current` is a STRICT subset of `prior`: every job red now was already red then, and
 * at least one job red then is not red now. An equal set is no progress (the prior exemption fixed
 * nothing that stayed fixed); a job red now that was not red then is a NEW failure and refuses even
 * if another job was repaired — admitting it would let a chain of cures trade one red for another
 * forever. Either set unmeasured (`null`, non-array) or empty refuses: an empty `prior` cannot have
 * been the basis of an exemption, and an empty `current` on a red trunk is unmeasurable (same
 * posture as 2b).
 */
function redSetShrank(prior, current) {
  if (!Array.isArray(prior) || !Array.isArray(current)) {
    return { ok: false, reason: 'the red-job set at the prior exemption\'s red sha could not be measured' };
  }
  if (!prior.length || !current.length) {
    return { ok: false, reason: 'a red-job set to compare was empty — an unmeasurable red set is never progress' };
  }
  const before = new Map(prior.map((j) => [jobKey(j), j]));
  const now = new Map(current.map((j) => [jobKey(j), j]));
  const added = [...now.keys()].filter((k) => !before.has(k)).map((k) => jobLabel(now.get(k)));
  const healed = [...before.keys()].filter((k) => !now.has(k)).map((k) => jobLabel(before.get(k)));
  const still = [...now.values()].map(jobLabel);
  if (added.length) {
    return { ok: false, added, healed, still,
      reason: `trunk's red set did not shrink: ${added.map((n) => `\`${n}\``).join(', ')} is red now and was not at the prior exemption's red sha — a new failure is not progress` };
  }
  if (!healed.length) {
    return { ok: false, added, healed, still,
      reason: `trunk's red set is unchanged since the prior exemption (${still.map((n) => `\`${n}\``).join(', ')}) — no progress` };
  }
  return { ok: true, added, healed, still,
    reason: `trunk's red set shrank since the prior exemption: ${healed.map((n) => `\`${n}\``).join(', ')} healed, ` +
      `${still.map((n) => `\`${n}\``).join(', ')} still red` };
}

/**
 * Condition 3 as `cureVerdict` applies it (#477): the caller's `stacking` verdict, widened ONLY on
 * its stacked refusal (`stacking.stacked`, set by ci-grant.js's stackingVerdict) and only by
 * measured progress. Returns `{ok, reason, progress}` — `progress` is the `redSetShrank` result
 * whenever it was consulted, so the success path can carry it into the trailer.
 */
function stackingWithProgress(stacking, priorRedJobs, jobEvidence) {
  if (stacking && stacking.ok) return { ok: true, reason: '', progress: null };
  const base = (stacking && stacking.reason) || 'anti-stacking verdict unavailable';
  if (!stacking || !stacking.stacked) return { ok: false, reason: base, progress: null };
  const current = jobEvidence && Array.isArray(jobEvidence.redJobs) ? jobEvidence.redJobs : null;
  const progress = redSetShrank(priorRedJobs, current);
  if (!progress.ok) {
    return { ok: false, progress, reason: `${base} The progress admission (#477) does not admit it either: ${progress.reason}` };
  }
  return { ok: true, reason: '', progress };
}

/**
 * The cure verdict for one branch's attempt to ship into a red trunk.
 *
 * `containsRedSha` — bool, whether the branch's tree contains the red trunk sha as an ancestor
 * (the caller's `git merge-base --is-ancestor <redSha> <branch>`, translated to a bool — never
 * re-derived here, this module does not touch git).
 *
 * `evidence` — `{ok, sha}` for a completed, successful CI run measured on the branch's CURRENT
 * head, or `null` when the caller's own read of it FAILED. Passing `evidence: null` means "the
 * read failed", never "no evidence" — same fail-closed posture ci-grant.js's evaluateIssue
 * takes on a failed record read.
 *
 * `redSha` — carried through only for the success/failure detail strings, never compared here
 * (the caller already used it to compute `containsRedSha` and `evidence`).
 *
 * `stacking` — `{ok, reason}`, the caller's `ciGrant.stackingVerdict(...)` result, reused
 * verbatim (condition 3) — this module never recomputes it. Its stacked refusal carries
 * `stacked: true`; only that refusal can be lifted, by progress (#477).
 *
 * `priorRedJobs` (#477) — `redJobSet(...)` at the red sha the prior exemption named in its trailer,
 * or `null` when unmeasured. Consulted only on a stacked refusal; compared with `jobEvidence.redJobs`.
 *
 * `workflowsTouched` — bool, whether the branch's diff against trunk touches any path under
 * `.github/workflows/` (condition 4 — tools/lib/cure-diff.js, `--no-renames`). `null` means the
 * diff could not be measured, and refuses.
 *
 * `manifestScriptsTouched` — bool, whether the diff changes the `scripts` block of any
 * `package.json` (condition 5, #297 — tools/lib/cure-diff.js). `null`/`undefined` = unmeasured,
 * which refuses: a caller that did not measure it has not shown the instrument is intact.
 * `manifestPaths` — the manifests whose scripts changed, named in the refusal.
 *
 * `manifestScriptsAddOnly` (#475) — cure-diff's classifier: `[{path, added}]` when every touched
 * manifest's scripts change is add-only, anything else (null/undefined) when not. Only consulted when
 * `manifestScriptsTouched` is true; a caller that does not pass it gets the pre-#475 refusal.
 *
 * `pythonManifestTouched` — bool, whether the diff changes a Python dependency manifest the Python
 * template installs from (condition 6, #377). `null`/`undefined` = unmeasured, which refuses.
 * `pythonManifestPaths` — those files, named in the refusal.
 *
 * `pythonPinOnly` (#476) — cure-diff's classifier: `[{path, pins}]` when every touched Python
 * manifest changed only version specifiers. Same posture as `manifestScriptsAddOnly`.
 *
 * `jobEvidence` — `shapeJobEvidence(...)`'s output, or `null`. Read on EVERY cure since #297 —
 * condition 2b (`redJobsProvenOnBranch`) — and again by the #321 carve-out when workflows were
 * touched. `null`, an empty `redJobs`, an empty `branchJobs`, an unreadable step list and an
 * unusable duration ALL refuse — evidence widens a door, the absence of it never does. The caller
 * measures it only once containment and 2a have passed, so an ordinary green-trunk ship still pays
 * no job-level `gh` calls.
 *
 * Order of checks: cheapest/most-fundamental first, each with a distinct actionable reason —
 * identical posture to ci-grant.js's evaluateIssue: containment → 2a (run green) → 2b (the red jobs
 * pass here) → anti-stacking → diff measurable → condition 5 (manifest scripts) → condition 6 (Python
 * manifests) → condition 4 with its carve-out. Conditions 5 and 6 sit BEFORE the workflow block, not after it: that block RETURNS
 * `ok: true` when the carve-out admits, so a check placed after it would never be reached by a
 * branch touching both — exactly the "two instrument paths, two doors" composition #321 asked for.
 *
 * Returns `{ok, reason}`; on success also `provenJobs` (the red job names 2b proved, additive,
 * #297), `admitted` (#475/#476 — `{scripts: [{path, added}], pins: [{path, pins}]}`, present only
 * when a manifest admission was used), `progress` (#477 — `{healed, still}`, present only when condition 3
 * was passed by progress past a prior exemption) and — ONLY on a cure that went through the carve-out —
 * `carveOut: {jobs}`. The ordinary
 * cure's reason text is unchanged, which is what lets the caller answer "which door was this?" by
 * the presence of `carveOut` rather than by re-deriving it.
 */
function cureVerdict({ containsRedSha, evidence, redSha, stacking, workflowsTouched, jobEvidence,
  manifestScriptsTouched, manifestPaths, manifestScriptsAddOnly, pythonManifestTouched, pythonManifestPaths,
  pythonPinOnly, dryRunCapable, priorRedJobs }) {
  if (!containsRedSha) {
    return { ok: false,
      reason: `branch does not contain trunk's current red head \`${redSha}\` as an ancestor — ` +
        'it cannot prove it cures this red without rebasing onto trunk first (this pays a fresh CI round, by design). ' +
        'Only if this branch IS the patch: a bystander does not rebase onto the red, it waits for green trunk (#353)' };
  }
  if (!evidence) {
    return { ok: false,
      reason: 'branch\'s own CI run could not be measured (a failed read) — a failed evidence read is never a cure' };
  }
  if (!evidence.ok) {
    return { ok: false,
      reason: 'branch has no completed, successful CI run at its own current head — the cure rule requires ' +
        'MEASURED evidence, never asserted, same bar a human ci-grant holds. Where the repo\'s workflows fire only on ' +
        'trunk push / pull_request, a PR is the only way to get that run — open one ONLY for the branch carrying the fix; ' +
        'a bystander\'s PR runs against a merge ref that includes the red trunk, so it waits for green instead (#353)' };
  }
  const proven = redJobsProvenOnBranch(jobEvidence);
  const cond3 = stackingWithProgress(stacking, priorRedJobs, jobEvidence);
  if (!proven.ok) {
    const out = { ok: false,
      reason: `branch's run is green, but the check trunk is red on is not proven here: ${proven.reason} — ` +
        'a cure must pass the named failing job(s), not merely produce a green run (#297)' };
    // #474: say which dry run would supply the missing evidence — only when every LATER condition
    // already holds, so a dispatch is never asked for on a branch that would refuse anyway.
    const wanted = dryRunDispatchPlan(jobEvidence, dryRunCapable);
    // An admissible manifest change (#475/#476) does not suppress the ask: the admission is judged on
    // the dry run's steps once it exists, exactly like any other branch instance.
    const scriptsOk = manifestScriptsTouched === false
      || (manifestScriptsTouched === true && Array.isArray(manifestScriptsAddOnly) && manifestScriptsAddOnly.length > 0);
    const pythonOk = pythonManifestTouched === false
      || (pythonManifestTouched === true && Array.isArray(pythonPinOnly) && pythonPinOnly.length > 0);
    if (wanted.length && cond3.ok && scriptsOk && pythonOk
      && typeof workflowsTouched === 'boolean') {
      out.dryRunWanted = wanted;
    }
    return out;
  }
  const dry = proven.dryRunJobs && proven.dryRunJobs.length ? { jobs: proven.dryRunJobs } : null;
  const drySuffix = dry ? ` — the main-only job(s) ${dry.jobs.map((n) => `\`${n}\``).join(', ')} proven by a dry run on the branch (#474)` : '';
  if (!cond3.ok) {
    return { ok: false, reason: cond3.reason };
  }
  const prog = cond3.progress ? { progress: { healed: cond3.progress.healed, still: cond3.progress.still } } : {};
  const progSuffix = cond3.progress ? `; past a prior exemption on this red because ${cond3.progress.reason} (#477)` : '';
  if (typeof workflowsTouched !== 'boolean' || typeof manifestScriptsTouched !== 'boolean'
    || typeof pythonManifestTouched !== 'boolean') {
    return { ok: false,
      reason: 'branch diff could not be measured (which CI files and manifests it touches) — an unmeasured diff is never a cure' };
  }
  const admitted = {};
  if (manifestScriptsTouched) {
    const named = Array.isArray(manifestPaths) && manifestPaths.length ? manifestPaths.join(', ') : 'package.json';
    if (!Array.isArray(manifestScriptsAddOnly) || !manifestScriptsAddOnly.length) {
      return { ok: false, reason: `${MANIFEST_SCRIPTS_REFUSAL} (changed: ${named}; not add-only — a script removed, renamed, ` +
        'changed, or a lifecycle hook added)' };
    }
    const proof = manifestStepProof(jobEvidence);
    if (!proof.ok) {
      return { ok: false, reason: `${MANIFEST_SCRIPTS_REFUSAL} (changed: ${named}). The add-only admission (#475) does not ` +
        `admit it either: ${proof.reason}` };
    }
    admitted.scripts = manifestScriptsAddOnly;
  }
  if (pythonManifestTouched) {
    const named = Array.isArray(pythonManifestPaths) && pythonManifestPaths.length
      ? pythonManifestPaths.join(', ') : 'a Python dependency manifest';
    if (!Array.isArray(pythonPinOnly) || !pythonPinOnly.length) {
      return { ok: false, reason: `${PYTHON_MANIFEST_REFUSAL} (changed: ${named}; not pin-only — a requirement, extra, ` +
        'marker, include or option changed, or the file is setup.py/setup.cfg)' };
    }
    const proof = manifestStepProof(jobEvidence, { noLateSkip: true });
    if (!proof.ok) {
      return { ok: false, reason: `${PYTHON_MANIFEST_REFUSAL} (changed: ${named}). The pin-only admission (#476) does not ` +
        `admit it either: ${proof.reason}` };
    }
    admitted.pins = pythonPinOnly;
  }
  const via = admittedText(admitted);
  if (workflowsTouched) {
    const carve = workflowCarveOut(jobEvidence);
    if (!carve.ok) {
      return { ok: false, reason: `${WORKFLOW_REFUSAL}. The #321 carve-out does not admit it either: ${carve.reason}` };
    }
    const detail = carve.jobs.map((j) => `\`${j.name}\` (${j.redMs}ms red on trunk, ${j.branchMs}ms passing here)`).join(', ');
    return { ok: true, provenJobs: proven.jobs, carveOut: { jobs: carve.jobs }, ...(dry ? { dryRun: dry } : {}),
      ...(via ? { admitted } : {}), ...prog,
      reason: `branch contains red \`${redSha}\` as an ancestor AND is green at its own current head (\`${evidence.sha}\`) — proven cure, ` +
        `admitted through the #321 workflow carve-out: every job red on trunk ran to success here with every step it took on trunk — ${detail}${drySuffix}${via}${progSuffix}` };
  }
  return { ok: true, provenJobs: proven.jobs, ...(dry ? { dryRun: dry } : {}), ...(via ? { admitted } : {}), ...prog,
    reason: `branch contains red \`${redSha}\` as an ancestor AND is green at its own current head (\`${evidence.sha}\`) — proven cure${drySuffix}${via}${progSuffix}` };
}

/** The reason-text suffix naming which manifest admission(s) a cure used (#475/#476), or ''. */
function admittedText(admitted) {
  const parts = [];
  if (admitted.scripts) {
    parts.push(`add-only package.json scripts (${admitted.scripts.map((a) => `${a.path}: ${a.added.join(',')}`).join('; ')})`);
  }
  if (admitted.pins) {
    parts.push(`pin-only Python requirements (${admitted.pins.map((a) => `${a.path}: ${a.pins.join(',')}`).join('; ')})`);
  }
  return parts.length ? `; manifest change admitted as ${parts.join(' and ')}, every step trunk ran passing here` : '';
}

module.exports = { cureVerdict, redJobsProvenOnBranch, workflowCarveOut, manifestStepProof, shapeJobEvidence, dryRunDispatchPlan,
  priorRedShaFromMessage, redJobSet, redSetShrank,
  WORKFLOW_REFUSAL, MANIFEST_SCRIPTS_REFUSAL, PYTHON_MANIFEST_REFUSAL, PUBLISH_STEP_MARKER, DRY_RUN_STEP };
