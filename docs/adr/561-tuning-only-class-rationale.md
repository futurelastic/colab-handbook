# The tuning-only class: why, and what was ruled out

The rule lives in [`CONVENTIONS.md` §2, *Autonomy — the tuning-only class*](../../CONVENTIONS.md#autonomy--the-tuning-only-class-561).
This file holds its rationale.

## Why

Opting one repo in to `ship-batch` cost one issue, one code session, a wrap and a ship, all for a
one-line edit. The repo-owned-thresholds epic makes more values the repo's to set
(`ship-batch-wait`, the `thresholds:` map, `ci-wait-factor`), each meant to be moved from the
repo's own measurements. Every one of those steps paid the same ceremony as a feature, so repos
would not tune.

## Ruled out: an untracked `project.yml`

The owner asked (2026-10-07) whether `project.yml` could simply be ignored by git. It cannot:

- the CI templates (`ci-*`, `release-auto`, `deploy-*`) read it from the commit under test;
- worktrees are cut from git, so an untracked file never reaches one;
- machines would diverge, each holding its own copy;
- the authority-granting fields (`autonomy`, `promotion`, the grants) would lose their review trail.

So the file stays committed and the **tuning** change is made cheap instead: a command that writes
one validated key on a short branch, and a ship class computed from the diff that needs no issue.

## Why the class is computed, and narrow

The class is modelled on the docs-only door (#345): ship measures it from git, and the caller never
asserts it. It accepts only the descriptor, only lines inside a tuning key's block, and only values
the key's own parser accepts. A comment line, a second file or an authority key refuses it. A false
"no" costs a human click; a false "yes" would land an unreviewed change to how the repo merges.
