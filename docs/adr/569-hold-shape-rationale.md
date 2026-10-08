# A hold declares its shape: why, with the measurement

The rule lives in [`CONVENTIONS.md` §5, *Holds*, *The `shape:` field*](../../CONVENTIONS.md#the-shape-field--what-the-owner-is-asked-for-569).
This file holds its rationale.

## Three different asks shared one form

A `Hold:` line said who clears the hold (`owner:`) and what ends it (`wake:`). It did not
say what kind of thing the owner was being asked for, and three different things shared
the same form:

- **a choice**: pick one of several ways forward;
- **a chore**: an act only a person can perform, such as running a privileged script,
  signing, or supplying a credential;
- **a wait**: on a third party, another piece of work, or a date.

Tools that render an owner's queue inferred the kind from the wake: `wake: ruling` became
a decision card. Sessions write `wake: ruling` by habit for anything a person has to do,
so a chore read as a choice.

Measured on one installation: an owner's decision queue held 21 items. 3 were choices,
11 were chores and 7 were waits. None carried options or a default, so the owner could not
answer most of them in any meaningful way and skipped them. Of the 21 items, 18 were not
decisions at all.

## Why declared, and why a choice is never a bare hold

The wake cannot carry the kind: `ruling` is right for both a choice and a chore, because
in both cases the owner's act is what ends the hold. So the kind needs its own field.

A choice that arrives as a bare hold has no options and no default, which is why the
measured queue could not be answered. The handbook already had the shape for a choice:
`needs-decision` with a `decision:options` block (#126). A choice therefore goes there,
with a recommended option, and a bare hold is left for chores and waits.

## Why between `owner:` and `wake:`

The field had to be readable by a reader that does not know it, because readers outside
this repo already parse the line. Their pattern is `owner: (.+?) — wake: (.+)$`:

- after `wake:`, the field becomes part of the wake. The wake then falls outside the
  closed vocabulary, and the older reader reports a good hold as a stall;
- before `owner:`, the older pattern does not match at all;
- between them, the older reader's lazy owner match absorbs ` — shape: task`. The line
  still parses, the wake is read whole, and the owner text carries a visible suffix. That
  degradation is cosmetic.

## Why inference stays

Holds posted before the field exist and are not rewritten. Absent `shape:` keeps the old
inference (`ruling` → ask, anything else → wait), so no reader changes its reading of a
line it already parsed. An unknown value is reported and falls back to the same inference:
a typo must not silently move a hold into a different queue.
