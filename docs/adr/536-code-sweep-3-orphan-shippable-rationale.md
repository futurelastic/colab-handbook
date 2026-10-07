# code-sweep 3-orphan-shippable: why, with the measurements

Moved from [`skills/code-sweep/3-orphan-shippable.md`](../../skills/code-sweep/3-orphan-shippable.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The failure the bucket closes

**The failure it closes.** A session wrapped under a place-claim on the main checkout: gate
run, commit, push, distill comment ending *"ready for `code-ship`"*. Both of its claim
comments recorded no worktree. Then nothing happened for about eight hours, until a human
asked about it directly. `colab ship` passed every precondition on the first try, so the
branch was never faulty. Nothing was red anywhere: the claim was held, the issue open, the
session card idle and healthy, trunk CI green. The sweep enumerated the claim and sorted it
into nothing, because every other bucket starts from a worktree (`wrap`, `teardown-only`),
needs the work already shipped (`claim-only`) or needs the issues closed (`spent-remote`).
`place-claim` was no help either: its action is right for a *live* holder and leaves a
*finished* one unshipped and unreported. The same shape, claims with no worktree, sat on five
issues of another adopting repo that day.

## What the pre-#517 filter did to the walk-through

Before this filter, the 12:00 run read the `↩️` comment as the hand-off and shipped the
   branch the 10:00 run had just sent back.
