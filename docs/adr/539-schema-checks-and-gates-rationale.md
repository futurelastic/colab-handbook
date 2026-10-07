# `room`, `branchPrefix`, `ci`, `live-env`, `tree-reuse`, `ship-gate-workflows`, `gate`, toolchain pins and validity rules: why

Moved from [`project.schema.md`, *`room`*](../../project.schema.md#room--optional) and [*`branchPrefix`*](../../project.schema.md#branchprefix--optional) and [*`ci`*](../../project.schema.md#ci--deliberately-not-a-field) and [*`live-env`*](../../project.schema.md#live-env--optional) and [*`tree-reuse`*](../../project.schema.md#tree-reuse--optional) and [*`ship-gate-workflows`*](../../project.schema.md#ship-gate-workflows-ship-ignore-workflows--optional) and [*`gate`*](../../project.schema.md#gate--optional) and [*Validity rules*](../../project.schema.md#validity-rules-what-the-audit-tool-checks) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## What `room` replaced

Replaces two things that were proxying it by coincidence: Issue language derived from repo
privacy, and `ceremony` standing in for "will anyone read the audit trail."

## Why `room` is never inferred

a wrong inference here is worse than an honest "not yet answered."

## Why `branchPrefix` is a descriptor field, not a flag

**Why a descriptor field, not a flag:** the pushed branch is a claim record every machine
reads, so whether it carries the prefix has to be the same answer for every session in the
repo. A per-call flag would depend on every skill and every human remembering to pass it.

## Why `ci` is not a field

A `ci:` field would let either drift from what already answers it, the identical failure
every other axis on this page exists to prevent.

## Why the hermetic run exists

Why the run exists: a test read its author's home config and a local fleet daemon. It was green
in every local wrap and red on every CI runner, and the red trunk then blocked the repo's sweep.
The lesson was written down in prose and the same class recurred two days later. Measured before
this key existed.

## What declaring `live-env` costs

The hermetic run costs one extra pass of the test step. Skipping it trades that for the
class of failure above, on every branch, forever.

## Why trunk may reuse a green branch run's tree (#493)

a squash merge lands exactly the tree its branch run passed, so re-running it adds no
information and holds runners the branches need

## Why runs of other triggers are set aside (#503)

Measured: four green, graded candidates parked ~30 min per landing behind a release run at
trunk's head.

## Why a skill calls `colab trunk-ci` instead of filtering runs (#463)

One such filter, "green when any run succeeded", read a sha green that ship had parked every
candidate on, and the red went unowned.

## Why `gate` can take its verdict from CI

Why: on shared agent workstations full local suites took 6–10 min and flaked on timeouts, while
the same suites took 2–7 min in branch CI on clean runners, and the hermetic rule doubled every
local run (sources: `CONVENTIONS.md`
[§4, *Branch CI*](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314)).

## Why `requirements.txt` is not a manifest

the alternative is a hardcoded version in CI, which is the exact failure this precedence
exists to prevent

## Why the `exposure: live` + `trunk: main` advisory is shipped

dormant by construction today (measured: this shape already fails the `exposure: live`
mechanism rule above, zero instances across 40 adopted descriptors), shipped anyway as the
one finding that names the remedy

## Why the `push-main` on Tier A wording changed

(The wording here previously promised an advisory that no code ever emitted, so what looked
like tolerance was in fact total silence — a doc describing behaviour the tool did not
have.)
