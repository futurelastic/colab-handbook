# Readiness and dependency edges: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Readiness — open and unclaimed is not enough*](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## A blocked_by edge is a dependency, not a queue position

GitHub has one edge type, so an order-only edge looks exactly like
a dependency to every reader. Readiness then holds B until A lands, and B inherits any
wait parked on A even though it needs nothing from A. Nobody catches that inheritance
when A parks. It is the hostage effect *Epics* (below) names for a shared claim, reached
through a chain of edges instead. Measured in one adopting repo: a ruling to "start all,
in queue order" was written as a 10-node `blocked_by` chain. About 13 h later one mid-chain
node was parked on an outside party. A map comment called one section "unaffected and
still moving". Yet four issues in that section, two design issues and the two UI issues
behind them, reached the parked node only through queue edges. They inherit its outside
wait as soon as the node before it lands. Nobody re-threaded the chain.

## Queue order is a ranking

Rejected: an order-only edge that has to be re-threaded whenever a node
parks. That re-threading is a manual step with no trigger, and the measured chain above
is what happens when nobody does it.

## File contention is never an edge

It is stated separately because it was the
commonest wrong edge in a measured backlog review. One adopting repo linked six design
issues `blocked_by` one after another only to serialize edits to one shared docs index.
One merge conflict became six serial review cycles.

## Split an issue at the external-wait line

Measured: one issue bundled a surface the repo owned, whose
design had already shipped, with a mode that needed an outside party's API. Blocking the
whole issue held back the only buildable UI path and the two issues built on top of it.

## The two halves do not share an API

Measured: `issue_id=34` silently attached a blocker
from a stranger's unrelated repo.

## Readiness is not a boolean

An open blocker used to end the question. That hides two different situations: nobody
has started it, versus its code is written and pushed, waiting only on a merge.

## An active session is not evidence

Measured: a session open ten minutes was already dead, having never claimed its
issue.
