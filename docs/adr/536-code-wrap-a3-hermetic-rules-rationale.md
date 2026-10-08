# code-wrap a3-hermetic-rules: why, with the measurements

Moved from [`skills/code-wrap/a3-hermetic-rules.md`](../../skills/code-wrap/a3-hermetic-rules.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the toolchain home is pinned

The toolchain is what the tests run
**on**, not something they read: without the pin a rustup proxy in an empty `HOME` tries
to download a toolchain with the network off, and the verdict blamed the code for it.

## Why the hermetic run is a command and not a sentence

- **Why this is a command and not a sentence here:** a test once read its author's home
  config and a local fleet daemon. It was green in every local wrap and red on every CI
  runner, and the red trunk then blocked the repo's sweep. The lesson was written down in
  prose and the same class recurred two days later. Prose did not stop it; a gate does.

## Why a green branch-CI run may stand in

Why: on a repo whose
  suite takes 6–10 minutes locally and about 2 on CI, the local repeat was the largest single
  cost of a ship pass (up to 23 minutes of gate runs in one pass) and added no evidence the
  CI run at the same sha had not already given.

## The measurement behind running a long suite once

Two measured ship passes re-ran a 7-minute suite only for that.
