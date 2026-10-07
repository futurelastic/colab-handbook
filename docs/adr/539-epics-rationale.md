# Epics: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Epics — a container is not a start candidate*](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why an epic never carries `delivery:*`

**A container never carries a `delivery:*` label (#371).** It has no deliverable of its
own; its children do.

## Why an epic never carries a gate

**For the same reason, an epic never carries `needs-decision`, and never a
`decision:options` block.** A gate on something that never starts gates nothing.

## Why an unticked item blocks the close

...its body lists no unticked checklist item (`- [ ]`). An unticked item on an epic is work
someone listed and nobody filed yet, and closing over it would bury that work;

## Why a hand-written checklist is never closed this way

A hand-written checklist
with no native sub-issues is never closed this way, because a table of boxes running out
does not prove the work ran out (`code-ship` B2c).

## Why the `epic` label exists

An epic still gets closed and referenced exactly as any other issue once its
children finish — the label only prevents a driver from mistaking the map for the
territory.

## Why not every checklist is an epic

...is a normal issue with a to-do list, and splitting it would be
pure overhead.
