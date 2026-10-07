# Planning: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Planning — a plan file that outlives one command, and who drafts it (#94)*](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the plan lives in the main checkout

...in the **main checkout, outside any worktree** (exists
before the worktree, survives its teardown).

## Why the path is absolute

**Resolved via an absolute path, never bare relative (#113)** — a bare path from inside
a worktree silently resolves to the worktree's own copy:

## Why a plan is never back-filled

...and is never
back-filled, since a plan written after the code only describes the code.

## Why triage never authors the plan

...a
**cross-backlog judgement**, never a plan of its own (authoring at triage time produced
stale artifacts for groups not started soon).

## Why the flag is read by direct fetch

**Read the `needs-plan` flag by direct issue fetch, never the Search API**, which can lag
by minutes.
