# code-ship · B1c Grade the diff against the plan (#94)

Reference for [`code-ship`](SKILL.md) B1c. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B1c. Grade the diff against the plan (#94)

Read the plan file, if one exists, from the **main checkout** — `$PLANS_DIR/issue-<N>.md`
(`$MAIN_REPO/.plans/` unless `COLAB_PLANS_DIR` says otherwise), **then** the legacy
`$MAIN_REPO/.claude/plans/issue-<N>.md` for a plan written before #488 (`$MAIN_REPO` and
`$PLANS_DIR` as resolved in §0, not `$PWD` — #113) per issue in the harvested set (B1b),
not the worktree, which may be mid-teardown by the time anything reads this. A plan in
either location counts — a session graded as having no plan because it wrote the other
one is exactly the false reject this order prevents:

```sh
cat "$PLANS_DIR/issue-<N>.md" 2>/dev/null || cat "$MAIN_REPO/.claude/plans/issue-<N>.md" 2>/dev/null   # per issue that carried one
```

- **Plan file present** → grade the diff against its *Acceptance oracle* and *Files*
  sections.
- **No plan file** (rung 0, or a session that predates #94) → grade against the Issue's
  own stated ask — its `## Plan` checklist if it has one (B1b's per-item verdict already
  covers this shape), else its prose Goal.

Verdict is one of two, and it is a **judgement**, not a line-count — the same posture
B1b's per-item verdict already takes toward the checklist, applied here to the plan (or
ask) as a whole:

- **pass** — the diff satisfies the stated oracle, or the plan's own deviation note
  (`code-start`/`code-plan`, *Deviating from what you wrote*) explains why it does
  something different and that reason holds up. Proceed to B2; the verdict rides on
  B2b's evidence comment.
- **reject** — the diff does not satisfy the oracle, or drifts from the plan's Files
  list with no written reason anywhere in the plan file. **Do not merge, and do not
  proceed to B2 on this pass, whichever reject class below applies.** Post a comment on
  the issue naming specifically what falls short — not "does not match the plan," the
  actual gap, and carry a `<!-- colab:grade verdict=reject-decision round=<n> -->`,
  `verdict=reject-escalate round=<n>` or `verdict=rework round=1` marker per the
  classification below (`rework` is the direction-bearing `decision`, #406) — same
  grammar and reading rule as B2b's `pass` marker (*The grade verdict is a marker, not
  a sentence to parse*). Every claim in the harvested set stays held; this is never an
  automatic revert of the branch and never a silent merge-anyway.
