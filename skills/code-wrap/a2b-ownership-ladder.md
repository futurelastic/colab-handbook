# code-wrap · A2b Committed strays and the ownership ladder

Reference for [`code-wrap`](SKILL.md) A2b. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**Two measurements, because a stray write has two fates and only one of them is
dirty.** `status` finds the write that is still uncommitted. It is silent about the one
that got *committed* onto the trunk checkout — a clean tree, a clean `status`, and a
commit on trunk that no branch carries and nothing will ever publish (#322: the
measured case was a docs/gotcha distill, committed on trunk while wrapping). The second
command is the only thing in this flow that sees it, and seeing it HERE — in the
session that made it, while the branch is still open — is the cheap moment. Left
standing, it surfaces later as somebody else's `colab ship` refusing on a precondition
they did not cause.

Non-empty second command → those commits are yours to move, not to publish:

```sh
git -C <repo-root> branch <type>/<slug>-<issue> <trunk>   # keep them, on a branch
git -C <repo-root> reset --hard origin/<trunk>            # return the checkout to at-rest
```

Then ship that branch through the ordinary flow, or — if the content belongs to *this*
session's work, which is the usual case — cherry-pick it into this worktree instead and
let A4 commit it here. **Never reach for the push guard's environment variable**; that
is the door #322 exists to close, and no message in this flow will offer it to you.

Clean → skip to A3. Dirty → **git is authoritative about *whether* the root is dirty
and silent about *whose* the dirt is.** Do not default to either answer; work the
ladder, strongest signal first:

1. **Branch overlap.** Did your branch touch this path?
   `git -C <worktree> diff --name-only <base>...HEAD -- <path>`. Non-empty is close
   to decisive, and it is exactly the observed shape: a docs file edited on both
   sides, the paragraph present on trunk and missing from the worktree's own copy.
2. **Content.** Read the diff (`git -C <repo-root> diff -- <path>`) for a tracked
   file, or the file itself for an untracked one. Recognisable as this session's own
   prose or edit → it's yours, whatever the branch overlap said — this is the only
   signal that catches a stray write to a path your branch never otherwise touches.
3. **Timing.** Was the root already dirty when this session opened? Check `$PLAN`'s
   `Trunk-dirty-at-start` line (code-start step 4) if one exists, or compare the
   file's mtime against this worktree's `created` timestamp (`colab worktrees`).
4. **Company.** `colab worktrees` / `colab claims` — is any *other* session live in
   this repo right now? None → "someone else's live work" has no candidate owner.

One of three verdicts, never a fourth:

- **Mine (or plausibly mine)** — recover it, don't discard it. Capture and replay a
  patch, never a stash (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)):
  ```sh
  git -C <repo-root> diff -- <path> > /tmp/misplaced.patch   # or read an untracked file directly
  git -C <repo-root> checkout -- <path>     # only this path — never a whole-tree `checkout -- .`
  git -C <worktree> apply /tmp/misplaced.patch
  ```
  Re-run A3's gate after — it needs the complete tree, not one missing the file you
  are about to commit. **This is a recovery, not "cleaning someone else's work"** —
  the never-clean rule below is about the other two verdicts, not this one.
- **Conclusively not mine** (branch never touched it, content is unrelated, predates
  this session, another live session is the plausible owner) — **report it, never
  clean it**, exactly as before, but now say who the plausible owner is (from
  `colab worktrees`) instead of only "the root is dirty."
- **Can't tell** — leave it, and say precisely what you checked in the report.
  Neither commit past it nor delete it.

**Why `-uall` here, and tracked-only at `colab ship`:** an untracked file written by
a relative path is invisible to `colab ship`'s dirty-trunk gate forever — it stays
tracked-only by design (#86, regression-guarded, do not "fix" that). A2b is the only
point in the whole flow that class is ever caught, so it deliberately reads wider.
Two things that widens the net to catch, read correctly: a whole *directory* showing
up under `-uall` is an unregistered worktree, not an edit — check `git worktree list`
before reacting, the #273 lesson still applies. And `$PLAN`
(`.plans/issue-$N.md`, legacy `.claude/plans/issue-$N.md`) or a brief under `.briefs/`
showing up here is expected when this session wrote one — `colab worktree new` and
code-start best-effort exclude the scratch dirs via `.git/info/exclude`, but that is
machine-local, not a guarantee every adopter's `.gitignore` repeats it (#488).

### Verify complete — the dirty re-check

Moved here verbatim from the core's *Verify complete* list (#586, size budget).

- **Ask git, scoped to the repo root, whether it is *dirty* — again** —
  `git -C <repo-root> status --porcelain -uall`, nothing else. Never infer from a path
  prefix or a directory walk: `colab worktree new` nests every worktree inside the main
  checkout, at `<repo-root>/.worktrees/<name>`, so a live worktree's absolute path
  always carries the main checkout's path as a prefix, and a plain listing there reads
  as "the main checkout is dirty" when it is not — git already excludes registered
  worktrees from the parent's status (`CONVENTIONS.md`
  [§4](../../CONVENTIONS.md#4-branches-and-commits)). This is A2b's ladder re-run, not a
  fresh judgement call: clean, or dirty with exactly the not-mine set A2b already worked
  through and reported. **Git only ever answers whether the root is dirty, never whose
  the dirt is** — a hit here that A2b never saw means something after A2b (most often
  A4's own commit) introduced new dirt on trunk; go back to A2b rather than assuming
  ownership either way.
