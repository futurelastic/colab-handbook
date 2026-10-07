# `ship-batch`: why, with the measurements

Moved from [`project.schema.md`, *`ship-batch`*](../../project.schema.md#ship-batch--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a malformed `ship-batch` fails the CI descriptor check

Failing in CI is the part that matters. The audit is something a person runs by hand, and
the fail-closed is silent. So without the CI step, an adopting repo raised the value to 5,
its CI stayed green, and every landing went back to serial until a ship dry run noticed.

## Why the cap is 3, deliberately

**Why the cap is 3, deliberately.** A red combined run lands nothing, and the members then
ship one at a time, each with its own sync run. There is no bisection step: that serial
fallback *is* the bisection, and it only stays cheap for a small N.

- **Cost of a red batch.** It grows linearly with N: the wasted combined run plus N serial
  cycles. At 3 that is four cycles, the same as a three-way bisect. At 8 it is nine, which is
  hours on a 27-minute CI.

- **Chance of a red batch.** It grows with N too: each member brings its own chance of a
  semantic conflict or a flake. So the bad case gets both more likely and more expensive at
  the same time.

- **Builds have to start again.** Trunk moving mid-run sends a batch back to be rebuilt
  ([§4](../../CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373), step 4).
  A wider batch spends longer being built and run, so more of its runs end up thrown away.
