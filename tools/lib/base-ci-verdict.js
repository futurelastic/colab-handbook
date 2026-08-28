'use strict';
/**
 * "Was the sha this branch was CUT FROM actually green?" (#293).
 *
 * `colab ship`'s trunk-CI-green precondition (tools/lib/ci-verdict.js, `shipCiCheck` in
 * tools/colab) answers "is trunk green RIGHT NOW". It never asks whether the commit a branch was
 * cut from was green AT THE TIME — and those are different questions once trunk has moved. #293's
 * measured incident: three branches cut from one byte-identical RED base sha. Two drew a green run
 * of their own and shipped unchallenged; one drew red and cost a coordinator a hand diagnosis. None
 * of the three touched the failing harness — the differing verdicts were a flaky test on the base,
 * not a property of any diff.
 *
 * THE DANGEROUS CASE IS THE GREEN ONE. A branch whose base was red and whose own run is green
 * currently looks safest of all — a green run actively argues against looking further — so this is
 * the one severity that must be flagged LOUDEST, not folded quietly into "still needs a look".
 *
 * PURE BY CONSTRUCTION, same posture as ci-verdict.js / ci-grant.js / migration-grant.js /
 * shipguard.js: signals in, verdict out. No git, no gh, no clock — the caller (tools/colab, via
 * git.js's `ghRunForCommit`/`ghRunForSha`) does every network/subprocess read and hands this module
 * the two conclusions it needs. Every branch is directly reachable from `node --test`.
 *
 * ADVISORY, NOT A GATE. This module never says "block the merge" — it says "here is a fact a human
 * or a coordinator (code-ship / colab ship's grading) should see before treating this branch's own
 * green CI as sufficient evidence". Wiring it into an actual precondition that can flip `ship`'s
 * exit code is a decision this module deliberately does not make; #293 only asks for VISIBILITY
 * ("a coordinator does not re-derive the stale-base diagnosis by hand for every branch in a
 * sweep"), not for a new refusal.
 */

// Same allowlist the CI-green checks elsewhere in this toolchain use (ghRunForSha/ghRunForCommit,
// shipCiCheck): a completed run counts as GREEN only for 'success' — 'cancelled' is neutral (a
// passing sibling on the same sha is what answers the question, see git.js doc comment) and every
// other completed conclusion is red. Non-completed/absent is neither green nor red — it is simply
// not yet known, which is exactly the distinction 'unresolved' below exists to preserve.
function isGreen(status, conclusion) {
  return status === 'completed' && conclusion === 'success';
}

function isMeasuredRed(status, conclusion) {
  return status === 'completed' && conclusion !== 'success' && conclusion !== 'cancelled';
}

/**
 * `base` / `own` are each `{status, conclusion}` — the shape `ghRunForCommit`/`ghRunForSha` return
 * (a subset of it; extra fields are ignored, so a caller may pass the whole verdict object as-is).
 *
 * Returns `{ severity, why }`:
 *   - `severity: null`      — nothing to flag. The base was not measurably red (green, cancelled,
 *                             still running, or no run ever existed for it) — there is no red-base
 *                             claim to be wrong about, so this stays silent rather than guessing.
 *   - `'suspect-green'`     — base measurably red, branch's own head measurably GREEN. The loudest
 *                             case: the branch's CI verdict may be inherited from the base's flake,
 *                             not earned by this branch's own diff.
 *   - `'inherited-red'`     — base measurably red, branch's own head ALSO measurably red. Honest —
 *                             the branch is reporting the base's problem, not hiding it — but still
 *                             worth naming so a human does not waste time bisecting this branch's
 *                             diff for a failure that predates it.
 *   - `'unresolved'`        — base measurably red, branch's own head has no completed verdict yet
 *                             (still running, or no run at all). Neither confirms nor clears the
 *                             suspicion; say so rather than silently waiting.
 */
function classify(base, own) {
  const baseStatus = base && base.status;
  const baseConclusion = base && base.conclusion;
  if (!isMeasuredRed(baseStatus, baseConclusion)) {
    return { severity: null, why: 'base sha is not measurably red — nothing to flag' };
  }

  const ownStatus = own && own.status;
  const ownConclusion = own && own.conclusion;

  if (isGreen(ownStatus, ownConclusion)) {
    return {
      severity: 'suspect-green',
      why: `base was red (${baseConclusion}) but this branch's own head reads green — ` +
        'that green verdict may be inherited from the base, not earned by this diff',
    };
  }
  if (isMeasuredRed(ownStatus, ownConclusion)) {
    return {
      severity: 'inherited-red',
      why: `base was red (${baseConclusion}) and this branch's own head is red too (${ownConclusion}) — ` +
        'may be the SAME pre-existing failure, not something this diff introduced',
    };
  }
  return {
    severity: 'unresolved',
    why: `base was red (${baseConclusion}) and this branch's own head has no completed CI verdict yet ` +
      `(status=${ownStatus || 'none'}) — cannot yet say whether this branch clears it`,
  };
}

module.exports = { classify, isGreen, isMeasuredRed };
