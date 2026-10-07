# code-ship b1c: why, with the measurements

Moved from [`skills/code-ship/b1c-reject-classes.md`](../../skills/code-ship/b1c-reject-classes.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The 35 rejects at one tier

A human wasn't blocking any of it; nothing was
routing around a tier that had already failed repeatedly. Waiting for a person bought
nothing there.

## The prompt that stalled an unattended lane (#328)

Measured 2026-09-11 on an `auto-trunk` repo, in a ship session autopilot had spawned:
the grade found that the rework added a network poll outside the repo's three
human-ruled network openings. The coordinator then stopped on an interactive prompt
offering two options. **1 (Recommended)** was to move the refresh onto the path the
repo had already budgeted for and delete the new slot, with no boundary change.
**2** was to have a human rule a fourth opening. Option 1 only applied a ruling the
repo already held. Only option 2 needed a human. The session waited on the modal
anyway. The dashboard parked the stage (`waitingOn: prompt`), and two green
candidates queued behind it until another session read the prompt and typed `1` by
hand. On an unattended lane an interactive prompt is a stall with no timer. The
reject was right. Asking a question the coordinator had already answered was the
mistake, the same one *`decision` is the default* above argues against, one level
up.

## Why `rework` is its own token (#406)

Before it
existed both comments carried `reject-decision`, and the only difference was in prose
no reader may parse, so one adopter's router had to keep its ship-grade lane dark
rather than send human-waiting work back to the author.
