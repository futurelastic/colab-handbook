# Working in a repo you don't own: why, with the measured cases

Moved from [`CONVENTIONS.md` §9, *Working in a repo you don't own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The measured case behind working in a repo you do not own

The measured case: a private repo owned by another developer, default branch `master`, no
handbook files, with the fleet building a service layer on a long-lived branch of its own.

## Why the legacy fallback does not work for an integration branch

The legacy fallback does not work here, because it would derive `tier: B`, which is the
single-trunk shape, and the integration branch is never the repo's only long-lived branch.

## Why delivered is read from PR state

After a squash or rebase no integration commit is an ancestor of the owner's branch, so
ancestry cannot answer "was this delivered".

## Why delivery is one batch PR

the measured case wants the batch

## Why scheduled autopilot stays off

It would triage and start the **owner's** issues, not only the fleet's, and there is no way
today to scope it to the fleet's issues.

## Why an ungated integration branch is an advisory here

because the fix would be a commit to his repo

## Why full adoption is preferred

It is the only way the conventions reach anyone who clones the repo without this machine's
local state: a teammate, CI, the owner's own agents.
