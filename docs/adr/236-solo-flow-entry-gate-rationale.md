# Solo flow's entry gate: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §2, *Solo flow*](../../CONVENTIONS.md#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the place-claim is asked, not the solo record

`colab solo`'s own `solo` record
carries no liveness signal — it used to refuse on mere presence, so a crashed session's
leftovers blocked every later attendee until somebody reached for `--force`, the same
blunt instrument used to take over a **live** holder. The place-claim beside it does
carry liveness, so that is what is asked.

## Why a worktree or a claim elsewhere is not on the entry list

The claim registry
holds an *issue*, not a *place*, so a claim tied to a worktree elsewhere is that
worktree's business, not this checkout's — a session writing there is not a writer of
the checkout solo flow is about to commit straight to, and cannot become one.
