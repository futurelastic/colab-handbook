# Phase 2 of the normative-text diet: a rule sentence may be split from its reason

## Context

[ADR 523](523-conventions-hard-default-and-size-budget.md) moved rationale out of
`CONVENTIONS.md` and `project.schema.md` verbatim only, and freed 379 lines where about
1,800 were planned. Most rationale was not in a paragraph of its own. It sat inside the
sentence that states the rule ("X, because we measured Y") or in a bold lead glued to it,
and a verbatim move would have taken the rule along.

#539 asked whether phase 2 may reword a rule sentence to split its rationale off. The ruling,
recorded on #539, was **option A**, with three limits:

- The rule half keeps its meaning and its modal verb. Only the *because…* clause, or the
  glued bold lead, moves to an ADR, and it moves verbatim.
- Every reworded rule updates its `docs/rule-inventory.md` row in the same change, and the
  change lists every changed key with its before and after text.
- A rule whose meaning would shift if it were separated stays as it is.

## Decision

- **The split was done section by section, in parallel, against one base** (`bc1100ea`).
  Seven slices covered both documents. Each wrote its rationale into new
  `docs/adr/539-<topic>-rationale.md` files (append-only: no earlier ADR was edited) and put
  its ledger in a `#539 ledger` block after its own section of the inventory. That kept
  the parallel slices free of merge conflicts.
- **A separate read-only review checked the merged result before the budgets were set.**
  It looked for a rule that had left with its rationale, and for a sentence whose referent
  had moved ("for the same reason", "this", "the premise"). It found fourteen (one of them a formatting break the cut left in a list). Each fix
  restored the minimal rule clause and brought no rationale back. They are listed in the
  inventory under *#539 ledger — coordinator review fixes*.
- **The proof is the same pair of checks as phase 1.** `check-doc-move --base bc1100ea
  --allow docs/rule-inventory.md` finds every base unit whole, by sentence, or excused by a
  ledger entry naming its rows. `check-rule-inventory` finds every key, and every hard rule
  still carries its marker. The inventory's *Move check* section records the run, and a
  table lists every row whose checked columns changed.
- **Budgets were lowered to the result**: `CONVENTIONS.md` 5,100 (5,049 lines, plus 50 for
  a concurrent branch's pending 28-line hunk), and `project.schema.md` 1,600 (1,551 lines).

## What the split could not reach

Phase 2 freed **531 lines from `CONVENTIONS.md`** (5,580 → 5,049) and **153 from
`project.schema.md`** (1,704 → 1,551), well short of the ~2,600 the plan estimated. Three
things held it back:

- **The ruling's own limit worked as intended.** Every slice reported "kept glued" units,
  where the reason is part of the rule's content. Examples are a row key that spans the
  *because*, a sentence a later sentence refers back to, and a stated limit that reads like
  a reason.
- **Two §4 bullets and one §7 bullet were out of bounds.** A concurrent branch was editing
  them, and they hold some of §4's largest rationale blocks.
- **The estimate assumed rationale was half of every section.** In the sections phase 1 had
  already worked, what was left was mostly rule.

## Alternatives rejected

- **One sequential pass.** It is slower, and it would read one section at a time with no
  second reader. The parallel pass plus an independent review caught errors that a single
  author is least likely to see in their own cuts.
- **Raising the target by rewriting rules more aggressively.** That is #174's failure. The
  review's fourteen findings show how easily a cut that looks like rationale takes a rule
  with it, even under a check.

## Consequences

- A reader of the normative text gets the rule and one *Why* link. The story is one click
  away, in a file named after the subsection.
- The next reduction, if any, has to come from rules themselves (merging duplicates,
  retiring dead ones). That is a ruling per rule, not a move.
- Raising either budget stays a reviewed edit with its reason in the same commit.
