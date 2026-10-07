# Holds and parks: why, with the measurements

Moved from [`CONVENTIONS.md` §5, *Disposition — a park must name its wake condition and Holds*](../../CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why an unbounded defer is a silent `wontfix`

An unbounded park is a silent `wontfix`.

## Why `review-by:<date>` is created on demand

the date varies per issue, so there is no fixed set to provision up front.

## Why the disposition vocabulary lands before its writers

emitting the label before something renders it distinctly produces a park that is machine-readable and unread, which is worse than the silent park it replaces.

## Why the three consumer holds are not adopted

Each one names a fact this section already has a carrier for, and a second name for the same fact is the two-carrier problem #279 measured with `deps-checked`:

## Why a repo keeps its own hold names

because its scheduler depends on them.

## Why every hold is in the `holds:` list

If a scheduler honours a hold that is not in the list, it and triage disagree without saying so, which is the failure the list exists to prevent.

## Why a wake that waits on nothing is a finding when written

A park waiting on nothing is the silent `wontfix` again, with a date attached.

## Why triage reads the newest ruling or `Hold:` line

because a later ruling may have tightened the condition,

