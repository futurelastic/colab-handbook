# Scheduled drivers: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Scheduled drivers — provenance and autonomy meet a caller that is not a person*](../../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `epic` issues are excluded

`epic`-labelled issues are excluded — an epic can pass provenance cleanly and still not be a pick-up-and-code task.

## Why `needs-decision` issues are excluded

`needs-decision` issues are excluded, for a third distinct reason: no human has answered
the blocking question, even if the work item itself is human-filed, unblocked, and a
genuine leaf task.

## Why the label alone is not an answer

...it checks for
`decision-recorded` or the live comment marker, since a cleared `needs-decision` with
neither present is the stale, not-yet-swept state, not a decided one.

## Why the release workflow publishes in the same run

...and **publish in the same run** — a tag
pushed with `GITHUB_TOKEN` triggers no other workflow, so a Release left to a tag-push
workflow is never published.

## Why a private repo runs the release workflow on its own runners

(#453). It
fires on every green CI run on `main`, so a job of it that fails is a failed run at
`main`'s head, and `colab ship` reads that as trunk not green. So its jobs run on the
self-hosted label the repo's CI already uses; `ubuntu-latest` is right only on a public
repo, where hosted minutes are free.

## Why the runner label is a literal edit point

The label is a literal edit point in the template, not an expression keyed
on visibility: a scheduled run's payload carries no repository, so such a switch would
quietly pick hosted on the daily run.

## Why the promotion dispatches CI on `main`

...then dispatches CI on `main` — a push
made with `GITHUB_TOKEN` triggers no workflow, a `workflow_dispatch` is the documented
exception — and that run's green completion cuts the candidate...

## Why `COLAB_HUMAN` changes nothing for a workflow

`COLAB_HUMAN` changes nothing in either
direction: a workflow is not a human, and the grant is the descriptor's.
