# The normative documents mark hard rules by their gate, keep rationale in ADRs, and carry a checked size budget

## Context

`CONVENTIONS.md` was 5,895 lines at `e01b9e27` (2026-10-06) and `project.schema.md` 1,704.
The compact reissue (#159/#167) had brought `CONVENTIONS.md` to about 2,100 lines at
`v1.11.0`. It nearly tripled in two months, because each incident wrote its story, its
measurement and its "why" into the rule it produced. §5 alone ran 2,345 lines.

Two other problems came with the size:

- Every rule read as equally binding. A reader could not tell the few rules a `colab` gate
  enforces from the many that are one reasonable way to work. The standard looked stricter
  than it is, and harder to adopt (#518).
- The last compaction lost rules, and nobody saw it until a later grade: four obligations,
  one of them turned from a must into an offer (#174). Review against the prose diff does
  not catch that.

The epic #518 ruled three things this decision implements: a rule is hard only when a gate
enforces it; rationale lives in ADRs and the rule keeps one link; growth needs a checked
brake, not another compaction.

## Decision

- **Hard means gated, and the text says which gate.** A rule enforced by a `colab` refusal
  or a git hook carries a `**[Hard — gate: …]**` marker at the start of its paragraph.
  [CONVENTIONS.md §1, *Hard rules and defaults*](../../CONVENTIONS.md#hard-rules-and-defaults)
  lists the hard families and their gates. Every rule without a marker is a default: one way
  to do it, which a repo may refine in its local policy (§8, #520). The modal verbs did not
  change; only the claim about enforcement did.
- **Rationale moves verbatim, never rewritten.** Incident narratives, measurements, design
  history and alternatives moved into `docs/adr/<issue>-<slug>-rationale.md` files, one per
  subsection or cluster, each linked from the rule it explains. A mixed paragraph was split
  only at a sentence boundary. Every heading stayed in its file, byte-identical, because
  skills, tools and adopters link to the anchors and cite sections by number.
- **The inventory is checked, not just written.** `docs/rule-inventory.md` has one row per
  rule with a verbatim key phrase, its class (`hard` / `default` / `explanation`), its gate
  literal for a hard rule, and its destination file. `scripts/check-rule-inventory.mjs`
  runs in smoke and CI and fails when a key leaves its file, when a rule (not an
  explanation) leaves the normative documents, when a hard rule loses its marker or its gate
  literal disappears from the gate's file, and when a marker has no row.
- **Nothing dropped is proved once, mechanically.** `scripts/check-doc-move.mjs` is
  `check-skill-split.mjs`'s unit check (#524) applied to the two documents: every unit at
  the base must still be found in the documents or the ADRs. The only excused unit is the §11
  fence the `exposure` reframe rewrote, listed in the inventory's ledger with the rows that
  carry its rules. The run's output is recorded in the inventory.
- **The brake is a budget with a ratchet.** `scripts/check-doc-budget.mjs` (smoke and CI)
  fails a normative file over its line budget, pointing at "move the rationale to an ADR".
  It also fails one more than 100 lines under budget, so a saving is locked in rather than
  becoming room to regrow. Raising a budget is a reviewed edit with its reason.
- **`exposure` frames §2 and §11.** `tier:` is described in one sentence as a legacy read of
  `exposure`, matching `tools/lib/axis-authority.js`. The heading `## 2. Tiers` stays, because
  its anchor and "§2" are cited from skills, tools and adopters' copies.

## Phasing, and what verbatim moves could not do

This pass (base `e01b9e27`) marked hard rules in every section of both documents and
inventoried every rule: 1,936 rows, 170 of them `hard`, 1,660 `default`, and 106
`explanation` rows recording where a moved block went. It moved rationale out of §2 (*Writes*
through *Channels*) and all of §5 into 29 new ADRs. §4, §6, §7, §9 and `project.schema.md`
were marked but not moved: §4 *Branch CI* and §7 were being edited on a concurrent branch,
and the unit was already large.

The moves freed **379 lines** (5,895 → 5,516), where the plan had estimated about 1,800.
Each of the five slices that moved text stopped for the same reason. Most rationale here does
not sit in a paragraph of its own. It sits inside the sentence that states the rule ("X,
because we measured Y"), or in a bold lead the unit check reads as one sentence with the rule
after it. Moving it verbatim would move the rule as well, which the inventory check refuses.
That is the check doing its job: the shortfall is the price of #174's lesson, not a defect.

Getting further means rewording rule sentences so that the rule and its reason come apart.
With the inventory in place, every such reword is visible row by row, because a changed key
fails CI until its row is updated. Whether to allow that is a ruling, not an implementation
detail, so it is asked on #539 rather than taken here.

Budgets after this pass: `CONVENTIONS.md` 5,550 (5,516 lines) and `project.schema.md` 1,750
(1,704). The ratchet makes #539 lower them as it lands.

**§2 is reframed by a lead paragraph, not by renaming.** §2 now opens by reading the section
through `exposure`, with `tier:` in one sentence as its legacy read. The per-tier paragraphs
below it keep their wording. A bare `tier: B` maps to no exposure value, because `none`,
`self` and `released` all occur under it. So turning "Tier B" into an exposure value would
change what a rule says, which is a per-rule judgement. #539 carries it as an optional item.

## Alternatives rejected

- **Another compaction by rewriting.** #174 measured what that costs. The text has an
  incident behind nearly every sentence, and a summary drops some without anyone seeing.
- **Marking every rule, hard or default.** That would add hundreds of markers for no
  information: a default is the normal case. A preamble says unmarked means default, and
  only the short hard set is marked.
- **Line numbers as gate references.** They drift with every edit to `tools/colab`. A
  literal string from the refusal drifts only when the refusal changes, which is exactly
  when the rule should be re-read.
- **A warn-only budget.** A warning is what the document already had, in effect, and it
  grew from 2,100 to 5,895 lines.

## Consequences

- An edit to a keyed sentence fails CI until its inventory row is updated in the same
  commit. That is the brake working; the failure names the row.
- A new rule is not detected by any check. A new rule needs a row, and review has to ask
  for it.
- A branch that shrinks a document far enough must also lower its budget.
- A reader can find every gate the handbook claims in one table, and can tell from the text
  alone which rules a repo may refine.
