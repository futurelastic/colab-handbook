# code-wrap · Hand off — a missing plan file

Reference for [`code-wrap`](SKILL.md) Hand off. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### A missing plan file — say so, never report "hand-off complete" over it (#486)

`code-start` writes the plan stub **before** the claim (rung 1 is the default —
`CONVENTIONS.md` [§5](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94),
*Planning*), so at wrap the file either exists or a decision not to write one was made.
Check it here, mechanically:

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
case "${COLAB_PLANS_DIR:-.plans}" in /*) PLANS_DIR="$COLAB_PLANS_DIR" ;; *) PLANS_DIR="$MAIN_REPO/${COLAB_PLANS_DIR:-.plans}" ;; esac
for n in <every carried issue>; do
  # configured dir first, then the legacy .claude/plans/ (#488 transition)
  { test -f "$PLANS_DIR/issue-$n.md" || test -f "$MAIN_REPO/.claude/plans/issue-$n.md"; } \
    && echo "#$n plan present" || echo "#$n NO PLAN"
done
```

A group branch may share one file, named for any member — one present file covers the group.

- **Present** → tick the box.
- **Absent, and the work really was rung 0** (trivial/mechanical, the oracle
  self-evident from the Issue) → write `rung 0 because <one line>` in the box's place.
  The reason is the evidence: "single-line typo fix, oracle = the typo is gone" is one;
  "forgot" or "small change" is not.
- **Absent, and the work was not rung 0** — anything touching more than one file with
  judgement in it, a grouped branch, a rule or skill change — is **not hand-off
  complete**. Say exactly that in the report: `plan file missing — rung <1|2> work
  wrapped without one`, and let `code-ship` grade against the Issue's stated ask instead.
  Do not back-fill a plan now to make the box pass: a plan written after the code
  describes the code, so it cannot catch anything the plan was there to catch.

Why: [ADR 536](../../docs/adr/536-code-wrap-handoff-missing-plan-rationale.md).
