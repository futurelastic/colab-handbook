# `§8 Conformance and reconciliation`: why, with the measurements

Moved from [`CONVENTIONS.md` §8, *Conformance and reconciliation*](../../CONVENTIONS.md#8-conformance-and-reconciliation) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The incident that motivated the rule-neutral trailer (#272)

(a corrected hyperlink, once, flipped every under-stamped adopter red — the incident that motivated this)

## Why not a classifier that guesses whether a template change mattered (#272)

The fix is not a classifier that reads the diff and guesses whether it mattered; that trades a loud, honest failure for a quiet, wrong one.

## Why the frozen CLI copy is measured against the latest tag

— measured against `HEAD` it reported "behind" for every unreleased CLI commit and advised adopting untagged code

## Why a file and not a fork or a field (#520)

**Why a file and not a fork or a field.** `project.yml` fields are switches and cannot carry
"write comments in Japanese". A repo instruction file is advisory and carries no precedence
over skill text. A repo-level copy of a skill does not override the installed one on an
engine whose skill precedence ranks the user-level install above the project's, and a fork
silently loses every upstream update. One overlay per skill keeps the upstream text and the
local difference in separate files, so a handbook update still lands.

## Why the upstream direction had no rule (#362)

The other direction had no rule.

## The measured divergences that motivated the upstream rule (#362)

Agents load both texts, so they obey whichever they read last. Measured: a consumer made `delivery:docs-only` a code-lane start candidate, and the handbook issue was filed 30 days later. In between, a triage pass that followed the handbook left an issue unstarted for about 6 days. A second consumer added a `delivery:*` value the handbook does not have. A third consumer lacked that value, filed design work under `docs-only` instead, and its scheduler sent the work to the code worker.

## Measured: `agent-filed` and the upstream issue

Measured: a fix filed under `agent-filed` waited for acceptance, and one filed without it landed the same day.

## Why a declared divergence settles "whichever text I read last"

This is also what settles the "whichever text I read last" problem: an agent reading this repo's instructions sees, next to the handbook pointer, which meaning wins here and why.

## Measured: a label made monotonic upstream

Measured: a label made monotonic upstream while a consumer's triage prompt still said clearing it "is often correct".
