# Writing a conclusion down: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Writing a conclusion down — the decision and the document are two units*](../../CONVENTIONS.md#writing-a-conclusion-down--the-decision-and-the-document-are-two-units) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why Step 1 needs no branch

No
branch, worktree, or clean tree needed; it collides with nobody and is readable the
instant it is posted — and it is the part that must survive.

## Why Step 2 keeps the ceremony

...wrapped normally. A conclusion worth documenting is the *most* consequential
kind of doc change, not a typo exempt from ceremony.

## Why `colab holders` fetches first

**It fetches before it enumerates, and that is part of the check, not a convenience.**
The enumeration reads *local* refs, so a branch another session pushed and this clone
never fetched is invisible — and "clean ground" off that is a confident verdict built on
missing data, which is the one wrong answer that sends a second session onto a held file.
`--no-fetch` (offline, or a pinned view) therefore still reports holders it *can* see —
refs you have not fetched cannot un-hold a file — but **refuses** the clean verdict with
exit 2 instead of printing it.
