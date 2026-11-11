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
 * @param {boolean} a.ciReadable    - false = no CI read exists on this host: gh not usable and the
 *                                  remote's engine is not one the CLI reads CI from (#678). The old
 *                                  name `ghUsable` is still accepted.
 * @returns {{ok:boolean, verdict:string, selfClearing:boolean, detail:string}}
 */
function staleBaseVerdict(a) {
  const short = (s) => (s ? String(s).slice(0, 7) : '?');
  const ciReadable = a.ciReadable !== undefined ? a.ciReadable : a.ghUsable;
  if (!a.headSha) {
    return { ok: true, verdict: 'no-run', selfClearing: false,
      detail: 'branch not on the remote — no branch run exists to be stale (B2a reads the trunk run at the squash)' };
  }
  if (!ciReadable) {
    // #678: this used to pass ("the CI row above already refuses"). Once the CI row reads a forge
    // other than GitHub, that is no longer true, and a pass here would let a stale branch land on an
    // unread verdict. Unread refuses — except a head that lands nothing, which grades nothing (#90).
    if (a.contains === 'no-change') {
      return { ok: true, verdict: 'no-change', selfClearing: false,
        detail: `the head introduces no change against ${a.base} — nothing lands, so nothing is graded (evidence-close, #90)` };
    }
    return { ok: false, verdict: 'unread', selfClearing: false,
      detail: `no CI read on this host (gh not usable, and the remote's forge is not one colab reads CI from) — the branch run at ${short(a.headSha)} is unread, and an unread verdict never passes (#678)` };
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

/**
 * #682: is the branch head's OWN CI green? Read on a forge the engine map names (#678), where no
 * `colab ci-wait` used to exist for code-ship B1a to classify the branch with — so a red or running
 * branch head passed `colab ship --dry` as READY on the stale-base row alone (that row asks only
 * whether the run saw the base). The forge's summary is the same `ciVerdict` the trunk row reads.
 *
 *   completed / success  -> green, passes
 *   completed / other    -> red, human-gated: a branch lands only on its own green (C7.contract.03);
 *                           whether it is red:infra (one re-run) or red:finding (send back) is B1a's
 *   anything unfinished  -> pending, self-clearing: wait (`colab ci-wait`), then ship again
 *
 * Returns null where this row says nothing: no head on the remote, an unread run (the stale-base
 * row already refuses that as `unread`), or no status at all (the `none` row of Branch CI governs).
 * `run.notGreen` (tools/lib/ci-forgejo.js) names the contexts that keep the sha from green.
 *
 * @param {object} a
 * @param {string|null} a.headSha - the branch head on the remote
 * @param {object|null} a.run     - the forge's ciVerdict summary at headSha
 * @param {string} a.branch
 * @param {string} [a.engine]     - for the detail line, e.g. 'forgejo'
 * @returns {null|{ok:boolean, verdict:'green'|'red'|'pending', selfClearing:boolean, detail:string}}
 */
function branchHeadCiVerdict(a) {
  const run = a && a.run;
  if (!a || !a.headSha || !run || run.status === 'none') return null;
  const at = `${a.branch}@${String(a.headSha).slice(0, 7)} (${a.engine || 'forge'} commit status)`;
  const ng = Array.isArray(run.notGreen) ? run.notGreen : [];
  const name = (x) => `${x.name} (${x.status === 'completed' ? (x.conclusion || 'none') : x.status})`;
  if (run.status === 'completed' && run.conclusion === 'success') {
    const n = run.runCount == null ? 1 : run.runCount;
    return { ok: true, verdict: 'green', selfClearing: false, detail: `${n} context${n === 1 ? '' : 's'} at ${at}: ${n === 1 ? 'success' : 'all success'}` };
  }
  if (run.status === 'completed') {
    const red = ng.filter((x) => x.status === 'completed');
    const still = ng.filter((x) => x.status !== 'completed');
    return { ok: false, verdict: 'red', selfClearing: false,
      detail: `${at} is red — failing: ${red.length ? red.map(name).join(', ') : `conclusion=${run.conclusion || 'none'}`}` +
        `${still.length ? `; still running: ${still.map(name).join(', ')}` : ''}. A branch lands only on its own green (C7.contract.03): ` +
        'red:infra → re-run once; red:finding → send it back (code-ship B1a)' };
  }
  const still = ng.filter((x) => x.status !== 'completed');
  return { ok: false, verdict: 'pending', selfClearing: true,
    detail: `${at} has not finished — still running: ${still.length ? still.map(name).join(', ') : `status=${run.status}`}. ` +
      `Wait with \`colab ci-wait --sha ${a.headSha} --branch ${a.branch}\`, then run ship again` };
}

/**
 * #691: the GitHub half of #682's row. On GitHub the branch head's class used to be left wholly to
 * code-ship B1a (`colab ci-wait`), so `colab ship --dry --json` read READY on a head whose run had
 * FINISHED red — measured on a required secret-scan job that failed before scanning anything. The
 * row now refuses that one state, human-gated, in dry and real ship alike; everything else stays as
 * it was on GitHub (null — no row):
 *
 *   a run at the head finished red       -> red, human-gated (red:infra or red:finding is B1a's call)
 *   green / in flight / no run / unread  -> null: B1a's ci-wait still owns the wait, the stale-base
 *                                           row still speaks for `none` and an unread run
 *
 * "Finished red" is #606's docs-only rule (`docsOnlyBranchRow`): completed, and not success,
 * cancelled or skipped — so a code branch is never held to a weaker rule than a docs-only one.
 * `run` is the head's summary read under the verifying-runs policy (#503), the same rule the trunk
 * row uses, so a run that policy sets aside (a release lane, a `ship-ignore-workflows` entry) never
 * refuses here. `run.finishedRed` (tools/lib/git.js) lists every judged red run; without it the
 * summary's own status/conclusion decides.
 *
 * #723: a head where an EXPECTED workflow has no run (`run.missing`, git.summarizeRunsForCommit's
 * `opts.expected`) is pending, self-clearing, never a pass: ship --dry used to read READY on a head
 * where only an unrelated workflow had run and the repo's CI never got a run at all. A red still wins
 * (it is checked first). The detail names the missing workflow and how to get it a run — a hint only.
 *
 * @param {object} a
 * @param {string|null} a.headSha - the branch head on the remote
 * @param {object|null} a.run     - summarizeRunsForCommit's verdict at headSha, verifying policy applied
 * @param {string} a.branch
 * @returns {null|{ok:false, verdict:'red'|'pending', selfClearing:boolean, detail:string}}
 */
function githubBranchHeadRedVerdict(a) {
  const run = a && a.run;
  if (!a || !a.headSha || !run || run.status === 'none') return null;
  const listed = Array.isArray(run.finishedRed) ? run.finishedRed : [];
  const summaryRed = run.status === 'completed' && run.conclusion !== 'success' && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped';
  const at = `${a.branch}@${String(a.headSha).slice(0, 7)} (GitHub Actions)`;
  const missing = Array.isArray(run.missing) ? run.missing : [];
  if (!listed.length && !summaryRed) {
    if (!missing.length) return null;
    const { missingHint } = require('./verify-runs');
    return { ok: false, verdict: 'pending', selfClearing: true,
      detail: `${at} has no run of ${missing.map((x) => x.name).join(', ')}, though ${missing.length === 1 ? 'its' : 'their'} definition fires on a push to this branch — ` +
        `the runs that exist there do not stand in for it (#723). Wait with \`colab ci-wait --sha ${a.headSha} --branch ${a.branch}\`; ` +
        `if it ends NO_RUN (exit 7), ${missingHint(missing, a.branch)}` };
  }
  const failing = listed.length
    ? listed.map((x) => `${x.workflowName || 'run'} (${x.conclusion || 'none'})`).join(', ')
    : `conclusion=${run.conclusion || 'none'}`;
  return { ok: false, verdict: 'red', selfClearing: false,
    detail: `${at} finished red — failing: ${failing}. A branch lands only on its own green (C7.contract.03): ` +
      'red:infra → re-run once; red:finding → send it back (code-ship B1a)' };
}

module.exports = { staleBaseVerdict, branchHeadCiVerdict, githubBranchHeadRedVerdict };
