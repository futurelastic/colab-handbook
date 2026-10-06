# Provenance and the ask class: why

Moved verbatim from [`CONVENTIONS.md` §5, *Provenance — who decided the work should exist* and *Ask — the filer declares the ask class (#89)*](../../CONVENTIONS.md#provenance--who-decided-the-work-should-exist) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why provenance exists

Issues arrive from three directions: a person, an agent that hit something while coding,
an agent filing a follow-up as it wraps. Nothing else in the model answers whether a
human decided the work should happen at all — an agent-filed issue is open, unclaimed,
unblocked, indistinguishable from human-requested work.

## Why the label is queryable

**Why:** anything that starts work in bulk (a start button, batch triage, a scheduled
sweep) must be able to exclude work no human approved — the label is what lets the
default be *excluded, started only when a person clicks*.

## Why an ask class

`agent-filed` says a human did not decide the work exists; it does not say what kind of
decision it is waiting on. Measured on a live 34-item approve queue (2026-08-01): six
ask-classes, detected only heuristically from labels and title phrasing.
