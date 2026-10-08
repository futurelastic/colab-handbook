# code-ship b1a-branch-ci: why, with the measurements

Moved from [`skills/code-ship/b1a-branch-ci.md`](../../skills/code-ship/b1a-branch-ci.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the branch's own CI is read as well

A branch could therefore be red on the runner through every step of the ship
and never be stopped by one.

## Why the CI wait is bounded

A coordinator
  once stayed in one turn for 1 h 40 min, hand-polling `gh run list` for three branches,
  while two other candidates were already green at their head and merge-clean. A ship
  pass that never ends also keeps the repository's trunk lock, so no fresh pass can
  start either.

## Why colab ci-wait is the only way to wait

Measured over one hour on one fleet: ~88% of ~4,500 REST calls on the shared
  agent identity were hand-rolled CI waits — one sweep alone made ~1,500/h with two loops
  on the same run, and a loop that read a rate-limit error as "keep waiting" kept going —
  until the 5,000/h quota ran out and **every** agent's `gh` call failed for the rest of the
  hour.
