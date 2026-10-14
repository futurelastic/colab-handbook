# Speculative batch chains: `colab ship --batch … --onto <ship-batch ref>`

The rule is in [`CONVENTIONS.md` §4, *Batch landing*, step 11](../../CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373).
This file explains why it has that shape and records the rulings on the edge cases.

## Context

`colab ship --batch` built a batch only on trunk's tip. A merge queue that wants to test
the **next** batch while the current one is still in CI had no way to ask colab for it.
Zuul, GitLab merge trains and GitHub's merge queue all do this, and call it a speculative
chain. Three things got in the way:

- the build always used `ls-remote` trunk's tip;
- the stale-ref sweep deleted every `ship-batch/*` ref whose base was not trunk's tip;
- the lane hold (#581) and the land step only knew one batch per tip.

A caller could build the chain with plain git instead. It would then be a second writer on
trunk, and it would lose closes-with-evidence, claim release and the lane hold.

## Decision

- **The chain is read from the remote's refs alone, with no stored state.** A batch's ref
  name already records its base (`ship-batch/<base-sha7>`). A child built on a parent's head
  is therefore `ship-batch/<parent-head-sha7>`.
  - A ref's parent is the ref whose head sha starts with the child's base7.
  - A ref is *rooted* when following parents ends at a batch built on trunk's tip.
  - One `ls-remote` answers both questions. The sweep, the lane hold, the resume lookup and
    the land step all ask the same pure rule (`tools/lib/ship-batch.js` `batchChains`).
- **The existing path does the in-order land.** When the parent lands, trunk fast-forwards
  to the parent's head. That head is exactly the child's base, so the child becomes an
  ordinary batch at trunk's tip. The unchanged at-tip path lands it by `merge --ff-only`.
  There is no rebuild and no second run.
  - Before then, a green child pauses: `⏸ BATCH-CHAINED`, exit 3.
  - Trunk still moves only by that fast-forward, so a chain adds no push path.
- **A child dies with its parent.**
  - A parent that is red (`chainedLandStep`) can no longer land at the sha the child was
    built on, so the child is deleted and declined (exit 4).
  - So is a parent that is gone, or rebuilt under a new head (`--split`, a members change).
  - So is a trunk moved by any other path.
  - The orphan's run is cancelled while it is still going, because nothing can ever land it.
    This happens only to a ref built on a head that trunk never reached. A batch on an *old*
    trunk tip is deleted exactly as before, and its run is left alone.
- **The lane holder is the whole chain.** While any ref of a chain rooted at trunk's tip has
  its run in flight, or green within the grace, a serial `--branch` into trunk pauses. Every
  ref of the chain reaches trunk only through that chain, so a serial land would discard all
  of their runs at once. A `TRUNK RED:` cure is never held: trunk is red, and the cure is the
  way out.

## Edge rulings

- **Depth: at most 3.** Each link pins trunk for one more combined run. A wrong guess low in
  the chain throws away every run above it. Three covers "test the next one, and the one
  after" without turning the queue into a long bet. It is one constant (`MAX_CHAIN_DEPTH`).
- **A member already carried by the chain below does not join the child.** It is listed `✗`
  with the ref that carries it, and the rest of the child goes on. This matches every other
  per-member gate. Refusing the whole call would force the caller to recompute a list colab
  already knows how to filter.
- **A missing `--onto` ref declines (exit 4); it is not refused (exit 1).** `ls-remote`
  cannot tell "never existed" apart from "discarded" or "landed under other members", and
  the rule for discarded is a decline. One exception: when the parent landed and its lander
  deleted the ref, the child is already at trunk's tip. The call then simply resumes it.
- **A named ref with no combined run, or one not rooted at trunk's tip, is refused (exit 1).**
  Chaining onto a batch whose run has not started is a bet with no information in it.
- **No eager deletion of descendants on rebuild or split.** A parent rebuilt under a new head
  orphans its child. The next `--batch` call's sweep deletes it and cancels its run, whoever
  makes that call. Until then the child is unrooted, so it holds no lane and cannot land.
  There is one rule, in one place.
- **Member gates are still measured against trunk.** A member is cut from trunk, so
  `trunk..member` is exactly its own commits. The parent's head is not its ancestor, so it
  would be the wrong base for `buildSquashMessage` and `closesCoverage`.
- **Adaptive size reads trunk's last landed batch, not the in-flight parent.** A chain is
  speculative. Its parent's size is not yet an outcome.

## Alternatives rejected

- **A chain record in `~/.colab` or a trailer naming the parent.** Each is a second record
  that has to be kept in sync with the refs. The ref name already carries the base, so the
  refs alone are the record, the same reasoning #581 used for the lane reservation.
- **Letting a caller build the chain with plain git.** That would put a second writer on
  trunk and drop colab's evidence, claim release and lane hold.
