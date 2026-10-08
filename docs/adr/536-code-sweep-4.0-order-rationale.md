# code-sweep 4.0-order: why, with the measurements

Moved from [`skills/code-sweep/4.0-order.md`](../../skills/code-sweep/4.0-order.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why one at a time is not first-come-first-served, measured

Measured across 179 ship-pass cycles in
13 repositories over 72 h: finished work usually waited far longer than the 5–45 min the
ship itself took, and the causes were ordering, not review. A coordinator stayed in one turn
for 1 h 40 min hand-polling CI for three branches while two others were green and
merge-clean; four same-file pairs sat 35–143 min each waiting for a human to pick an order
nobody picked; 3 of 8 "candidates" in one repository were already on trunk.

## Why same-file siblings are never a human gate

The pairs measured above cleared the moment their sibling
landed, which is the whole case for not asking.
