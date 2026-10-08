# code-triage · §6 Flag hard groups with `needs-plan`

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


Some READY (or soft-ready) groups are cheap to describe but hard to build: an ambiguous
ask, a design with no precedent in this repo, an issue set coupled by more than file
overlap. That judgement — *why this one is hard, seen across the whole backlog* — is the
one thing that dies with this triage session if it goes unwritten; a fresh implementing
session, working from a much narrower view, either re-derives it or misses it. This skill
does not draft the plan itself — that authoring, at triage time, produced stale artifacts
for groups that get reported startable and then sit unstarted for weeks. It leaves one
sentence behind that tells the session which starts the group to bother drafting one at
all; [`code-plan`](../code-plan/SKILL.md), run inside that session, does the drafting.

For each ready or soft-ready group you judge hard, flag its **lead issue** (the first
number in the branch name):

```sh
gh label create needs-plan --color 0052CC \
  --description "Triage judged this hard — code-start should run code-plan before coding" 2>/dev/null || true
gh issue edit <lead-issue> --add-label needs-plan
gh issue comment <lead-issue> --body "needs-plan: <one-line reason — the thing a
session working only this issue would not see from where you are sitting>"
```

- **One sentence, not a plan.** Do not draft the plan here even when the shape seems
  obvious — `code-plan` drafts it later, against the repo as it is at coding time, seeded
  with exactly this reason line.
- **Idempotent, same as §3's group evidence (§0.2).** The label add is naturally
  idempotent; grep existing comments for `needs-plan:` before posting a second reason —
  re-post only if the reason actually changed, and say what changed.
- **Not a readiness gate.** Unlike `needs-decision` (§5), this label never blocks a group
  from being reported ready. It only tells the session that starts it to plan before
  coding — the group is still startable now.
- **Most groups get nothing.** The label is for the minority genuinely judged hard. A
  `needs-plan` applied by default, on the theory that a plan can never hurt, is the same
  signal as `needs-plan` on nothing at all — it stops meaning anything a session can act on.
