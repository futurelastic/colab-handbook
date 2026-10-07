# code-wrap a2-claude-md-router: why, with the measurements

Moved from [`skills/code-wrap/a2-claude-md-router.md`](../../skills/code-wrap/a2-claude-md-router.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The measurement behind the accretion rule

Measured across six repos: **~30 lines added per session, and not one commit ever
made one smaller.** The furthest along went 66 → 452 lines (39 KB, ~10-12k tokens)
in two days; every session in it — including one that only touched CSS — pays that
before doing anything, which is the opposite of code-start's whole premise.

## The restart-procedure finding

We found a restart procedure living in both, and three other
  rules living *only* in `CLAUDE.md`, so no after-the-fact routing rule can sort
  them: "ops → the deploy doc" silently loses a rule, "gotchas → `CLAUDE.md`"
  returns a second drifting copy.
