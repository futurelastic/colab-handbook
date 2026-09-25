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

/** Conclusions that do NOT make a completed job red. Inverted allowlist, the same shape (and for
 *  the same reason) as tools/lib/git.js's run-level rule: a denylist gets chased value by value,
 *  an allowlist closes the family once. `skipped` joins the run-level pair here because a job that
 *  never ran is not a job that failed. */
const NOT_RED_CONCLUSIONS = new Set(['success', 'cancelled', 'skipped']);

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
    const better = j.status === 'completed' && j.conclusion === 'success'
      && !(prev.job.status === 'completed' && prev.job.conclusion === 'success');
    idx.set(k, { job: better ? j : prev.job, hasRed: prev.hasRed || isRed, hasPending: prev.hasPending || isPending });
  }
  return idx;
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
 * Returns `{ok, reason, jobs}` — `jobs` is the list of red job names proven on the branch.
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
  }
  return { ok: true, jobs: redJobs.map((r) => r.name), reason: '' };
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
 * verbatim (condition 3) — this module never recomputes it.
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
 * `jobEvidence` — `shapeJobEvidence(...)`'s output, or `null`. Read on EVERY cure since #297 —
 * condition 2b (`redJobsProvenOnBranch`) — and again by the #321 carve-out when workflows were
 * touched. `null`, an empty `redJobs`, an empty `branchJobs`, an unreadable step list and an
 * unusable duration ALL refuse — evidence widens a door, the absence of it never does. The caller
 * measures it only once containment and 2a have passed, so an ordinary green-trunk ship still pays
 * no job-level `gh` calls.
 *
 * Order of checks: cheapest/most-fundamental first, each with a distinct actionable reason —
 * identical posture to ci-grant.js's evaluateIssue: containment → 2a (run green) → 2b (the red jobs
 * pass here) → anti-stacking → diff measurable → condition 5 (manifest scripts) → condition 4 with
 * its carve-out. Condition 5 sits BEFORE the workflow block, not after it: that block RETURNS
 * `ok: true` when the carve-out admits, so a check placed after it would never be reached by a
 * branch touching both — exactly the "two instrument paths, two doors" composition #321 asked for.
 *
 * Returns `{ok, reason}`; on success also `provenJobs` (the red job names 2b proved, additive,
 * #297) and — ONLY on a cure that went through the carve-out — `carveOut: {jobs}`. The ordinary
 * cure's reason text is unchanged, which is what lets the caller answer "which door was this?" by
 * the presence of `carveOut` rather than by re-deriving it.
 */
function cureVerdict({ containsRedSha, evidence, redSha, stacking, workflowsTouched, jobEvidence,
  manifestScriptsTouched, manifestPaths }) {
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
  if (!proven.ok) {
    return { ok: false,
      reason: `branch's run is green, but the check trunk is red on is not proven here: ${proven.reason} — ` +
        'a cure must pass the named failing job(s), not merely produce a green run (#297)' };
  }
  if (!stacking || !stacking.ok) {
    return { ok: false, reason: (stacking && stacking.reason) || 'anti-stacking verdict unavailable' };
  }
  if (typeof workflowsTouched !== 'boolean' || typeof manifestScriptsTouched !== 'boolean') {
    return { ok: false,
      reason: 'branch diff could not be measured (which CI files and manifests it touches) — an unmeasured diff is never a cure' };
  }
  if (manifestScriptsTouched) {
    const named = Array.isArray(manifestPaths) && manifestPaths.length ? manifestPaths.join(', ') : 'package.json';
    return { ok: false, reason: `${MANIFEST_SCRIPTS_REFUSAL} (changed: ${named})` };
  }
  if (workflowsTouched) {
    const carve = workflowCarveOut(jobEvidence);
    if (!carve.ok) {
      return { ok: false, reason: `${WORKFLOW_REFUSAL}. The #321 carve-out does not admit it either: ${carve.reason}` };
    }
    const detail = carve.jobs.map((j) => `\`${j.name}\` (${j.redMs}ms red on trunk, ${j.branchMs}ms passing here)`).join(', ');
    return { ok: true, provenJobs: proven.jobs, carveOut: { jobs: carve.jobs },
      reason: `branch contains red \`${redSha}\` as an ancestor AND is green at its own current head (\`${evidence.sha}\`) — proven cure, ` +
        `admitted through the #321 workflow carve-out: every job red on trunk ran to success here with every step it took on trunk — ${detail}` };
  }
  return { ok: true, provenJobs: proven.jobs,
    reason: `branch contains red \`${redSha}\` as an ancestor AND is green at its own current head (\`${evidence.sha}\`) — proven cure` };
}

module.exports = { cureVerdict, redJobsProvenOnBranch, workflowCarveOut, shapeJobEvidence, WORKFLOW_REFUSAL, MANIFEST_SCRIPTS_REFUSAL };
