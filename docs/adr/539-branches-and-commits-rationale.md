# Branches and commits: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §4, *Branches and commits*](../../CONVENTIONS.md#4-branches-and-commits) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Branch names: the prefix shapes

The shapes cannot be confused — the slug has no `/`, so four
segments can only be the prefixed shape.

## Branch names: why no `Machine:` trailer on a public repository

The label is a hostname, and a commit message cannot be
edited once it is pushed. On a public repository the trailer would publish an internal hostname
permanently, once per ship.

## Groups and chains

Mixing them
produces a branch carrying work that is not ready, or a sequence nothing enforces.

## Base and merge target

A branch cut from a line and merged into trunk
carries the entire line in with it, inside one squash commit that reads like a small
change.

## The main checkout stays on trunk

Measured: a session branched a repo's main
checkout for a chore; that repo ran always-on from the tree, so the live app served
unmerged feature-branch code until a human noticed by eye.

## `git stash` is repo-scoped

Measured: on a repo running 10+ concurrent worktree sessions,
one session's `git stash pop` restored a *different* session's uncommitted changes, with
a third, unrelated, much older stash sitting in the same shared stack the whole time.

## A nested worktree's path

Measured: a wrapping session reported the shared
main checkout dirty with two files it did not own, and named another session's issue as
the cause — the files were inside `.worktrees/<other-session>/`, on that session's own
branch, doing exactly the right thing (#273). That was a **false positive about
dirtiness itself** — the check asked the wrong question (a path prefix, not git) — and
the fix above, *ask git scoped to the repo root*, stands on its own and is not touched
by what follows.

## Git answers whether, never whose

A session's process cwd is the
main checkout, not any worktree it later creates (code-start §4 creates the worktree
after the cwd is already fixed), so a tool call made with a relative path anywhere in
that session lands on trunk with no error — most often a docs edit made after the code
itself already landed correctly in the worktree (#294). Reading every dirty hit here as
categorically "someone else's" — the reading this section used to state outright —
assumes away exactly that failure: the session that caused it declines to even check,
ships code with no docs, and leaves the trunk checkout dirty for every other session's
merge to trip over.

The
investigation is what changed, not the rule for what to do once you've genuinely run
it.

## Squash-subject picker: `design:`

— added because an adopter had 3 genuine
`design:` commits over 400, six live `design/…` branches, and its own conventions
already named `design` a legitimate type before this repo's tooling recognised it.

## Merging: the closing keyword

Measured: 26 of 30 issues sat open with
  their code long since merged, purely because merges said `(#22)` instead of `Closes #22`.

## Merging: `Closes #N` needs the scope accounted for (#74)

Measured before
  this tightened: on one repo, ~8 weeks, 125 `Refs #N` merges against 780 `Closes #N`
  ones, and only 10 commits ever declared a remainder — the redirect was reported, but
  reported is not the same as read; a tracker showing an open issue with unticked boxes
  is indistinguishable from work nobody started.

Motivating incident: an issue closed by
  squash-merge with a third of its three-section scope unimplemented — the sections were
  prose, so nothing could have caught it.

## Merging: the gate does not file the remainder issue (#263)

A merge blocked on a missing `Remainder: #M` could in principle create
  that issue automatically; this deliberately does not, because filing on an agent's own
  judgement writes an artifact to the tracker nobody asked for, while requiring the
  human (or session) that already knows what was left out to write the one line keeps
  authorship where the judgement actually lives. The smaller change, taken on purpose.

## Merging: `--refs` and the start brake (#385)

In the measured case, the only unticked items
  were a live end-to-end proof that only a human-driven session could produce. The
  re-started implementer found nothing to do and held a concurrency slot for about an hour,
  until a human-side watch parked the issue.

## Merging: corroboration by git (#87)

Measured: a branch carrying #71 and #76 resolved to `[71, 74, 76]` because a co-tenant
  claimed #74 onto the same worktree minutes after merge authorisation, with nothing on
  the branch implementing it.

## Merging: a ship releases every claim (#319)

A claim with
  no worktree (`--branch`-keyed, or taken with neither) used to survive a successful ship
  still `in-progress`, because teardown ran only through `colab worktree rm`.

## Merging: the trunk CI check

We once merged for 12 straight hours into repos whose CI was silently dead (org
  billing lockout) — every run "failed" without starting.

`gh run list --branch <trunk> -L 1` reads whatever ran *last*, and under
  `cancel-in-progress` a cancelled straggler can outrank a passing run on the same commit.

Hand-rolled `sleep N; gh run …` loops were measured at ~88% of ~4,500 REST calls in
  one hour on a shared agent identity — two loops on one run, a loop that read rate-limit
  errors as "keep waiting", one orphaned for 5½ h — until the hourly quota ran out for every
  agent.
