# code-ship · What a defer is for (#257)

Reference for [`code-ship`](SKILL.md) *What a defer is for*. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## What a defer is for — and what it is never for (#257)

A coordinator once deferred a sound branch because the branch's originating session was
sitting at an interactive prompt with unsent text in its composer and the coordinator
could not deliver a message into it. Nothing about the diff was wrong; the deferral was
written up carefully and was still the wrong outcome, because **every step this skill
performs runs in the coordinator's own worktree** — B0's sync, B1's CI check, B2's
squash — and none of them contact the originating session at all. Declining a step this
skill assigns to you, on grounds that step never involves, is not caution; it is
inventing a stop condition.

- **Unsent or stranded text in the originating session's composer is an operational
  nuisance about a UI, never a fact about the work.** Neither is "the session did not
  answer", "the session is parked", or "I could not deliver a message into it." None of
  these produce a defer, ever.
- **A defer is reserved for a genuine blocker on the work**: a red or dead precondition
  the coordinator cannot itself clear (B1's CI gate), a real conflict needing the
  author's judgement (B0's non-generated-file conflict path), or a missing human gate
  (the go-ahead itself, `autonomy`, a `needs-decision` answer). If you cannot name which
  of these three a deferral is, it is not a deferral — go do the step.
- **Which of two same-file siblings lands first is never a missing human gate (#370).**
  The order is mechanical — earlier wrap first, tie → smaller diff (`code-sweep`
  [§4.0](../code-sweep/SKILL.md#40-order-the-pass-by-readiness--ready-work-first-370)).
  Measured: four such pairs in 72 h sat 35–143 min each waiting for a human to pick the
  order; nobody answered, and each cleared on its own the moment its sibling landed. Land
  the first, record the order on both issues, then take the second through B0 against the
  new `<base>`. A conflict *there* is B0's ordinary conflict path, not a reason to have
  asked first.
- **The blast radius is never just this one branch.** A finish-before-start gate reads a
  session holding an unfinished worktree as a reason to refuse *new* starts across the
  whole repo — one wrongly deferred branch can make a large share of a ready backlog
  unstartable, and a comment on one issue is not a place a human looking at the backlog
  will ever see it. Clearing one such session by deferring it just moves the block to the
  next session in the same state; it resolves nothing.
- **A recorded deferral carries a clock, or it is indistinguishable from a defer nobody
  noticed.** Name the specific precondition, what would clear it, and an expiry or
  re-measure trigger — the event or time after which the branch is measured again rather
  than waiting for someone to ask. A blocker no agent may clear belongs on the
  handbook's existing human-watched surface, the `needs-decision` label
  (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), *Decision gate*) —
  triage already re-measures it every run and clears it on a recorded decision — plus
  your own report to whoever is operating you. An issue comment alone is a record, not a
  notification; reuse this existing machinery rather than inventing a second one.
- **A landed gate fix is a re-measure trigger for every recorded park (#540).** When a merge
  changes something a gate reads — `.github/workflows/`, `.github/project.yml`, the vendored
  tool or handbook stamp, a CI or gate script — or closes a `TRUNK RED:` issue, every defer
  whose precondition that gate was may now be clear. Re-run `colab ship --dry --json` on
  each parked candidate in the same pass, and ship the ones that read READY. Nothing else
  re-probes a park on its own: the host that spawns sessions does not, and a defer whose
  trigger already fired otherwise waits for someone to ask.
