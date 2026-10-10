# `ship-batch`: why, with the measurements

Moved from [`project.schema.md`, *`ship-batch`*](../../project.schema.md#ship-batch--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a malformed `ship-batch` fails the CI descriptor check

Failing in CI is the part that matters. The audit is something a person runs by hand, and
the fail-closed is silent. So without the CI step, an adopting repo raised the value to 5,
its CI stayed green, and every landing went back to serial until a ship dry run noticed.

## Why the cap was 3, and why it is 8 now (#557)

**Until #557 the cap was 3, deliberately.** A red combined run landed nothing, and the members
then shipped one at a time, each with its own sync run. There was no bisection step: that
serial fallback *was* the bisection, and it only stays cheap for a small N.

- **Cost of a red batch.** It grows linearly with N: the wasted combined run plus N serial
  cycles. At 3 that is four cycles, the same as a three-way bisect. At 8 it is nine, which is
  hours on a 27-minute CI.

- **Chance of a red batch.** It grows with N too: each member brings its own chance of a
  semantic conflict or a flake. So the bad case gets both more likely and more expensive at
  the same time.

- **Builds have to start again.** Trunk moving mid-run sends a batch back to be rebuilt
  ([§4](../../CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373), step 4).
  A wider batch spends longer being built and run, so more of its runs end up thrown away.

**What changed.** The cap was a stand-in for two missing things, and #557 supplies the first
and measures the second.

- **Split-and-retry replaces the serial fallback** for a red batch of two or more. The same
  ref is rebuilt with the first half of its members; a red half splits again. One culprit in
  a batch of k then costs about 2·log2(k)+1 cycles — 7 at k = 8, against 9 for the serial
  fallback — and the gap widens with k. That is the point the literature puts the crossover
  at (bisection beats a serial fallback from k ≈ 8), and it is why 8 is the new ceiling rather
  than a larger number: past 8, the chance that a batch goes red at all grows faster than
  splitting saves. Halves run one after another, not side by side: one batch per base is what
  the lane hold, the rebuild rule and the declined-batch rule all assume, and keeping it costs
  one extra cycle per level rather than a second namespace.

- **Measured red rates.** `colab batch-stats --since 60d` across the fleet's batching repos,
  read 2026-10-10: three repos had batch history — 12 combined-run builds between them, **12
  green on the first attempt, 0 red**, 0 of 24 attempted members dropped at build, fills 3×1
  and 9×2. Two more repos had opted in but landed everything serially, with 51 of 103 and 90
  of 189 serial landings carrying a missed partner (another candidate already green). One
  repo's history could not be read. Zero reds in 12 builds is weak evidence — it bounds the
  per-build red rate below about 25% at 95% confidence (rule of three), and only at fill ≤ 2 —
  which is why the ceiling comes with **adaptive sizing** and no default steps: a repo that
  declares `ship-batch-steps` starts at its smallest step and earns its width one green batch
  at a time, and gives a step back after every red.

**The motivating case.** A repo's landing queue backed up to 8 wrapped branches. 6 of them
merged together cleanly, but the cap of 3 forced two combined CI rounds of 11–26 minutes each.
