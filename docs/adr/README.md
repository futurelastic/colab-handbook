# `docs/adr/` — one file per architecture decision

This directory holds Architecture Decision Records — one file per decision,
never a single growing document and never sequential numbering. Same design
as `docs/gotchas.d/`, and for the same reason: a shared counter (`0001-`,
`0002-`, …) has no stable identity, so two parallel branches each adding
"the next one" pick the same number, and one silently loses its identity at
merge — with every existing citation to that number now pointing at
different content, and no error anywhere.

## Naming

`<issue-number>-<slug>.md` — the issue the decision was made under, then a
short slug. Example: `142-worktree-stash-collision.md`.

The issue number is the stable id. Citations elsewhere in the repo reference
the decision by this filename (or by issue number), never by a sequence
position — a filename never needs renumbering when a neighbour is added or
removed.

## Writing an entry

One file, one decision. The shape that has proven itself elsewhere (context /
decision / consequences — MADR-style, adapt freely):

```md
# <short title of the decision>

## Context

What forced this decision — the problem, the constraint, the trigger.

## Decision

What was chosen, stated as a decision, not a description.

## Alternatives rejected

What else was considered, and why it lost.

## Consequences

What this makes easier, harder, or is now true as a result.
```

**Append-only.** A new decision is a new file — never edit another entry's
file to extend or reverse it. A decision that gets superseded gets a *new*
file that says so and points back; the old one stays as the historical
record of what was actually decided at the time, which is the whole point of
keeping one.

## An existing sequentially-numbered `docs/adr/`, if this repo has one

Left exactly as-is — this is not a forced renumber. Only *new* decisions from
here on use the issue-keyed name. The old entries keep their `000N-` names
and their existing citations; nothing needs to change for them to stay
correct.
