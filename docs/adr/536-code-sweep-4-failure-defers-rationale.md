# code-sweep 4-failure-defers: why, with the measurements

Moved from [`skills/code-sweep/4-failure-defers.md`](../../skills/code-sweep/4-failure-defers.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## What the old stop-on-first-failure rule cost, measured

**The `half-swept repo` the old rule guarded against is what deferral answers best.** That
rule bought its tidiness by leaving every later candidate unexamined — *"stopped at
candidate 3"* says nothing about candidates 4 through 13. A per-candidate record of what
landed and what deferred, with why, is strictly more information about the repo's state,
not less; §0.1 already requires that record to exist. Measured (#308): on one `auto-trunk`
repo a bucket grew from 5 to 13 candidates while a **single** blocked candidate held the
run for **10.5 hours** — the re-pings correctly re-tested the stop reason, found it
unchanged, and eventually stopped re-deriving at all, so anything that became shippable in
that window was invisible. It cleared in ~35 minutes of human attention, after which three
issues shipped back to back.
