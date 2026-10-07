# `writes` and `direct`: why

Moved from [`CONVENTIONS.md` §2, *Writes*](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The #233 ruling: what the vocabulary replaced

Before this ruling, the field named which of three
coherent methods a repo's sessions defaulted to (`serial-direct` / `serial-gated` /
`isolated`), and the three interacted with `autonomy`, CI role, and branch-mandatory in
different ways — machinery this section used to spend most of its length explaining. That
machinery is retired.

## `direct`: the proposal of record for concurrency

The proposal of record was that under `direct` the trunk checkout
  becomes a strictly one-writer-at-a-time resource, every direct writer holding the
  path-scoped place-claim, and that `colab solo`'s entry gate would have to be *loosened*
  from "refuse if anything is held" to allow it. Implementing it found the premise wrong in
  both halves, and the correction is worth more than the original plan:

## `direct`: why the CI role was cheap to decide

Cheap to decide because `ciRole` is derived prose in
  `tools/lib/adopt.js`'s `deriveConsequences`, not enforcement.

## `direct`: evidence-close was unreachable for a branchless unit

**⚠️ Measured during #285:** the question was premature, because `colab ship` could not
  reach evidence-close for a branchless `direct` unit at all — `resolveShipSession` refused
  with `ship needs --worktree or --branch`, supplying trunk was refused by `--branch is the
  trunk itself`, and `colab solo --done` neither posts evidence nor closes anything: the same
  26/30 hole option B was chosen to avoid. **[#302](https://github.com/futurelastic/colab-handbook/issues/302)
  built that door (`colab ship --direct`, above) and left the gate exactly as it is.**

## `direct`: the evidence rule counts only comments the session did not write

Counting trunk commits that mention `#N` as evidence was considered and rejected: the
  session writes those messages itself, so the evidence would be self-declared.

## Why a branch is not coupled to exposure, tier or production

The correlation visible
across today's fleet — light/beta repos tending to run solo, live repos tending to branch
— is caused by *who works a repo* (one person vs. several), not by *what consumes it*
(nobody vs. production users). A quiet Tier A repo with one session in flight needs no
branch on `writes` grounds; a busy Tier B playground with three sessions does. Encoding
the observed correlation as an audited rule would repeat the same weld `ceremony` was
introduced to undo (`ceremony` vs. `tier`, above) — so no such rule exists, and none
should be added later "to catch the common case."
