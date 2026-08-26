# `\w` in a heading-to-slug regex is ASCII-only, and the class after it can depend on what it deletes

A punctuation-stripping regex written as `[^\w\- ]+` silently deletes every letter
outside `[A-Za-z0-9_]` — any Vietnamese, Japanese, or accented-Latin heading loses
its real letters before it is ever turned into an anchor slug, and a comparison
against GitHub's own (Unicode-aware) slug then reports a real, resolving link as
broken.

## What happened

`slugifyHeading()` (two copies: `audit/audit.mjs`, `templates/docs-lint.mjs`) used
`.replace(/[^\w\- ]+/g, "")` to strip punctuation while keeping "word characters".
GitHub's real anchor algorithm keeps Unicode letters; `\w` does not, because it is
defined as `[A-Za-z0-9_]` regardless of the `u` flag on a *different* pattern in the
same function. Measured against real consumer repos with non-ASCII headings: 86% of
a sample's anchor-link findings were false positives of exactly this class.

**The fix suggested in the bug report was itself wrong**, in a way that would have
passed a shallow review: `[^\p{L}\p{N}\- ]+/gu` widens letters/digits to Unicode —
but it also drops `_` from the surviving class, and the very next statement in the
function, `.replace(/[ _]/g, "-")`, exists specifically to fold underscores into
hyphens. If the strip step upstream already deleted every `_`, that fold step has
nothing left to act on: `snake_case_heading` would slug to `snakecaseheading`
instead of the correct `snake-case-heading`. The two regex lines are not
independent — the second one's correctness is conditional on what the first one
lets through.

## The fix

Keep `_` as its own explicit class member alongside the widened letter/digit
classes: `[^\p{L}\p{N}_\- ]+` with the `/u` flag. Same three-way membership as
before (letter/digit, underscore, hyphen-or-space), just letter/digit widened from
ASCII to Unicode.

## Why this matters beyond this one fix

Any regex in this codebase (or one copied from it) that mixes `\w` with a
downstream step depending on one of `\w`'s three members (letter, digit,
underscore) individually has the same trap: widening the character class to admit
non-ASCII without re-deriving which members downstream code actually depends on
can silently break the very case the widening was meant to fix for. Verify a
"one-line" Unicode fix by running it, and the surrounding steps, against a fixture
that exercises every class member the pre-fix regex used to bundle together — not
just the new one being added.
