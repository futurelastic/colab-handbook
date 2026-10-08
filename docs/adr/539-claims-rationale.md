# Claims: why, with the measurements

Moved from [`CONVENTIONS.md` §5, *Claiming work*](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the record of a claim is the remote

The git remote is the one store every machine already shares, whatever the tracker is, so it is what a claim is refused against:

## Why a claim names the machine by a canonical id

one machine spells its hostname more than one way.

the raw id is a hardware serial, and on a public repo the comment is published.

## Why the label is the mirror and not the lock

because a tracker can change or go down while the git remote is the store every machine already shares.

## Why no grade token is a variant of another

so a qualifier can never be mistaken for `pass`

## Why a tracking issue is claimed but not closed

its checklist still has open items, and closing it would bury its knowledge.

## Why `Closes #<tracking>` is never written

GitHub closes on the keyword regardless of intent, and it cannot be un-closed by another keyword.

## Why `deferred:measurement` is only for measurable waits

and a `review-by:` date on it only hides whose turn it is.

## Why the source issue stays closed

its code shipped, and the failure is new work.

