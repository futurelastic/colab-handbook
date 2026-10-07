# code-ship b1b: why, with the measurements

Moved from [`skills/code-ship/b1b-harvest.md`](../../skills/code-ship/b1b-harvest.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The same failure mode as a bare `(#N)`

This is
the same failure mode as `(#N)`: issues sitting open with their code long since
merged (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).

## The incident behind the mechanical check, and why the downgrade failed

The incident that motivated
#74: an issue was closed by squash-merge with a third of its three-section
scope unimplemented — the sections were prose, so nothing could catch it.
#74's own fix — downgrading `Closes #N` to a silent `Refs #N` and shipping
anyway — turned out to still fail, just quietly: measured on one repo over
~8 weeks, 125 such downgrades against only 10 commits that ever declared a
remainder, so the redirect was reported but essentially never read.

## What stopping once per finished issue replaced

In one adopted repo, five
  finished issues sat open for days as `deferred:measurement`, and the person they
  were waiting on never saw them.
