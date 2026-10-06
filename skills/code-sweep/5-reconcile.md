# code-sweep · §5 Reconcile the tracker

Reference for [`code-sweep`](SKILL.md) §5. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## 5. Reconcile the tracker

⚠️ **Scoped run? Read §1.1 first.** This whole section is repo-wide, and the `doctor
--prune` below is machine-wide. Restrict it to the selected issues, skip the prune, and say
so — reconciliation nobody asked for is the one way scoping can do harm rather than less.

Worktrees are only half of it. Also:

- **Open issues whose code shipped** → close with evidence (trunk sha + `file:line`).
  Verify by grepping the code for what the issue describes, not by trusting a commit
  message that mentions its number.
- **Closed issues still holding a claim** → release. Closing and releasing are
  separate acts and only one is automatic.
- **Claims whose worktree is gone** → `colab doctor --prune` reports and removes them.
- **The repo declares `owner:`** (a repo the fleet does not own, #394) → run
  `colab deliver --dry` once and put its state line in the report: `waiting-on-owner` (a
  PR is open, nothing to do), `ready` (work landed since the last delivery — a human runs
  `colab deliver`), `rejected` (the owner closed the last PR unmerged — a human
  reads why) or `nothing-to-deliver`. Report only: the sweep never opens, edits or merges
  that PR, and never touches the owner's branch. Delivered work is read from PR state, so a
  squash-merged delivery does not make trunk look undelivered
  (`CONVENTIONS.md` [§9, *Working in a repo you don't own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own)).
- **Epic checklist lines that contradict reality** → fix the line, and say why you did.
  This is the cheapest possible place to catch them: the sweep has already read every
  issue's true state, so this compares what is already in hand and scans nothing new.

  Only **hand-written** checklists — an epic using native sub-issues is maintained by
  GitHub and needs nothing (`gh issue view <epic> --json subIssuesSummary`). The three
  forms seen in the wild, all in one repo on one day:

  | line says | reality | fix |
  |---|---|---|
  | "in progress, branch `x`" | branch gone, issue closed, code on trunk | tick it, cite the trunk sha |
  | ticked, noted "held open for review" | issue already closed | drop the stale note |
  | unticked | issue closed with evidence | tick it, cite the sha |

  The first form is the expensive one: it is how a session gets spent rediscovering
  work that already shipped — the failure measured at 4 of 9 sessions in a day in
  `code-triage`'s opening principle. The epic is the source triage is *instructed* to trust, so a wrong line
  there does not merely annoy; it throws away a session.

  Same four limits as `code-ship` B2c: never close a hand-checklist epic on a full
  table, never rewrite its prose, never build a table that does not exist, never infer
  parentage from a title.
- **`needs-decision` issues whose ask is in neither shape** → report each one, naming its
  filer (#379, `CONVENTIONS.md` §5, *Design-approval ask*). A pending question with no
  `<!-- decision:options` block and no `Mockup: <url>` body line is one no decision view
  can render, so it sits in the queue unseen by the human who rules. Use `code-triage`
  §5's one-read `gh issue list --label needs-decision` query. Report only. Never add the
  line or the block, never remove the label, and never record anything: the question is
  the filer's to state and the ruling is a human's.
- **Open containers whose native sub-issues are all closed** → close each one with
  evidence, by the same rule `colab ship` applies at merge (#371, `code-ship` B2c,
  `tools/lib/container-close.js`). The ship path only fires when the last child closes
  through a ship. A child closed by hand, by a bulk close, or before #371 leaves its
  container open, and this sweep catches it:

  ```sh
  gh issue list --state open --label epic --limit 200 \
    --json number,body,subIssuesSummary \
    -q '.[] | select(.subIssuesSummary.total > 0 and .subIssuesSummary.completed == .subIssuesSummary.total)
            | select((.body // "") | test("(?m)^\\s*[-*]\\s*\\[ \\]") | not)
            | select((.body // "") | test("^\\s*<!--\\s*colab:release") | not) | .number'
  ```

  The `(?m)` is load-bearing: gh's built-in jq anchors a bare `^` to the start of the
  body only, so without it an unticked item further down slips through. (Measured on this
  repo: an epic with 9 of 9 sub-issues closed and 9 unticked plan lines passed the filter
  without the flag.) Each number printed gets a comment naming the evidence (all K sub-issues closed, the
  last one and when), posted and closed in one step: `colab close <P> --comment "<that evidence>"`
  (#381 — a bare `gh issue close` would leave any claim on it and tell no observer). An epic that fails only
  the unticked-item check is reported with the unticked lines, never closed. The same
  goes for a parent with all sub-issues closed but no `epic` label. A `delivery:*` label
  on any container is reported too (a container has no deliverable). Remove it only if
  the sweep was asked to reconcile labels.
