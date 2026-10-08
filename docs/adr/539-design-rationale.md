# Design conclusions and design exploration: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Design conclusions are three units, not two* and *Design exploration files its Issue first*](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why superseded artifacts are marked

**Superseded artifacts are marked, never deleted** — trunk carries the design lineage.

## Why a missing artifact never blocks

**A missing artifact never blocks a small change.** Unit 2 lands on the branch that
builds the surface (`code-wrap` A2), so it is normally absent before that branch exists.

## Why the Issue is filed before the first mockup

**The Issue number must exist before the first mockup is drawn**, not retrofitted once
one is approved — filing is cheaper than a single mockup iteration, and it is what makes
`<slug>-<N>-mockup.html` naming possible at all.

## Why the design issue is never the epic

The design issue is never itself turned into the epic: an epic is never a start candidate,
so its artifact would have no session to land it.
