# Ceremony and Recovery: why

Moved from [`CONVENTIONS.md` §2, *Ceremony* and *Recovery*](../../CONVENTIONS.md#ceremony--narration-follows-the-room-recoverability-follows-exposure) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Ceremony: the weld the old rule made

The rule required `production: null` for `light`, reasoning that a live
repo cannot skip its own audit trail. That conflates:

## Ceremony: why narration and recoverability separate

A live, single-operator repo whose only irreplaceable asset is a small state file cannot
skip recoverability, and gains nothing from full narration nobody in the room will ever
read; the old rule forbade the second and was silent on the first — catching neither
correctly, and pushing exactly this shape toward an informal, undocumented light mode
instead of a declared one.
