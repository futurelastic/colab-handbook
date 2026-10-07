# A fork of an upstream: why, with the measurements

Moved from [`CONVENTIONS.md` §9, *A fork of an upstream — a repo you own that tracks one you don't (#449)*](../../CONVENTIONS.md#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a fork's upstream-owned files are left alone

Every edit to one of those is a patch the fork carries forever and re-resolves on every
upstream merge.

## Why nothing is written to the descriptor for a fork

and a key would be a second copy of it that could drift

## Why step 5 is append-only

One appended block, at the end, touches no upstream line, so a merge only conflicts if the
upstream edits its own last lines. Measured: a block appended this way survived a 588-commit
upstream merge untouched. The thin-shell conversion moves every upstream line instead, and
conflicts on each upstream change to that file.

## Why adopt writes no `AGENTS.md` stub on a fork

Every file adopt creates is a file the upstream may add later, and then it conflicts.

## What `CLAUDE.local.md` costs on a fork

That file is never committed, so a teammate, CI or the upstream's own agents cloning the
fork never see the conventions. That is the same cost as [*Working in a repo you don't
own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own), paid on a repo you do own.

## Why the appended block says which flow governs

Measured: one such skill fired on any "fix / implement / refactor" request, wrote four files
per change into the upstream's own spec folder, and opened a pull request. That competes
directly with `code-start` → `code-wrap` → `code-ship`.

An agent reads the upstream's instructions and then this block, so the block is what settles
the competition.

## Why a fork declares `migrations:` before the first ship

An upstream's layout is usually not one of the two defaults (measured:
`modules/*/sql/*.sql`), and an undeclared layout leaves the no-new-migrations gate blind.
This is true of any repo, but a fork inherits someone else's layout and is the likeliest to
miss it.
