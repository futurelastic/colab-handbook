# Room and Exposure: why

Moved from [`CONVENTIONS.md` §2, *Room* and *Exposure*](../../CONVENTIONS.md#room--who-else-is-here) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Room: what the axis replaces

**Replaces two things that were standing in for it by coincidence, not by design.** Issue
language has been derived from repo privacy — private repos get the team's language,
public ones get English — which happens to track the room in the common case but is not
what the room actually asks: a private repo one person touches has a room of one, same as
if it were public, and the language that serves that room is whichever the person
actually thinks in, not whichever visibility setting GitHub happens to report.
[`ceremony`](../../CONVENTIONS.md#ceremony--narration-follows-the-room-recoverability-follows-exposure) has
also been proxying this: "will anyone ever read this repo's audit trail" was answered by
squinting at production status, when the honest question is who is in the room to read
it, independent of whether the thing is live.

## Room: why it landed first

**Landed first because the exposure axis is defined against it** (#132, below — exposure's
`self` value is the set of consumers that is a subset of the room's collaborator set; that
definition points at nothing until the room axis exists).

## Exposure: why not `prelaunch`

**`prelaunch` was rejected in favour of a relationship word.** An earlier candidate named this
axis by a *moment* rather than a *relationship* — the same defect the tier letters have in
miniature, one member of the set speaking a different language than the rest. It also implies
a public event many of these repos never have, and implies imminence for a state that has
already lasted months on more than one repo in this fleet. The intent it was trying to carry —
"not yet, but headed there" — already has a home: `production:`, which exists today.

## Exposure: the flip is invisible to a repo that never declared it

A repo that has never declared `exposure` sees
zero change — the legacy read reproduces pre-#144 behaviour byte for byte, verified against
the whole fleet, not merely designed for — so nothing in the fleet, and no outside adopter of
this public repo who has not opted in, breaks on this flip.

## Exposure: why the pairing advisory is a warn

Advisory, not failure, because the descriptor is not
*lying* (the `fail` severity is reserved for that — see the `tier: A` + `push-main` block
below), it is *unanswered*, and answering it is the human act above, explicitly out of scope
for this unit (Phase 3 of the epic, ten repos each answering "what would break if you merged
something wrong?", is not performed here). A `fail` would also make declaring the key riskier
than omitting it, suppressing exactly the opt-in adoption data a later unit needs.

## Exposure: what #132 and #144 shipped

#132 shipped the key, its
four-value enum check, and the `production:` pairing advisory — nothing that derived gate
count. #144 is the unit that flipped authority: `exposure`, when declared, now governs gate
count directly (see the top of this section, above), rather than merely being readable
alongside a still-authoritative `tier`. [CI's role and thoroughness](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
and the [rollback obligation](../../CONVENTIONS.md#recovery--what-must-exist-to-undo-a-merge) are now derived
— by later units reading this key, not by this one.

## Exposure: the deferred falsifiers

Three more named in #137 stay
deliberately deferred: a per-machine service definition serving the path (the schema
already ruled per-host facts out as a field), another repo's stamp naming this one as a
source (the stamp vocabulary has no way to name an arbitrary source yet), and a declared
`production:` target resolving in DNS (the repo-local half of that case is already the
pinned-clean "visibly transitional" shape below, and the resolving half needs network this
tool does not use). Reasons in full, and what would reopen each: `audit/README.md`.

## Exposure: #144 does not make the key required

#144 shipped the authority flip described
above; it deliberately does **not** make the key required — that stays phase 3.
