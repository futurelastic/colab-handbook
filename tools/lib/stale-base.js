'use strict';
/**
 * Does the branch's CI verdict cover the CURRENT base? (#395)
 *
 * A serial `colab ship` used to read only the base's own run (`shipCiCheck`) and then sync the
 * base into the branch locally (B0) and squash — without the synced head ever running. So a
 * branch whose green run was measured on a head cut before the base moved landed on that older
 * verdict whenever the merge was textually clean. Measured: two branches, each green alone, one
 * changing a shared test base class the other's new tests also relied on — the combination went
 * red on trunk and neither run had seen it.
 *
 * The rule: when the branch HAS a CI run at its pushed head, that head must CONTAIN the base's
 * current tip. If it does not, the verdict is `stale-base` — the fix is mechanical (B0: sync the
 * base in, push, wait on the new run, re-ship), so the class is self-clearing, not human-gated.
 *
 * Deliberately NOT built (#395's "optional cheapness"): skipping the re-run when the base commits
 * since the branch's cut touch no file the branch's tests import. What a suite imports is not
 * measurable generically from git, and the issue forbids guessing it — so every stale head re-runs.
 *
 * Pure: every fact is measured by tools/colab (`shipStaleBaseCheck`) and handed in.
 *
 * @param {object} a
 * @param {string|null} a.headSha   - the branch's head ON THE REMOTE (what CI runs), null = not pushed
 * @param {object|null} a.run       - ghRunForCommit's summary at headSha; null = the read failed
 * @param {string|null} a.baseTip   - the base's current tip sha (remote-tracking, freshly fetched)
 * @param {boolean|string|null} a.contains - is baseTip an ancestor of headSha? null = unmeasurable;
 *                                  'no-change' = it is not, but the head lands no change (evidence-close)
 * @param {number|null} a.behind    - commits on the base the head lacks (display only)
 * @param {string} a.base           - the base's name, for the detail line
 * @param {boolean} a.ghUsable      - false = gh not usable here
 * @returns {{ok:boolean, verdict:string, selfClearing:boolean, detail:string}}
 */
function staleBaseVerdict(a) {
  const short = (s) => (s ? String(s).slice(0, 7) : '?');
  if (!a.headSha) {
    return { ok: true, verdict: 'no-run', selfClearing: false,
      detail: 'branch not on the remote — no branch run exists to be stale (B2a reads the trunk run at the squash)' };
  }
  if (!a.ghUsable) {
    // The base-CI row already refuses without gh; this row does not add a second, different refusal.
    return { ok: true, verdict: 'unread', selfClearing: false, detail: 'gh not usable — branch run unread (the CI row above already refuses)' };
  }
  if (a.run === null || a.run === undefined) {
    return { ok: false, verdict: 'unread', selfClearing: true,
      detail: `could not read the branch's runs at ${short(a.headSha)} — a failed read is never fresh; re-run` };
  }
  if (a.run.status === 'none') {
    return { ok: true, verdict: 'no-run', selfClearing: false,
      detail: `no branch run at ${short(a.headSha)} — nothing to be stale (Branch CI \`none\`; B2a reads the trunk run at the squash)` };
  }
  if (!a.baseTip || a.contains === null || a.contains === undefined) {
    return { ok: false, verdict: 'unread', selfClearing: true,
      detail: `could not tell whether ${short(a.headSha)} contains ${a.base}'s tip — fetch and re-run` };
  }
  if (a.contains === 'no-change') {
    return { ok: true, verdict: 'no-change', selfClearing: false,
      detail: `the head introduces no change against ${a.base} — nothing lands, so nothing is graded (evidence-close, #90)` };
  }
  if (a.contains) {
    return { ok: true, verdict: 'fresh', selfClearing: false,
      detail: `branch run at ${short(a.headSha)} contains ${a.base}@${short(a.baseTip)}` };
  }
  const n = Number.isFinite(a.behind) ? `${a.behind} commit(s)` : 'commits';
  return { ok: false, verdict: 'stale-base', selfClearing: true,
    detail: `stale-base: the branch run at ${short(a.headSha)} was measured without ${n} now on ${a.base} ` +
      `(tip ${short(a.baseTip)}) — two green runs can combine red. Sync ${a.base} into the branch (B0), ` +
      'push, wait on the new run (15-minute bound), then re-run ship' };
}

module.exports = { staleBaseVerdict };
