# Tiers (§1 and §2): why

Moved from [`CONVENTIONS.md` §2, *Tiers*](../../CONVENTIONS.md#2-tiers) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the split exists at all (§1)

This buys one thing: the expensive test suite runs at promotion time, not on every session
merge. Sessions stay fast; releases stay safe.

## Why the split exists at all (§1), continued

The split answers slow CI, not
seriousness. A repo with no meaningful suite gains nothing from it — ceremony with no
benefit, and `main` becomes a branch nobody trusts.

## Why Tier C exists (§2)

**Tier C exists because a tag ritual nobody honours is worse than no tag ritual.**

## Why Tier C exists (§2), continued

Not a lesser A — a different, honest gate count.

## The shape of tag-gated GitOps (§2, tag-gated Tier A)

Common
in tag-gated GitOps: a release script cuts `vX.Y.Z` and fast-forwards a long-lived
**release branch** an external poller watches and redeploys, so the deploy runs
**outside** CI with **no in-repo deploy workflow** by design.

## Why the release branch is declared (§2, tag-gated Tier A)

— between releases it is, by construction, an ancestor of trunk, indistinguishable by
ancestry alone from a spent session branch; undeclared, `colab doctor` misreads it as
safe to delete (#63).

## Why the word "trunk" is never recorded (§2, trunk)

Measured: a session's record read `branch: "trunk"`; the merge tool matched
claims **by branch name**, found none, and squashed anyway — no `Closes #N`, the same
26-of-30 failure below reached by a different path.

## Why Group B gets no descriptor field (§2, trunk)

A
`deploys: { <host>: <branch> }` entry would drift the moment a machine is renamed or
retired, with nothing able to tell a stale entry from a live one.
