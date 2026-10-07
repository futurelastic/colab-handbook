# Decision gate, options, asks: wording rationale

Moved from [`CONVENTIONS.md` §5, *Decision gate — a human must answer first (#122)* and the sections after it](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Name history of the label

(named `needs-ruling` before #122; widened because "ruling" read narrower than the gate actually covers)

## Why a design-artifact approval cannot be asked at filing

The gate blocks the start, and the start is the session that produces the artifact. Labelling the issue at filing, for an approval that needs the finished artifact, blocks the only session that could produce it.

## Why an epic never carries the label

The label is a start gate, and an epic is never a start candidate (*Epics*, below), so on an epic the label gates nothing.

## Why the closure is what a human reviews

— so the closure itself is what a human reviews, after the fact

## Why the third path files its own issue

The question becomes visible where humans and triage already look — a labelled issue, not prose in a comment nobody scans — while the work stays owned so no second session picks it up mid-flight.

## Why recording the decision is what clears the gate

Measured failure (#127): a ruling was posted as ordinary prose in a comment and the `needs-decision` label removed by hand. A later triage pass, reading the issue fresh, saw no machine-readable trace of a decision, re-gated it, and reported it not-startable — the ruling had been sitting in the comment the whole time. **A cleared label is indistinguishable from a label never applied.**

## Why a second question goes through --reopen

This is the rule above seen from the other side: the label is never *removed* by hand, and for the same reason it is never *re-added* by hand. A decided issue can need a second ruling — ruling one commissions a design, and later the finished design needs approving.

## Why a decision needs two options

— a one-option decision is not a decision

## Why the Mockup line lives in the body

A reader finds it with one field and no timeline walk.

## What the once-only rule replaced

A coordinator pass (`code-triage`, a sweep, a ship session) that finds work blocked on a human ask used to render the whole question again on every pass: the question, the options, the recommendation.

## Why the date is the first ask

The point of the line is to show how long the human has been asked.
