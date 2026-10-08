# code-sweep · §4 A failure defers that candidate

Reference for [`code-sweep`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### A failure defers that candidate — the run goes on (#308)

This was one paragraph reading *stop the sweep there* on any failure. It is now three
classes, and they divide on **scope**, not on severity — which of the three a failure
falls into is what decides whether the run continues:

- **Candidate-scoped** — a conflict needing judgment (a send-back to the author: one
  `↩️ Sent back` comment naming the conflicting paths, never a resolution by the sweep),
  this branch's gate failing for
  reasons unrelated to trunk, a rejected grade on one issue set, a branch run still in
  flight when `code-ship` B1a's bounded wait expired (`ci-wait`, §4.0 — record its run
  id). It blocks *that* candidate and says nothing about the next one. **Defer it, record why, continue.**
  [`code-ship`](../code-ship/SKILL.md) already scopes its own refusals exactly this way
  — *"a rejected grade — either class — ends this skill's run **for that issue set**"* —
  and it was only this section that escalated a per-candidate refusal into a run-level
  one.
- **Repo-wide** — trunk CI dead or red. **Classify a red first**, exactly as `code-ship`
  B1 does ([b1-red-trunk.md](../code-ship/b1-red-trunk.md), #540): runner-side signatures
  with the re-run still unspent (`attempt` 1) get the one re-run — after cancelling a queued
  same-sha duplicate — and one bounded `colab ci-wait`; green ⇒ the merge loop carries on.
  Several jobs dying in the same minute on different runners ⇒ check the host, not the
  re-run. Only a repeat, or a `red:finding`, is the wall below.
  Red after that, or dead: **stop the merge loop** and say what would clear
  it, routing to the cure rule (`CONVENTIONS.md` [§5, *Cure rule*](../../CONVENTIONS.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281), #281). Continuing
  here is not conservatism, it is spinning: step 1 above re-checks trunk CI per
  candidate, so every remaining ship refuses at the same wall. **Nothing in this section
  is license to merge onto a red trunk** — the two doors through that precondition are
  the cure rule and a human ci-grant, both defined elsewhere, neither of them this
  skill's to open. (`colab ship` fires the cure automatically per branch, so the
  refusal you just got already means the door did not open *for that branch*; do not
  hand-walk the bucket hunting for one it might open for.)
- **Destructive, or you cannot tell which of the two above it is** — stop, exactly as
  before. An unclassifiable failure is treated as repo-wide until someone proves
  otherwise; that is the direction it is safe to be wrong in.

**Stopping the merge loop is not stopping the sweep.** §5's tracker reconciliation merges
nothing, and neither do the `teardown-only`, `claim-only`, `place-claim`, `unrecorded` or
`spent-remote` buckets — a dead trunk CI has no bearing on any of them. Carry on with those and say that
you did.

**Record it either way, but they are different records.** A run-level stop writes
`interrupted` (§0.1) — completed candidates, the one it stopped on, why — so the next ping
resumes instead of re-deriving its way back to the same wall. A deferral is **not** a stop:
it goes in `conclusion.deferred` with its reason, and the run that produced it finished.

Why: [ADR 536](../../docs/adr/536-code-sweep-4-failure-defers-rationale.md).
