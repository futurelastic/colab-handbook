# code-sweep · §3 buckets `unrecorded` and `unlinked`, and the teardown commands

Reference for [`code-sweep`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### `unrecorded` — a worktree colab never held a claim for

This bucket exists because #67 measured the alternative: an unrecorded worktree used to have
nowhere to go, so it went nowhere — invisible to enumeration, absent from every bucket, and the
completeness check agreed there was nothing to check. It is deliberately **not** folded into
`blocked`: `blocked` means "known work, human judgement needed"; this means "colab has no record
to act on at all" — a different reason to stop, worth naming as such.

**Never run `code-wrap` or `code-ship` on one.** Every phase of either assumes a claimed
issue and a recorded worktree — `code-ship`'s B1b harvest reads the claim registry, its B3
releases claims, its B4 tears down a worktree `colab` knows about. None of that exists
here, so a full wrap+ship does not degrade gracefully; it errors, or worse, silently does
nothing where you expected it to act.

Read the verdict `colab worktrees` already computed (§1.2) and act by hand:

- **`landed vs <trunk>`** → the content shipped by some other route (a prior session's
  interrupted wrap, or a #62-style husk). Confirm with `colab landed --repo <repo> --branch
  <branch>`, then `git worktree remove <path>` (`--force` if git objects, not tracked files,
  uncommitted) and `git branch -D <branch>`. This is *not* the same raw-fallback gap as
  `code-ship`'s B4: `unrecorded` means colab never held a `state.json` entry for this
  worktree at all, so there is no registry record for the raw command to strand — that is
  what "no claim to release, no ports to free" means here. It does **not** mean the
  branch's issue(s) are clean: a claim can have been set by hand (`gh issue edit … --add-label
  in-progress`) outside colab's tracking entirely. Check the branch's issue number(s) for
  a stale `in-progress` label and release it (`gh issue edit <N> --remove-label
  in-progress`) before you move on — nothing else here will.
- **`cargo` / `unknown vs <trunk>`** → genuine unmerged content with no claim behind it. Do
  **not** guess ownership from the branch name alone. Check whether the branch's issue numbers
  belong to *this* repo's tracker (`gh issue view <N>` — 404 or a title that makes no sense means
  they don't) or, per #67's own case, to a **different** repo's tracker entirely — that shape has
  no issue here to harvest, close, or post evidence on, so `code-ship`'s `Closes #N` step has
  nothing to close even if you ran it. Report it and leave it; claiming it into this repo would be
  inventing an issue number that was never this repo's to begin with.
- **`detached HEAD`** or **`IS <trunk> — should not be a linked worktree`** → structurally odd
  regardless of content; report, do not guess intent.

**What bucket "cargo with no claimable issue in this repo" belongs in past this first report is
still an open convention question (#67's point 3) — this section covers the mechanical minimum
(don't lose it, don't silently wrap it, don't misattribute it), not the eventual policy for
routing it. If you find yourself resolving the same shape repeatedly, that is a signal the
convention decision is overdue, not a cue to improvise one per sweep.**

### `unlinked` — cargo whose issue numbers are nobody's here

**`unlinked` is its own bucket, not a subset of `ship` (#92).** `colab worktrees`
enumerates by worktree, not by issue, so a branch with real unlanded commits and no
issue attached still surfaces at §1 — it is not invisible. But wrapping it the normal
way is the wrong action even though `landed` reports `cargo`: `--issues` is empty,
so the squash carries no `Closes #N`, B2c's evidence-posting step has nothing to post
to, and the branch content can be *better* than whatever DID ship (a genuine measured
case: a one-line fix stranded this way outclassed the fix that landed through a
different door — the residue is not clutter). Do not silently fold this case into
`ship` on the theory that "cargo → ship" always holds; the theory holds only when a
`Closes #N` is possible. Do not silently drop it either — an un-named residue class is
how a better patch sits unreachable indefinitely while a worse one ships.

Report it and stop there. Two reasonable next steps exist and this skill does not
choose between them: file (or reopen) an issue for the branch so it becomes an
ordinary `ship` or `send-back` candidate next sweep, or leave it named so a human decides. Never
open the issue automatically — that is a judgement call about what the branch is
*for*, which this skill has no way to make from git state alone.

```sh
colab worktree rm <name>       # releases its claims and frees its ports
git branch -D <branch>         # -D: squash left no merge relation
```

A sweep is exactly when a session's dev server is still running, so expect
`worktree rm` to refuse with a list of processes the worktree owns. Stop them and
re-run, or `--force` to have it terminate them — it kills only what the worktree
owns by cwd. Do **not** reclassify such a candidate as `blocked`: it is a live
process, not unfinished work.
