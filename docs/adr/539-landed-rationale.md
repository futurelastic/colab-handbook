# Has it landed: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §4, *Has it landed?*](../../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Has it landed: why the rule asks the base's tree directly

Both measured on live
worktrees in a single sweep. Requiring both still leaves a gap — a squash *followed by*
base movement satisfies both (five of seven shipped branches in one repo were in this
state).

## Has it landed: the red-base advisory (#293)

Measured: three branches cut from one identical red base sha;
two drew a green run of their own and shipped unchallenged, one drew red and cost a
coordinator a hand diagnosis — none of the three touched the failing harness, the
differing verdicts were a flaky test on the base.

The dangerous case is the GREEN
one: it currently looks safest of all, which is exactly backwards.
