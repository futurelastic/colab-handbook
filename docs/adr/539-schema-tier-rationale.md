# `tier`: why, with the measurements

Moved from [`project.schema.md`, *`tier`*](../../project.schema.md#tier--optional-legacy) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why A/B/C are labels, not grades

Read naively `C` looks like a worse `B`, but `B` has no production at all — a tier B repo
cannot break anything for users, because there are no users.

## Why the normal adopt path never writes `tier`

and a redundant key a later hand-edit can contradict is exactly the drift this axis exists
to end

## The breaking change behind the axis of record

This is the breaking change the major version bump names.

## Why a bare `tier: B` derives `null`

(`none`, `self` and `released` are all measured under `B` in this fleet)

## What the no-axis finding replaced

This replaces the old unconditional "missing key(s): tier" — `tier` left the required-key
list in this unit, because `exposure` alone is now a complete answer.

## Why `exposure` did not become required

16 of 17 repos in this handbook's own fleet have never declared it, and they see zero
change: the legacy read reproduces pre-#144 behaviour byte for byte.

## Why `tier → exposure` is a function, not a bijection

Why `tier → exposure` is a **function, not a bijection** — `A → released` holds, but
`released → A` does not: `released` covers two legal shapes, a tag deploying to a live
server (the historical `tier: A` shape) and adopters copying files out of a tag with no
server at all (this repo's own shape). A descriptor that answers with `exposure` is
answering a strictly more precise question than one that only ever answered with `tier`,
which is why it is trusted first. Full precedence code and rationale:
`tools/lib/axis-authority.js`.

## Why trunk, production and deploy are worded in `tier`'s vocabulary

The three fields that follow are worded in `tier`'s vocabulary because that was,
historically, the only axis that constrained them, and the wording is kept for the
descriptors that still speak only `tier`.
