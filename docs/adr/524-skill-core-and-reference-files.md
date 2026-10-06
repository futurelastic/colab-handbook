# A large skill is a short core plus verbatim reference files, under a checked size budget

## Context

A skill loads whole into every session that runs it. On 2026-10-06 the four largest were
`code-triage` 2,498 lines, `code-ship` 1,895, `code-sweep` 1,148 and `code-wrap` 955. In each one,
the procedure was buried among incident write-ups, measurements and edge cases. That cost
context on every run, including a no-change ping, which needs only one step. It also made a
local-policy overlay (#520) hard to write, because a reader could not see which step an
overlay was refining.

One-off compaction had already been tried on `CONVENTIONS.md`. A rewrite brought it to about
2,100 lines, and it later grew to 5,781. Any shrinking that is not checked grows back
(#518). So any split needs a brake that a test enforces.

Rewriting prose to shorten it was ruled out, because the risk of losing instructions in a
rewrite had been measured. On one merge, a branch that never touched a line still carried
that line as diff context. Resolving the conflict in that branch's favour would have silently
reverted the other branch's change to the line. Every sentence of these skills has an
incident behind it. A summary that quietly drops one is a regression that no reviewer
will see.

## Decision

- **Split by moving text, not rewriting it.** Each large skill becomes a core `SKILL.md` plus
  flat reference files beside it, named `<step-id>-<slug>.md` (for example `b1a-branch-ci.md`
  or `0.1-resume-and-cache.md`).
  - Each reference file is one contiguous slice of the original, in its original order, under
    a four-line header that links back to the core.
  - Flat placement keeps every relative link (`../../CONVENTIONS.md#…`, `../code-ship/SKILL.md`)
    valid byte for byte.
- **The core is an index that a run executes.** It keeps:
  - the frontmatter, the intro and the local-policy block, which stays in its fixed place
    near the top;
  - every numbered step heading, byte-identical. Other skills, `CONVENTIONS.md`, `tools/` and
    adopters' overlays cite steps such as "`code-ship` B1b" and "`code-sweep` §3" by number and
    by anchor;
  - the decision tables and short command loops a run uses every time;
  - *Verify complete*.

  Each moved section leaves behind its heading, a **Rule:** line, a **Stop:** line where the
  step has one, and a pointer to its file. A pointer reads "Full text:" for a step every run
  executes, and "Read when \<trigger\>:" for a mode that only some runs take (batch landing, a
  red trunk, a reject, a scoped sweep). The core says plainly that the Rule line is an index,
  not a substitute, and that the reference file holds the full rule.
- **Nothing dropped is proved mechanically, not by review.** `scripts/check-skill-split.mjs`
  works as follows:
  - It cuts the pre-split file into units: a paragraph, a list item, a table row, a fenced
    block, a heading.
  - It requires each unit to appear in the core plus its reference files. Whitespace, heading
    level and the file part of a same-file anchor are normalised, because a moved paragraph's
    `#anchor` now has to name its new sibling file.
  - It also requires every numbered heading to still be in the core.

  [`docs/skill-step-inventory.md`](../skill-step-inventory.md) records each skill's run of the
  checker.
- **The brake is a test.** `tools/lib/skill-size.test.js` enforces the following:
  - A split skill's core must stay at or under **400 lines and 40 KB**. 40 KB is the same
    ceiling the audit applies to an always-loaded `CLAUDE.md`.
  - An unsplit skill must stay at or under **700 lines and 48 KB**. Crossing that limit is
    the signal to split, not to compress procedure until the number fits.
  - A limit is raised only by a reviewed entry in the test's `OVERRIDES`, with a reason.
  - The same test checks four structural properties: the local-policy hook is in its place,
    every reference file is linked from its core, every relative link resolves, and #517's
    hand-off filter is still present.

## Consequences

- The cost per run falls to the core plus the reference files for the steps the run actually
  takes. A no-change ping reads the core and one file.
- **Deferred text changes behaviour.** An edge case that used to be in view is now read only
  when its step is taken. That is why the default pointer is "Full text:", meaning "read before
  acting", and "Read when" is reserved for genuinely conditional modes.
- `code-start` (697 lines) and `handbook-sync` (689) sit just under the unsplit ceiling. Their
  next growth fails the test, which is intended: the outcome is a split, not a raised ceiling.
- **A forked repo-level copy of a skill keeps only its `SKILL.md`** unless the whole folder
  is copied. This is one more reason the handbook steers adopters away from forks and toward
  the local-policy overlay (#520).
- **Rationale did not move to ADRs here.** The epic (#518) wants incident stories in
  `docs/adr/`. Doing that in the same change would have been a prose rewrite of exactly the
  kind this split avoided. The reference files now hold that material in one place per
  step, which makes moving it a separate, reviewable change.
