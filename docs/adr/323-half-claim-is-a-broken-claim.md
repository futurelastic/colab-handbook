# A half-claim is a broken claim: neither free nor taken

## Context

`CONVENTIONS.md` §5 defines claiming as one command that writes two halves:

```sh
gh issue edit <N> --add-assignee @me --add-label in-progress
```

It said nothing about an issue carrying only one half, and two fleet tools
filled that gap in opposite directions:

- **`code-triage`** read "taken" from the `in-progress` label and live claims
  only. An assignee without the label read as **free**.
- **The dashboard** (then `coding-dashboard`, now `futurelastic/hangar`) read an
  assignee without the label as a **real claim**. It has a deliberate test for
  this: "forgot to attach the label -> still a real claim, must not invite
  someone else in."

Measured on this repo: #297 (assignee `vo2vo`) and #301 (assignee `gin10`)
carried assignees with no label. Because a group is one unit of work, that
gated all four members of `group:ship-cmdship-internals`. Three consecutive
triage passes called the group READY while the dashboard held it claimed, and
nobody recorded the disagreement.

**The half-claims were made by the handbook itself.** The documented raw
release command was `gh issue edit <N> --remove-label in-progress`. It removed
the label and left the assignee, so every raw release produced exactly this
state. (`colab release` was already correct: `ghIssueRelease` drops both.)

## Decision

Ruling **C**, by Lucy through decisions-clear (2026-09-13):

- **A claim is both halves: the assignee and `in-progress`.** Either half
  alone is a **half-claim**. It is not a free issue and not a live claim to
  wait on. It is a broken claim with a bounded repair: the assignee either
  completes the claim (adds the label) or drops the assignment.
- **Nobody starts on a half-claim in the meantime.** `code-triage` discards
  one from the start list, reports it with its repair, and marks its group
  `blocked` on that repair.
- **`colab claim` and `colab worktree new` refuse someone else's half-claim**
  and name the half that is present. `--force` takes it over loudly, like any
  other claim.
- **Your own half-claim is completed by re-claiming, not refused.** That
  covers your own assignee without the label, and a label backed by a live
  `🔒 Claimed` comment of yours (your own interrupted claim). Without this
  exception the tool would refuse a session's retry of its own claim, a bug
  class this CLI has already fixed once.
- **Release drops both halves**, in every raw fallback: §5, §11, `CLAUDE.md`,
  and `code-ship` B3/B4.

## Alternatives rejected

- **A: an assignee alone is a claim.** Just as safe against collisions, but
  assignees are sticky. With the old label-only release, every released issue
  would have stayed blocked, and no step clears it.
- **B: the label is the only claim.** Would reverse a deliberate, tested
  dashboard behaviour, and would let a second session in while the first
  session's label write is still lagging.

C is the only option that follows from what §5 already prescribed, instead of
picking a winner between the two tools.

## Consequences

- The triage fingerprint (§0 input 2) stays blind to assignee. A pure
  half-claim that appears or gets repaired with no label or claim change is
  the one case a cache hit can miss. That limit is documented in the skill
  rather than paid for with a digest that changes on every assignee edit.
- `colab claim` used to let a foreign assignee-only issue through to the
  tie-break. It now refuses it. That is stricter, never looser.
- **Not done here:** the dashboard still reads an assignee alone as taken, in
  `futurelastic/hangar`. That is compatible with C's "nobody starts", but it
  still cannot show the half-claim as a repair finding, and its readiness
  overlay still has no state for it (#323 body). Changing it needs a
  cross-repo go-ahead.
- #325 moves the claim's record of truth onto the git remote. When it lands,
  §5 should restate the tracker pair as a mirror. Half-claim detection still
  applies to that mirror.
