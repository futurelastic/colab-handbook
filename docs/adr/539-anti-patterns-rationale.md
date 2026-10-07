# Anti-patterns: the stories

Moved from [`CONVENTIONS.md` §10, *Anti-patterns*](../../CONVENTIONS.md#10-anti-patterns) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## A release branch nobody consumes

A repo adopted `dev` as default but nothing ever deployed from `main` — it sat 76 commits
behind for months, while a sibling `staging` branch was abandoned after a week.

## The same fix opened four times

With `dev`, `staging`, and `main` all live, one timezone fix required four near-identical
PRs.

## A deploy mechanism nobody used

A workflow triggers on tag push; it has zero tags — every deploy was manual dispatch.

## A merge that ships itself — while claiming otherwise

Two live repos deploy on every `main` push and declare Tier A, whose contract says a release
artifact gates production.

## Docs describing a repo that doesn't exist

Our most heavily documented repo prescribed trunk `main` (actual default `master`), "rebase,
never squash" (every commit a squash), CI gating on `dev` (workflow skips CI there by
design).

## Stale branch references in CI

A repo still gated on `develop`, `master`, and `workos` — none of which exist.

## A conclusion that only ever existed in chat

A session settled a batch of rules and went straight to implementing them — three branches,
zero Issues, no issue numbers in branch names, no `Closes #N` possible. The code landed; the
argument behind it was lost.
