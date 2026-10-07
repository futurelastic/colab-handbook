# Channels and the marker: why

Moved from [`CONVENTIONS.md` §2, *Channels* and §3, *The marker*](../../CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Channels: why a file-synced tree cannot use trunk-direct

What makes a
shared-checkout hold safe is a lock on one checkout, and machine-local state is the
correct home for that lock — but only while a path on one machine means one machine. Sync
breaks that silently: two machines can each believe they hold the only checkout.

## The marker: why `stack` is free-form

— a closed enum was tried and
immediately failed on a Capacitor app fitting no bucket.

## Boot recipe: why every consumer kept its own table

, so every consumer wanting to start one has kept its own external table of
start commands, unvalidated against the repo, forcing a default onto any repo it has no
entry for.

## Boot recipe: the measured cost of the status quo

Measured cost of the status quo: a repo silently inherited an external table's default
ecosystem; the session's command died on the spot, and the caller was told the start had
**succeeded** while the port stayed dead indefinitely, with nothing to flag it.
