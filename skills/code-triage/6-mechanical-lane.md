# code-triage · §6 Flag delegable groups with `mechanical-lane`

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


A fleet that runs a second, cheap engine for batch-mechanical work only feeds it when
someone mid-session happens to remember it exists — which trends toward zero use, the
same failure `needs-plan` exists to prevent from the opposite direction (there, a group
too hard to hand to the default engine untagged; here, a group too easy to deserve it).
Triage is the one moment the whole backlog is in view, so it is the only place these
groups can be *assembled* rather than encountered one issue at a time.

For each ready or soft-ready group, ask one question, alongside — never instead of — the
readiness verdict §5 already computed:

> **Mechanical + oracle?** — is this group's work batch-mechanical (pattern conversion
> across files, boilerplate, spec'd translations, data-file generation) **and** is there
> an existing test command — or a cheaply-written one — that adjudicates it without
> human judgment?

Both yes → tag it. Anything else — including genuine doubt about whether the oracle
actually catches a wrong answer — leave it untagged; the column's job is to force the
question to be *asked*, never to lower the bar that decides it. Untagged is the default,
same as an unflagged group defaults to the expensive lane today — this flag only ever
narrows that default, it never widens it.

```sh
gh label create mechanical-lane --color 1D76DB \
  --description "Triage judged this batch-mechanical with a usable oracle — a candidate for the cheap engine lane, not the default one" 2>/dev/null || true
gh issue edit <lead-issue> --add-label mechanical-lane
gh issue comment <lead-issue> --body "mechanical-lane: <one-line why — the pattern being
converted or generated, and the oracle command that adjudicates it>
Suggested batch size: <N> — <why that size, not one big batch>"
```

- **Idempotent, same as `needs-plan` and §3's group evidence (§0.2).** The label add is
  naturally idempotent; grep existing comments for `mechanical-lane:` before posting a
  second reason — re-post only if the pattern or the oracle actually changed.
- **Not a readiness gate.** Same posture as `needs-plan`: this label never blocks a group
  from being reported ready, and never substitutes for the §5 gate. A group carrying
  both `mechanical-lane` and `needs-plan` is a contradiction worth a second look, not a
  state to write mechanically — a group hard enough to need a drafted plan first is not
  the batch-mechanical shape this flag describes.
- **Suggest a batch size, do not dictate the invocation.** Which engine backs the lane,
  how it is invoked, and its exact batch mechanics are per-fleet and deliberately outside
  this skill's scope (`CONVENTIONS.md` has none of that either) — the suggested size is a
  number and a one-line reason, not a runbook. Smaller batches have measurably
  outperformed one large batch in at least one adopting fleet's history; default toward
  smaller when unsure.
- **Most groups get nothing.** The label is for the minority genuinely both mechanical
  and oracle-checkable. Applied by default, on the theory that tagging can never hurt, it
  stops meaning anything a downstream lane can act on — the identical failure mode
  `needs-plan` already warns against, one section up.
- **Report it too.** A ready group carrying this verdict gets one extra line in §6, the
  same way a soft-ready group carries its `note:` line — a session (or a router reading
  the report instead of a human) should not have to re-derive the verdict from the label.
- **Has a second reader now: `code-ship` B1c (#262).** A rejected diff on an issue set
  carrying this label is the one case that skill's grading step may retry once,
  automatically, instead of stopping for a human — this label is the signal it reads to
  know a rung above the one that produced the diff exists at all. Nothing here changes
  because of that; it is one more reason not to apply the label loosely.
