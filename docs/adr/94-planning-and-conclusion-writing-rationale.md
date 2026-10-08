# Planning, writing a conclusion down, design conclusions: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Planning*](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94), [`CONVENTIONS.md` §5, *Writing a conclusion down*](../../CONVENTIONS.md#writing-a-conclusion-down--the-decision-and-the-document-are-two-units) and [`CONVENTIONS.md` §5, *Design conclusions*](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Planning (#94)

Coordinator (triage/grading) and implementer (coding) sessions often run at different
model tiers, and until #94 nothing carried the coordinator's read of the work across
that seam.

## Planning (#488)

Both used to sit under `.claude/`, which agent
CLIs guard as configuration — so every scratch write could cost the operator a permission
prompt.

## Writing a conclusion down: colab holders

`colab holders` filters every ref that ever
touched `<path>` through the same content classification `colab landed` uses, so a
branch whose edit already shipped (squash-merged, or landed with the base moved on
since) does not read as live contention — the raw `git log --all --not origin/<trunk>
--source` sweep it replaces cannot tell the two apart, and a busy repo pays for that
with false positives on every file.

## Writing a conclusion down: doc branches

Measured: on two adjacent edits to one paragraph, the
correct resolution was their union, not either side.

## Design conclusions: missing artifact

Following it stalls settled work, measured at about a day on three issues (#356).
