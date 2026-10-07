# Autonomy and core paths: why

Moved from [`CONVENTIONS.md` §2, *Autonomy* and *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The human door: what the refusal used to cost

Before this rule the
refusal sent the human away with nothing to run, so on the default (`manual`) setting they had to
redo B0 through B4 by hand, or grant `auto-trunk` and lose the human go on every later merge.

## Core paths: why a fork ignores another org's teams

A team of
another org cannot review in the fork, so honouring it turns every landing into a human gate
that nobody here decided on.

## Core paths: why `colab solo` does not check core paths

That would be a separate change,
taken only if a bypass is ever measured, because `--direct` is attended by construction.

## Core paths: why `--direct` reads CODEOWNERS twice

For `--direct` the target already contains the unit, so reading the current file alone would
let a unit exempt itself by deleting or narrowing it.
