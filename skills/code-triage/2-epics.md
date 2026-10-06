# code-triage · §2 Containers, epic findings and release tracking issues

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**A container, not a task** — cheapest pass of the three, so run it first:

```sh
gh issue list --state open --label epic --json number -q '.[].number'
```

An `epic`-labelled issue is informative, never a start candidate (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate),
*Epics*) — leave it off the ranked list entirely, the same way a taken issue is left off,
but for a different reason: it is not that someone else holds it, it is that there is no
code to write for it directly. Still report it, in its own bucket, so it does not read as
silently dropped — see §6.

**An epic carrying `needs-decision`, or a `decision:options` block, is a finding (#361,
`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122),
*Decision gate*).** An epic never starts, so the gate on it holds nothing, and a decision
inbox built on start gates may never show the question:

```sh
gh issue list --state open --label epic --limit 200 --json number,labels,comments \
  -q '.[] | select(([.labels[].name]|index("needs-decision")) or
                   ([.comments[].body]|any(test("<!-- decision:options")))) | .number'
```

Report each one in the epic bucket as a finding, and name where the question moves: its
own issue carrying `needs-decision` (and the options block, if any), attached to the epic
as a sub-issue, with a `blocked_by` edge from any child it holds back. Triage files
neither the issue nor the edge for this, because the question is not triage's to restate.

**Two more epic findings, from the same list (#371, `CONVENTIONS.md` [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate), *Epics*):**

```sh
gh issue list --state open --label epic --limit 200 --json number,labels,subIssuesSummary \
  -q '.[] | [.number, ([.labels[].name|select(startswith("delivery:"))]|join(",")),
             .subIssuesSummary.total, .subIssuesSummary.completed] | @tsv'
```

- **A `delivery:*` label on an epic.** A container has no deliverable of its own, so the
  label invites a scheduler to treat it as code work. Report it:
  `finding: #N is a container carrying delivery:code — remove the label (#371)`.
- **An open epic whose native sub-issues are all closed** (`total > 0`, `completed ==
  total`). `colab ship` closes these when the last child ships (`code-ship` B2c), so one
  still open closed its last child by some other route, or failed one of the close
  conditions. Report it in the epic bucket with the reason from
  `tools/lib/container-close.js` (an unticked item in its body, or a close that never
  ran):
  `finding: #N has all K sub-issues closed and is still open (<reason>) — code-sweep §5 closes it`.
  Triage does not close it. Closing an issue is not one of its writes.

**A release tracking issue is a record, not a task** — the same treatment. An issue whose body
opens with `<!-- colab:release version=vX.Y.Z -->` (title `release: vX.Y.Z`) is the version's
record, opened and closed by `colab release finalize` (#339) and walked by the `release-rung`
skill; it is never ranked, grouped, claimed or started. Its `blocked_by` edges are regressions
against a candidate, not ordering between units of work. Report it in the epic bucket.
