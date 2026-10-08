# `§6 Distribution` and `Services over npx`: why

Moved from [`CONVENTIONS.md` §6, *Distribution* and *Services over npx*](../../CONVENTIONS.md#distribution--one-install-surface-npx-442) (and [*Services over npx*](../../CONVENTIONS.md#services-over-npx--init-update-rollback-465)) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## How a full clone pays for dist refs

A plain `git clone` fetches every tag, including every platform of every release; later plain fetches do not (a tag is followed only into fetched history, and an orphan is never in it).

## Why the launcher reads the committish, not the manifest

— a candidate `#vX.Y.Z-rc.N` and its final carry the same manifest version, and only the committish tells them apart

## Why publishing or pushing happens in the release run

A tag made with `GITHUB_TOKEN` triggers no other workflow, so a "build on tag push" workflow never runs for a tag the release workflow made — the same reason the Release itself is published in that run.

## Why a long-running tool never runs from npx's cache

npm may prune that cache under a live process.

## Why a missing install route is only advisory (#469)

: a publish in a reusable workflow outside the repository is invisible to the check

## Why an undeclared repository is never checked (#469)

— nothing in a repository tells a tool from a library, so the audit does not guess

## Measured: npx and a branch committish

(measured on npm 11: the cached install is reused, and its lockfile's commit moves with the branch)

## Why side-by-side versions, and not a serving clone that follows a branch

**Why side-by-side versions, and not a serving clone that follows a branch.** A clone that pulls
and rebuilds in place makes a branch the thing that runs: rollback becomes a checkout plus a
rebuild, the running tree is half-updated while it builds, and what runs is not a version any dist
ref or release note names. Side-by-side versions keep the running version untouched until the
switch, make rollback a rename, and run only what a release tag names.
