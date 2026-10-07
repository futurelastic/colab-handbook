# A split skill's reference files hold the rule; its history lives in one ADR per file

## Context

[ADR 524](524-skill-core-and-reference-files.md) split the four largest skills into a core
plus reference files by moving text verbatim, and deliberately left the rationale in place:
a rewrite in the same change had a measured loss risk. The reference files therefore still
mixed a step's full rule with its history — incident write-ups, measurements, "the failure
it closes" paragraphs. The epic (#518) rules that rationale lives in ADRs, and #523 / #539
did that for `CONVENTIONS.md` and `project.schema.md`. Nothing had done it for the skills.

## Decision

- **Same method as #539, applied to skills.** History moves to `docs/adr/` verbatim — a whole
  unit, or a mixed unit cut at a sentence boundary with each part byte-identical. No rule
  sentence is reworded, so the move needs no allow-ledger.
- **One ADR per reference file that lost text**, named
  `536-<skill>-<reference-file>-rationale.md`. The reference file is the unit a reader opens
  from a core step, so its rationale is one click away under a name derived from it.
- **The reference file keeps one `Why: [ADR 536](…)` link** where the text was, every
  heading, and its four-line header. Cores are not touched.
- **Kept, not moved:** a measurement glued into its rule's sentence, one a kept sentence
  refers back to, "measured" used as a rule's verb, example output, and anything the mover
  was unsure of. Losing a rule costs more than leaving a story.
- **Proof:** `scripts/check-doc-move.mjs` with `--files` set to the reference files and
  `--into docs/adr`. It is the same unit check as `check-skill-split`, and it also requires
  every heading to stay in its own file. [`docs/skill-step-inventory.md`](../skill-step-inventory.md)
  records the run and which file lost what.

## Alternatives rejected

- **Re-running `check-skill-split` against the #524 baselines.** Its haystack is the skill
  folder only, so every moved unit would read as missing. `check-doc-move` already takes an
  `--into` set and checks sentence-level cuts, so no new checker was written.
- **One ADR per decision across files** (several reference files citing the same incident).
  It would need the mover to judge which incidents are "the same" — a rewrite by grouping.
  Per-file ADRs keep the move mechanical; a later ADR can consolidate and point back.

## Consequences

- A session taking a step reads the rule and an optional link, not the story. 42 reference
  files changed across four skills, a net 171 lines lighter (312 removed, 141 added: the
  `Why:` links and lines rejoined after a sentence cut).
- What stays is listed by kind in the inventory. Further reduction needs a reword ruling
  per rule, as #539's phase 2 did for `CONVENTIONS.md`, not another verbatim move.
