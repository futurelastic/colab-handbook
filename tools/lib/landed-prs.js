'use strict';
/**
 * #584: a pull request opened only to obtain branch CI stays open forever once `colab ship`
 * squash-lands its branch — the squash is a NEW commit, so the forge never sees the PR's head land,
 * and nothing else closes it. Measured 2026-10-10: five such PRs open on two repos, all landed, the
 * oldest 15 days old, each reading as unmerged work waiting for review.
 *
 * Pure rules only — tools/colab owns the gh calls. Two rules:
 *
 *   1. Close a PR only when its head commit LANDED: the PR head is the landed branch tip, or an
 *      ancestor of it. A PR head carrying commits the ship did NOT include (pushed to the remote
 *      branch after the local tip was cut, or from another machine) is KEPT, with a warning — closing
 *      it would hide work that is not on trunk.
 *   2. Best-effort. A failed list or close is a warning, never a failed ship: the merge already landed
 *      and is pushed, so a non-zero exit here would read as "ship failed" and invite a re-merge.
 */

/** The comment a closed PR carries — the same shape as #350's close: where it landed, and why. */
function landedPrComment({ target, sha, issues }) {
  const nums = (issues || []).map((n) => `#${n}`).join(' ');
  return `Landed on \`${target}\` as ${sha} by \`colab ship\`${nums ? ` (${nums})` : ''}. ` +
    'The branch was squash-merged, which the forge cannot see as a merge of this PR, so ship closes it (#584).';
}

/**
 * Decide and act on every open PR whose head is the landed branch.
 *
 *   prs          — the open PRs listed for the branch, as git.ghOpenPrsForBranch returns them:
 *                  { prs: [{ number, headRefOid, url }] } or { error }
 *   headLanded   — (oid) => true when that commit is in what landed (tip or ancestor); false otherwise
 *   close        — (number, comment) => { ok, stderr }
 *   comment      — the closing comment (landedPrComment)
 *   skip         — PR numbers already handled by another path (#350's approved review PR)
 *
 * Returns { closed: [n], kept: [{ number, reason }], failed: [{ number, error }], listError }.
 */
function closeLandedPrs({ prs, headLanded, close, comment, skip = [] }) {
  const out = { closed: [], kept: [], failed: [], listError: null };
  if (!prs || prs.error || !Array.isArray(prs.prs)) { out.listError = (prs && prs.error) || 'could not list open PRs'; return out; }
  const skipSet = new Set(skip.map(Number));
  for (const pr of prs.prs) {
    const number = Number(pr.number);
    if (!Number.isFinite(number) || skipSet.has(number)) continue;
    let landed = false;
    try { landed = !!(pr.headRefOid && headLanded(pr.headRefOid)); } catch (_) { landed = false; }
    if (!landed) {
      out.kept.push({ number, reason: `its head ${String(pr.headRefOid || '?').slice(0, 12)} is not in what landed` });
      continue;
    }
    let r;
    try { r = close(number, comment); } catch (e) { r = { ok: false, stderr: e.message }; }
    if (r && r.ok) out.closed.push(number);
    else out.failed.push({ number, error: ((r && r.stderr) || 'gh pr close failed').split('\n')[0] });
  }
  return out;
}

module.exports = { landedPrComment, closeLandedPrs };
