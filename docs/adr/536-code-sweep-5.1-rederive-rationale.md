# code-sweep 5.1-rederive: why, with the measurements

Moved from [`skills/code-sweep/5.1-rederive.md`](../../skills/code-sweep/5.1-rederive.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The two incidents behind the end-of-run re-derive

Measured twice, on an `auto-trunk` repo with autopilot-spawned sweeps:

- A sweep started at 09:48Z and spent about 2.5 h on one group (rejected twice, with a
  ruling in between). At 11:30Z a different branch finished `code-wrap`: pushed, CI green,
  hand-off contract asserted. At 12:19Z the sweep reported the main checkout clean, wrote its
  cache record and went idle. It never saw the new candidate, which waited until a
  coordinator re-pinged the session by hand.
- The day before, a sweep deferred a candidate behind another candidate's in-flight work and
  ended with *"I'll carry on when the notification arrives."* Nothing sends that
  notification. The candidate waited until someone re-pinged by hand.

## Why the first incident stuck rather than just ran late

This is
the part that made the first incident sticky rather than just late:
