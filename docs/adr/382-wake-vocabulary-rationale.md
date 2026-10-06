# A wake a scheduler can check: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *The `wake:` vocabulary — a wake a scheduler can check (#382)*](../../CONVENTIONS.md#the-wake-vocabulary--a-wake-a-scheduler-can-check-382) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why wake needed a checkable vocabulary

Until #382, `wake:` was one of three forms, and anything else could only be written as
prose in `Because:`, backed by a `review-by:` date: "until the fix is deployed", "when that
capability lands". Nobody reads that prose before the date. Measured across adopting
repos, 2026-09-25 → 26:

- A deferred issue waited on another repo's issue number **that did not exist**. The real
  fix had landed and been deployed the day before, and the park would have slept another
  13 days.
- A deferred issue's condition was met by a commit in the same repo. The issue sat about
  7 more hours.
- A deferred issue's measurement condition had been true for 4 days.
- A manual hold's stated preconditions were all met, and it stayed held until someone
  asked.


Each hold was right when it was set. What failed was **release**: the condition came true
and nothing noticed, because the only machine-readable part was the date.

## One spelling, not two

That
scheduler also accepts two kinds about a live session (a claim released, a session gone).
Those describe a session, not a tracker fact that a hold on an issue can wait on, so the
handbook does not adopt them.
