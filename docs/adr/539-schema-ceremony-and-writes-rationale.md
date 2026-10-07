# `ceremony` and `writes`: why, with the history

Moved from [`project.schema.md`, *`ceremony`*](../../project.schema.md#ceremony--optional) and [*`writes`*](../../project.schema.md#writes--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `ceremony` is its own axis

Tier answers "how many gates stand between a merge and users"; `ceremony` answers "will
anyone ever comb through this repo's audit trail" — two Tier B repos can be a heavy,
long-lived codebase and a disposable beta playground, and only this field lets the second
one stop paying full record-keeping cost for a record nobody will read.

## Why `light` skips the readiness ceremony

Coherent because `light` repos cannot be driven unattended (the coherence rule below), so
nothing consumes the column; an empty readiness column that nothing reads is pure cost.

## Why `light` never relaxes the shared-machine rules

A beta repo shares the same machine, session fleet, port space, and claim state as the most
serious repo.

## Why `light` no longer requires `production: null` (#175)

A prior rule required `light` → `production: null`, reasoning that a live repo cannot skip
its own audit trail. That welded two different questions together: whether a *trail* is ever
read (the room), and what must exist to *undo* a change (exposure/irreplaceable state) — a
`solo` repo's trail has one reader whether or not it is live, and a live `solo` repo that
cannot roll back is a real hazard regardless of how much anyone narrates. The rule forbade
the first case and was silent on the second, so a live single-operator repo could not
declare `light` at all — pushing that shape toward an undeclared, informal light mode
instead. Removed (#175);

## Why `light` is incompatible with `auto-trunk`

An unattended merge with no evidence trail is a closure nobody watched and nobody can audit.

## How `ceremony: light` stopped enabling solo flow

#133 introduced `writes: serial` as solo flow's real gate and accepted `ceremony: light` as
a LEGACY proxy only, for repos that had not yet answered the `writes` question. #175 removed
that bridge.

## Why the `writes` YAML block was reworked (#239)

The YAML block above is reworked by #239 to say so directly — "isolated (default)" was wrong
twice over (neither the default nor merely descriptive) — but the paragraphs and tables
below this note describe BEHAVIOUR, and state what is true today, not the retired
three-method reading.

## Why `free` has a name of its own

given a name of its own because the old prompt had to tell a human to "leave unanswered" for
it

## The retired `auto-trunk`/`serial-direct` narrative

**Retired: the `auto-trunk`/`serial-direct` narrative #208 and #224 argued over.** A
misgrant nobody could tell apart from `serial-gated`'s cell was the worry that motivated
splitting `serial` in the first place; #224 corrected the cell itself before this ruling
landed. Under ⚖ #233 there is only one coexistence cell, not two, so the distinction the
narrative was about no longer exists — see `CONVENTIONS.md`, *Writes*, for the one
sentence that survives it.

## The retired conservative-reading reason for resolving `serial`

2. ~~**The conservative reading on the one property that is actually dangerous.**~~
   **Retired by #224**, and moot after ⚖ #233 besides: the `auto-trunk` cell no longer
   varies by which legacy spelling is declared, so there is nothing left for this reason to
   protect against.

## Why reclassifying to `serial-gated` was once a human-only decision

Before ⚖ #233 this was a meaningful, human-only decision (`serial-gated` forbade solo flow
outright and made every unit branch).

## Why `writes` is not coupled to `tier`, `production` or exposure

The correlation seen across today's fleet is caused by *who works a repo*, not by *what
consumes it* — encoding that correlation as a rule would repeat the same weld `ceremony` was
introduced to undo.

for this reason
