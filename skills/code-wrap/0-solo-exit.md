# code-wrap · Did this session open with `colab solo`?

Reference for [`code-wrap`](SKILL.md) the solo exit. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### Did this session open with `colab solo`? Its exit is different, not thinner

Solo flow (CONVENTIONS.md, *Solo flow*) made no worktree and holds no claim, so there is
nothing here — or in `code-ship` — for either skill to harvest or tear down. This is not
`ceremony: light` again, it is a genuinely different shape, and running the sections
below against it produces confusing no-ops.

> **Holding a claim with no worktree? Then this is a trunk-direct *unit*, not a solo
> session (#302).** Committing straight to trunk against an issue you claimed with
> `colab claim <N> --session <id>` still owes that issue its close. Run Phase A as usual
> (A1's distill comment is the evidence), then close it with
> `colab ship --direct --session <id>` — `code-ship`'s evidence-close door for a unit with
> no branch. Only a session with no claim at all takes the solo exit below.

The solo exit is its own, short path:

1. **Run the quality gate anyway** (A3), hermetic second run included — solo flow relaxes
   ceremony, never the gate.
2. **Distill onto an Issue only if a decision emerged** this sitting (A1's spirit,
   not its letter) — solo flow's whole premise is that the commit *is* the memory
   when nothing needs to outlive the session; do not manufacture a narration Issue
   for the sake of having one.
3. **Verify clean and pushed, then release the lock:**
   ```sh
   colab solo --done
   ```
   `--done` re-derives both facts itself (tree clean, fully pushed to
   `origin/<trunk>`) and refuses if either is false — it is the check, not a
   formality that trusts you. A refusal means finish the commit/push first; it is
   not a signal to fall back into the worktree-shaped steps below.
4. **Nothing else runs, and `code-ship` never runs at all.** No B0 sync, no B1 CI
   gate beyond what already ran on trunk post-push, no B2 squash (there is no branch
   to squash), no B2c/B2d/B3/B4. The release ritual (`code-ship` B5 — whichever
   shape `exposure` gives it) is a separate question that solo flow does not settle
   either way — solo flow is gated on session attendance (human-asserted, never
   automated) plus the repo not declaring `writes: isolated` (⚖ #233, CONVENTIONS.md, *Writes* / *Solo
   flow*), neither of which is coupled to `production`, so a live repo may run solo
   flow.

If you are unsure whether this session is a solo session, **`writes:` in
`.github/project.yml` no longer answers this** (⚖ #233 — the field is a veto on ANY
session, including yours; it says nothing about whether YOUR session specifically opened
through solo flow). The reliable signal is `colab solo`'s own lock, not the descriptor:
```sh
colab place check <repo-abs-path>    # exit 0 = free or held by you; exit 1 = held by a live other
```
or check `colab claims`/`colab worktrees` for a row naming your branch — if one exists,
this was NOT a solo session (solo flow makes neither). If genuinely unsure, treat it as
the ordinary worktree flow below; the ordinary steps degrade safely (they just find
nothing to do), where the solo path degrades unsafely if run against a session that DOES
hold a claim or worktree.
