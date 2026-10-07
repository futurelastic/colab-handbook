# Readiness: why, with the measurements

Moved from [`CONVENTIONS.md` §5, *Readiness*](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why prose dependencies are not enough

measured: an epic tracking ~14 children by hand-edited checklist reported `subIssues.totalCount = 0`.

## The measured case of a shared file that every item must edit

The measured case was fixed this way: the index became a pointer to the per-item folders, and each item's status moved into that item's own file. The items then touch disjoint files and run in parallel, with nothing left to group.

## Why contention is recorded in the issue text

A scheduler that brakes on files reads that line, not a comment, so a collision written only as prose never reaches it.

## What was verified about `addSubIssue`

verified live against the GraphQL schema, not restated from memory —

## The measured lag of `issueDependenciesSummary`

Measured, within a single response: seconds after a `blocked_by` POST, `blockedBy.totalCount` read `1` while `issueDependenciesSummary.blockedBy` in the same payload still read `0`.

## What #279 measured about clearing `deps-checked`

, and piling it onto this label is what #279 measured going wrong: `code-triage` clearing `deps-checked` to keep non-startable work out of the ready column, at a rate where more than half of one repo's untriaged-looking backlog was actually triaged work misreporting as untriaged.

## Why the middle readiness value is not a second label

rejected: a second label (stale the moment the blocker's own state moves — narrower a hazard than it once was, now that `deps-checked` itself is monotonic (#279) and only ever goes stale on a genuinely new blocker, but still a hazard a read-time computation avoids entirely); deleting the edge once code is written (destroys a true fact, doesn't survive a revert).

## Why `deps-checked` is stronger than an empty graph

because a prose-only blocker is invisible to a mechanical read and visible to a reader.

## Why a mechanical check never writes `deps-checked`

that launders a weaker guarantee into a stronger one.

## Why no `readiness.marked` event fires for `--mechanical`

that event kind's payload means `deps-checked` specifically (#45, #46); emitting it here would be indistinguishable from the stronger claim.

