# `writes`: the trunk-direct veto and `writes: direct`: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §2, *Writes*](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the two unchanged matrix rows stay unchanged

The two rows that never varied by the old method (`autonomy: auto-trunk`,
`ceremony: light` + `auto-trunk`) keep their cells unchanged — that they never depended on
`writes` is now evidence for this direction, not an invitation to re-open them. The two
rows that used to vary by declared method (`place-claim needed`, `branch`) are re-based
onto session identity, which a test can now drive end to end against the real `colab solo`
— see `tools/lib/audit-writes-matrix.test.js`.

## Why the concurrency premise was wrong

- The gate was already "whoever holds it right now" — `conflict` clears for a dead holder
and for a same-session re-acquire, and `entryProblems` deliberately ignores worktrees
(#236) and off-checkout claims (#240). There was nothing to loosen.
- What was missing is that the hold **did not serialize anybody**, on any repo, under any
`writes:` value: every acquire site decided outside the state lock and wrote inside it,
so 8 concurrent acquires on one checkout all succeeded (see
[Place-claims](../../CONVENTIONS.md#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not)).
`colab ship`'s B1 merge and `colab promote` take that same hold on the main checkout,
so this was a live defect in paths that already run today — not a future `direct`-only
concern. #285 moved the decision inside the lock and proved it with
`tools/lib/place-serialize.test.js`, demonstrated failing (8 winners where 1 is
required) against the pre-#285 binary before it passed against the new one.

## Why not option A, and why evidence-close is cheap

**Why not the simpler "Phase B never runs at all" (option A).** Because Phase A does not
close issues — it only distills onto them. Drop the whole of Phase B and a `direct` repo
has no close mechanism whatsoever: every unit's issue stays open forever with its work
long since on trunk. That is not a hypothetical — it is the failure [§4](../../CONVENTIONS.md#4-branches-and-commits)
already quantifies at 26/30 issues open with their code merged, and the failure
evidence-close (#90) was built to close:

> That branch cannot be squashed (there is nothing to stage) and used to have no
> completion path at all: the claim was released, the worktree torn down, and the issue
> stayed open forever, because the only close mechanism in the system was `Closes #N`
> inside a squash commit.

Option A recreates that hole for *every* `direct` unit. The ruling is a codebase fact
rather than a preference: the machinery option B asks for already exists and is already
this repo's answer to this exact shape of problem.

## Option C declined; the retired auto-trunk/serial-direct narrative

**Option C (defer until #285's concurrency design is further along) was declined.**
Close-accounting is independent of how concurrent writers are serialized, and leaving it
open cost #285 its unblock for no gain.

**Retired: the `auto-trunk`/`serial-direct` narrative #208 and #224 argued over.** The old
three-method table spent several paragraphs establishing that `auto-trunk` was never
actually gated on `serial-direct` vs `serial-gated`, only on whether a branch exists for
`colab ship` to act on. That conclusion is now trivially true — there is only one
coexistence cell, not two — and the argument that reached it is retired along with the
distinction it was about.

## Retired: the deploy-shape prohibition

**Retired: the deploy-shape prohibition.** A now-dropped rule once required a repo whose
trunk merge is itself the deploy to keep a branch and a pre-merge gate rather than run
trunk-direct freely (spelled out under [Channels](../../CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it)
below). ⚖ #233 removed it outright rather than deriving a replacement test: measured
before deciding, the shape it protected against (`exposure: live` **and** `trunk: main`)
had zero instances across 40 adopted descriptors — every live repo already declares a
trunk distinct from `main`, so its trunk merge lands on a branch that ships nothing.
