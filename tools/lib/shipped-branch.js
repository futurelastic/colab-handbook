'use strict';
/**
 * What `colab ship` B3 does with the branch whose content has just landed (#17, #368).
 *
 * THE DEFAULT IS TO KEEP IT (#17) — with ONE exception, #368: a ship that closes NOTHING and
 * references at least one issue (`Refs #N` only — `--refs`, or the `tracking` label).
 *
 * Why the exception exists. A kept branch is harmless while every issue it names is closed: every
 * name-keyed reader (triage's ref enumeration, `git branch -a --list '*<n>*'`, a scheduler's
 * file-hold check) sees a closed number and moves on, and code-sweep lists it as `spent-remote`.
 * A Refs-only ship breaks both halves of that at once. Its issue STAYS OPEN by design (a tracking
 * issue, #48), so the ref reads as live work on that issue for as long as the issue lives — which,
 * for a tracking issue, is indefinitely. A squash leaves no ancestry, so nothing can tell from the
 * graph that it is spent. And the ship has just released the claim, so code-sweep's
 * orphan-candidate bucket (which needs `in-progress`) never sees it either. Measured: one such ref
 * held a file against a scheduler's start check for ~8 hours until a human deleted it by hand.
 *
 * Ship is the one moment anything knows FOR CERTAIN the ref is spent — the content was pushed to
 * the target a few lines earlier — so that is where it goes. #17's reason for keeping (deleting
 * refs from a shared remote unasked is irreversible, reporting is not) still holds for a Closes
 * ship, whose kept ref reads as spent to every reader and costs nothing but clutter. It does not
 * hold here: this ref's only remaining effect is to look live, and that effect is not harmless.
 *
 * `--keep-branch` restores the old behaviour for a Refs-only ship (e.g. a follow-up slice will be
 * cut from the same branch). `--delete-branch` still forces deletion for any ship. Passing both is
 * a contradiction the caller must resolve — see `conflictingFlags`.
 *
 * Pure: no git, no I/O. `handleShippedBranch` in tools/colab performs what this decides.
 *
 * @param {{ closeIssues?: number[], refsIssues?: number[], deleteBranch?: boolean, keepBranch?: boolean }} o
 * @returns {{ delete: boolean, reason: 'flag-delete'|'flag-keep'|'refs-only'|'default', detail: string, refs?: number[] }}
 *   `refs` is present on `refs-only` only: the still-open issues the kept ref would have named.
 */
function shippedBranchDisposition({ closeIssues = [], refsIssues = [], deleteBranch = false, keepBranch = false } = {}) {
  if (deleteBranch) return { delete: true, reason: 'flag-delete', detail: '--delete-branch' };
  const refsOnly = closeIssues.length === 0 && refsIssues.length > 0;
  if (keepBranch) {
    return { delete: false, reason: 'flag-keep', detail: refsOnly ? '--keep-branch (overrides the Refs-only delete, #368)' : '--keep-branch' };
  }
  if (refsOnly) {
    return {
      delete: true,
      reason: 'refs-only',
      refs: refsIssues.slice(),
      detail: `Refs-only ship (${refsIssues.map((n) => `#${n}`).join(', ')} stays open) — a kept ref would read as live work on an open issue (#368); --keep-branch to keep it`,
    };
  }
  return { delete: false, reason: 'default', detail: 'default; --delete-branch to remove it, or `colab doctor` to list what has accumulated' };
}

/** `--delete-branch` and `--keep-branch` together: refused, never silently resolved. */
function conflictingFlags({ deleteBranch = false, keepBranch = false } = {}) {
  return !!(deleteBranch && keepBranch);
}

module.exports = { shippedBranchDisposition, conflictingFlags };
