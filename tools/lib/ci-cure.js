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
 *      asserted), same "ask by sha" discipline ci-grant.js already uses.
 *
 * Containment + evidence TOGETHER mean the branch's tree passed the full suite INCLUDING the
 * tests trunk is currently failing — merging it provably turns trunk green. That is the one
 * thing the human click on a ci-grant is supposed to certify, mechanically checkable instead.
 *
 * TWO CONDITIONS THIS RULE ADDS ON TOP, deliberately narrowing it rather than trusting
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
 *
 * HONEST LIMIT, stated rather than glossed (same posture as the #281 proposal): test-file
 * self-weakening is not detectable at this gate. A branch can go green by gutting the failing
 * tests. Check-runs name jobs, not files, so this module cannot see it; condition 4 closes only
 * the adjacent, checkable door (weakening the CI config itself). Content weakening is caught
 * where it is caught today — review/grade time, downstream of ship.
 *
 * PURE BY CONSTRUCTION, identical posture to ci-grant.js / migration-grant.js / readiness.js /
 * shipguard.js: signals in, verdict out. No git, no network, no `gh`. The caller (tools/colab)
 * measures containment, evidence, anti-stacking and the workflow-file diff, and hands them in.
 *
 * DELIBERATELY NOT THE SAME DOOR AS A CI GRANT: no label, no per-issue tracker comment, no
 * `COLAB_HUMAN=1` bar to pass through — the whole point of proving the fact mechanically is
 * that nothing here needs a human write. If any condition fails, the ordinary ci-grant remains
 * available as the fallback door, unaffected by anything in this module.
 */

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
 * `.github/workflows/` (the caller's `git diff --name-only` filter, condition 4).
 *
 * Order of checks: cheapest/most-fundamental first, each with a distinct actionable reason —
 * identical posture to ci-grant.js's evaluateIssue.
 */
function cureVerdict({ containsRedSha, evidence, redSha, stacking, workflowsTouched }) {
  if (!containsRedSha) {
    return { ok: false,
      reason: `branch does not contain trunk's current red head \`${redSha}\` as an ancestor — ` +
        'it cannot prove it cures this red without rebasing onto trunk first (this pays a fresh CI round, by design)' };
  }
  if (!evidence) {
    return { ok: false,
      reason: 'branch\'s own CI run could not be measured (a failed read) — a failed evidence read is never a cure' };
  }
  if (!evidence.ok) {
    return { ok: false,
      reason: 'branch has no completed, successful CI run at its own current head — the cure rule requires ' +
        'MEASURED evidence, never asserted, same bar a human ci-grant holds' };
  }
  if (!stacking || !stacking.ok) {
    return { ok: false, reason: (stacking && stacking.reason) || 'anti-stacking verdict unavailable' };
  }
  if (workflowsTouched) {
    return { ok: false,
      reason: 'branch diff touches .github/workflows/** — the cure rule refuses to let a branch self-certify ' +
        'a change to the CI configuration that is grading it; a human ci-grant is the door for this case' };
  }
  return { ok: true,
    reason: `branch contains red \`${redSha}\` as an ancestor AND is green at its own current head (\`${evidence.sha}\`) — proven cure` };
}

module.exports = { cureVerdict };
