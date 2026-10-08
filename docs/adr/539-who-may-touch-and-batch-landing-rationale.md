# Who may touch a branch and batch landing: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §4, *Who may touch a branch* and *Batch landing*](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Who may touch a branch: why the coordinator never edits implementer work (#409)

Measured: a coordinator asked to wrap a candidate its implementer
had left uncommitted spent ~40 min running the full test gate on a shared, loaded
workstation, and the repo's single ship lane landed nothing else meanwhile.

## Batch landing: why it exists (#373)

Landing is serial by construction: every merge moves trunk, so the next candidate syncs
the new trunk in and pays a whole CI cycle for its re-run, and trunk's own run for the
last merge is still in flight when it asks. A queue of green work drains at **one change
per trunk-CI cycle**. Measured on one repo with an 8–9 minute CI: six candidates green at
their own heads, at most one landed per cycle — finished work waited hours behind the
gate, not behind review.
