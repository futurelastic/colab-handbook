# Author — plan, implement, repair, hand off

You write the change. You leave three things: a **plan** before the code, **commits** on a
branch cut from trunk, and a **report** the reviewer can grade without asking you anything.

## Before you plan

- **Read the issue, not the codebase.** The issue is the memory: goal, decisions, gotchas,
  earlier sessions. Search closed issues too — a shipped feature's issue is closed, and a
  duplicate buries everything learned on it.
- **Open is not undone.** Check the code for what the issue describes. Already shipped: close
  it with evidence. Partly shipped: narrow the task to what is missing.
- **One session's work?** If not, it is a parent with children, not a checklist.
- **Clean label, clean ground?** Not proof. Look for an existing branch or worktree on the
  issue — and on every member of its group — and for unlanded branches holding the files you
  will edit. Found one: continue it or ask; never a second branch on the same issue.
- **The base is trunk,** unless the work belongs to a line the repo declares. Decide it now: the
  base is also where the change lands.

## Plan

Pick the rung ([Planning](../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94)):

- **0** — trivial, the oracle is self-evident. Write nothing.
- **1** — the default. Four lines.
- **2** — the issue is flagged hard, or the work turns out to be: ambiguous scope, a design
  with no precedent here, a chain of steps long enough to lose. Draft it fully, by a separate
  planner if you have one.

**Cannot write the oracle line?** That is the ask firing, not a blank to fill. Stop and put the
question on the issue as options, one marked recommended
([Decision options](../CONVENTIONS.md#decision-options--what-a-ruling-chooses-between-126)).
**Part of the acceptance only a person can run** (a real device, a real account, a look by eye)?
That is a *Human verify* row, never a reason to park
([Human verify](../CONVENTIONS.md#human-verify--a-person-only-check-closes-the-issue-and-becomes-one-row-491)).

### Leaves: the plan

Outside any worktree, never committed. A rung-2 plan:

```md
---
issue: <N>
rung: 2
cause: flagged | self-escalated
drafted-by: helper — <which> | self
drafted-at: <unix seconds>
---
## Intent       one or two sentences
## Approach     what changes where, in what order, and why this shape over the alternative
## Files        every path in backticks — a diff far outside this list is a signal
## Risks        what would have to be true for this to be the wrong approach
## Acceptance oracle   precise enough that a reviewer reaches a verdict from it alone
## Stop condition      the oracle green — not polish beyond it
```

Rung 1 is the first four of those as single lines: `Intent:` `Files:` `Oracle:` `Stop:`.

- **Reuse before re-drafting.** If nothing the plan names was committed since `drafted-at`, the
  plan stands; amend it in place with an `amended:` line. A re-draft states what changed and
  revises the old plan — it does not start over.
- **Deviate in writing.** The code may overrule the plan. Append the deviation and why; the
  reviewer grades against the plan *and* your notes.

## Implement

- Work in your own checkout of the branch; the shared one stays on trunk.
- Run the tests for what you changed. The full suite runs once, where the verdict is read.
- **Gate green against the oracle = done.** Anything further is a new unit of work.
- A rule you found wrong in a document *this change makes stale* is yours to fix on the branch.
  A new rule you thought of is a new issue.

## Repair

A verdict sent the change back. Read only what it names.

- **Fix what was cited**, at the `file:line` given, by the route given. A route that needs new
  authority (a ruling, a grant, a scope change) is not yours to take — put the question on the
  issue.
- **Red CI on your branch:** `red:infra` is data about the runner — report it, do not debug it.
  `red:finding` is yours only if this branch caused it; an unrelated one is a finding to report
  ([Branch CI](../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314)).
- **Never loosen a test to go green.**

## Hand off

Distill first: what was decided and why, the gotchas, the dead ends — onto the issue, since the
plan file dies at landing. Not the diff; the diff is in git. Knowledge only the reader of one
line needs goes in a comment at that line.

### Leaves: the report

One per head. Posted last for that head; a new push means a new report, never a "still green"
footnote.

```md
Hand-off — <branch> @ <full head sha>
Done:     <what the oracle checks, and that it passes>
Decided:  <choice — why — the alternative declined>
Open:     <what is left, each with: Blocked: <what> — <who clears it> | Remainder: #M>
Gate:     <the repo's gate> → <pass | fail> · branch CI <sha7>: <green | none:<kind> | red:infra | red:finding>
Human verify: <row added | none>
Plan:     <path present | rung 0 because <reason>>
Claims:   <issues still held>
```

- A box you cannot tick is reported missing, never forced true.
- **Unfinished claimed work is not a hand-off.** "The rest is follow-up" is not a blocker; a
  named outside blocker is.
- Follow-ups a person asked for in the session are theirs; ones you raised yourself say so and
  say what you ask for ([Ask](../CONVENTIONS.md#ask--the-filer-declares-the-ask-class-89)).

## Never

- Land the change, open a change request on your own initiative, or touch trunk. Starting a
  session is not an approval to land it.
- Set a human-attendance flag by inference — only on a person's words in this session.
- Release, promote or tag. Ever.
