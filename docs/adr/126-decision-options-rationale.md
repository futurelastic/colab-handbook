# Decision options: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Decision options — what a ruling chooses between (#126)*](../../CONVENTIONS.md#decision-options--what-a-ruling-chooses-between-126) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Unstructured decision issues

Left as prose — headings, bullets, a sentence saying "my recommendation is A" — every
consumer re-derives the choices heuristically or fails to. Measured, one repo
line-by-line: 3 of 8 open decision issues carried no machine-readable options at all,
and the failure is quiet in a specific way — an unstructured decision issue **looks
like a UI defect, not a filing defect**, so nobody goes looking for the missing line.
Prose is also unsafe on its own terms: a decision issue whose body said *"my
recommendation: A"* was once implemented as A by a later session, while the actual
accepted answer sat in a separate, later comment — a recommendation and an acceptance
read identically as prose, and only a structured record on the answer side (above)
closes that gap.
