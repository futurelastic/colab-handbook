# A park needs its own carrier: why

Moved verbatim from [`CONVENTIONS.md` §5, *Disposition — a park must name its wake condition (#279)*](../../CONVENTIONS.md#disposition--a-park-must-name-its-wake-condition-279) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why deps-checked cannot carry a park

`deps-checked` (above) is monotonic: it records that triage looked, nothing more. That
leaves a real fact with nowhere to live — an issue can be ready, evaluated, and still not
startable *right now*, for a reason that is not a blocker on another issue and not a
question for a human. Before #279, `code-triage` expressed that by clearing
`deps-checked`, which silently reused the "nobody has looked" state to mean "somebody
looked and parked it" — the two became indistinguishable to any later reader, including
another triage pass.

## How deferred generalises the Ask line

This generalises the `Ask: … | deferred(<trigger>)` line (*Ask*, above) beyond
`agent-filed` issues and gives it a machine-readable carrier: that line is free text,
scoped to filing time, and mechanically ungrepped anywhere in this repo's own tooling;
`deferred:<kind>` + `review-by:<date>` is a label pair any consumer can query and act on
without parsing prose.
