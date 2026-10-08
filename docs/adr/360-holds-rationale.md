# Holds name an owner and a wake: the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Holds — every label that stops a start names its owner and its wake (#360)*](../../CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## The hold kinds that recur, measured

`deferred:*` is not the only way work gets parked. Adopting repos add hold labels of their
own, and three kinds recur: a person's "not yet", set before any session touched the
issue; "needs rescope", on an issue built on a model that has since changed; and "waiting
on the operator", for an act only a human can perform. Their schedulers refuse to start
an issue carrying one. Measured across adopting repos (2026-09-24):

- None of the three appeared anywhere in this handbook. So a triage that followed
  `code-triage` exactly reported those issues ready, and the scheduler refused them.
- One repo parked 16 issues under a rescope label within one minute, with no named
  rescoper and no date.
- One repo held an issue under a "not yet" label for 14 days.
- Two operator holds reached the operator's queue with no stated ask. The reason had not
  been written in the one syntax that repo's reader parsed.
