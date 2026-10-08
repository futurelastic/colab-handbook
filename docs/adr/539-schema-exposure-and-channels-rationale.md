# `exposure` and `channels`: why, with the measurements

Moved from [`project.schema.md`, *`exposure`*](../../project.schema.md#exposure--optional) and [*`channels`*](../../project.schema.md#channels--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## How the unchanged behaviour of undeclared repos was verified

verified empirically (a fleet-wide byte-diff), not merely designed for

## Why `released` shape 2 exists

This is this repo's OWN shape, and the old `tier: B` weld could never express it (`tier: B`
forbade a non-null `production` AND required `deploy: none`, but had no vocabulary for
"released to adopters, no server").

## Why `exposure` was sequenced after `room`

that definition points at nothing until `room` exists, which is why exposure was sequenced
after it

## Why `live`/`released` with `production: null` is not a finding

a rule that made it one would re-assert the "exposure means a server" defect this axis
exists to remove

## Why the falsifier is a warn, and why `self` gets none

a repo released years ago and dead since is truthfully `exposure: none` today, tag and all,
so this is a prompt to look again, not a contradiction proven

it claims a consumer set bounded by the room, and a tag or deploy script is perfectly
compatible with a team shipping to itself

## Why omission means undeclared, not `none`

a wrong inference here is worse than an honest "not yet answered," and it is the concrete
mechanism behind "lowering a repo's exposure is a human act, with no field that can override
it"

because every candidate value for an undeclared repo is a claim about the *absence* of a
consumer, which nothing here can verify

## Why `channels` is a list

A repo can genuinely have several channels open at once (a reviewed deploy workflow *and* a
machine-local post-merge hook *and* a tag adopters copy out of), and a scalar would force
picking the most visible one — the exact failure that produced this axis's finding.

## Why `procedure` and not `manual`

**Why `procedure` and not `manual`.** `deploy: manual` is a promotion-trigger claim (a human
runs a documented release procedure); `channels: [procedure]` is a "what runs this" claim (a
human builds/installs/restarts from a checkout). Reusing `manual` for both would restate the
same word for two different questions — exactly the conflation this axis exists to undo.
