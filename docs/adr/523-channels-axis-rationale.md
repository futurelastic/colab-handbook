# `channels`: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §2, *Channels*](../../CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `channels`: the measured fleet

`deploy:` covers roughly two of the paths
this fleet has actually observed: merge → CI → a deploy workflow, and a hand-run
procedure. Measured across a real fleet, code reaches something that runs it by at least
seven distinct routes, and `deploy: none` had come to mean "there is no workflow file,"
when the honest reading has to be "nothing runs this code anywhere" — three separate
running services were found declaring exactly that.

## Why this is not the exposure axis again

**Why this is not the exposure axis again.** [Exposure](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here)
asks *who consumes a merge*; this asks *by what route a commit reaches the thing that
runs*. They fail differently: a repo can answer exposure correctly and still have an
undeclared channel — the consumer is right, the route is invisible. And two repos with
identical exposure can need completely different care, because one ships by a reviewed
workflow and the other by a file-sync nobody wrote down.

## Two shapes of consequence of an unintended channel

Two shapes of consequence, described here by what was true rather than by which
repo it was true of: a running service reporting a build from a dirty working tree at a
revision matching no commit findable on the machine inspected, while the repo's own
deploy script *refuses* a dirty tree by design — meaning the binary arrived by a path that
bypassed the repo's own documented procedure; and a second machine carrying no git
metadata at all for a repo it was nonetheless running, so a directory-scoped git command
silently resolved to an enclosing repository and answered confidently about the wrong one.

## Retired: the second consequence

**Retired: the second consequence, where the trunk merge was itself the deploy.** A rule
used to sit here requiring such a repo to keep a branch and a pre-merge gate for
trunk-direct rather than running it freely — a derived constraint from `channels`+`deploy`
together, not a declared field. ⚖ #233 dropped it outright rather than deriving a
replacement test, measuring first that the shape it protected against (`exposure: live`
**and** `trunk: main`) has zero instances across 40 adopted descriptors — every live repo
already declares a trunk distinct from `main`. See
[Writes, "Retired: the deploy-shape prohibition"](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
for the replacement: a repo needing this restriction now declares `writes: isolated`
outright, and the audit reports the undeclared shape as an informational advisory.

## What the unit that introduced `channels` did not do

**What this unit does not do.** It ships the `channels` key, its shape/enum check, and the
descriptor-internal advisory — nothing more. **#137 later added a falsifier**: a
version-shaped tag, or a committed deploy path, contradicting a declared `channels: [none]`
— a `warn`, on `exposure`'s own precedent, plus a duration report computed from git history.

## What does not change

`room`, `exposure`, `ceremony`, and `writes` rules are unchanged; `tier`,
`trunk`, `deploy`, and `production` stay fully authoritative, and nothing in the fleet, nor
any outside adopter of this public repo, breaks on this merge.
