# The docs-only autonomy exception: why, with the measurement

Moved verbatim from [`CONVENTIONS.md` §2, *Autonomy — the docs-only exception*](../../CONVENTIONS.md#autonomy--the-docs-only-exception-345) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why

**Why.** Some branches carry nothing but text: path repoints, typo fixes, doc updates. Their
failure mode is a wrong sentence, not wrong behaviour. Measured: several one-line doc-path
branches sat graded-pass and merge-clean on such repos with nothing to do but wait for a click.
The only other exit was a hand push, which is exactly what the pre-push guard exists to refuse.
