# `§7 CI and toolchain`: why, with the measurements

Moved from [`CONVENTIONS.md` §7, *CI and toolchain*](../../CONVENTIONS.md#7-ci-and-toolchain) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a secret scan and a build are the floor

— a committed credential is the one failure that cannot be undone by reverting

## Why CI must trigger on the trunk itself

Measured: three repos whose trunks had moved to `dev` while CI still fired only on `[main, master]` — every trunk merge ran zero checks, silently.

## The ruling that retired the `writes`-keyed reading of CI (#233)

(⚖ #233 retired the `writes`-keyed reading this heading used to carry: `writes` is a veto now, not a method, so it no longer selects which CI role applies)

## Why a declared value never carried the pre-merge-gate fact

A declared value never carried this fact reliably — nothing audited whether a `serial-gated` repo actually ran one — and the gate itself is something the audit CAN see where it could never see a declaration.

## Why CI is provisioned for planned exposure

: the one day it is most expensive to

## Why test contracts follow the named consumer

A generator's internal tests passing proves nothing about what ships, if nothing names who actually consumes it.

## Self-hosted runners: the measured cost of copying a hosted flow unchanged (#355)

Measured on one busy repo with one self-hosted agent: a clean run did ~8.5 min of work, and runs under load took 48–52 min. Nearly all of the difference was queue time.

## Measured: interleaving jobs on one agent

Jobs from different runs interleave on it job by job: one trunk run's secret-scan job finished and its build job then waited **33 min** behind other branches' jobs.

## Measured: the check run twice in one job

Measured: a typecheck step, then the test script's own leading typecheck, run once per configuration (the switched-epic double run above) — **three** typechecks per build.

## Measured: more cores on a suite that is not CPU-bound

Measured: a 536-file batch that reported 4 went to 8, and the batch went from 170 s to 160 s, about 5 %. It was bound by something other than CPU, such as process spawn or disk.

## Measured: agent count versus core count

Agent count (above) was the lever for wall time; core count was not.

## Measured: the worker count that crossed the slot's memory cap (#478)

- Measured: a pool host went from 12 to 16 cores, and one repo's vitest went from
  11 to 15 jsdom workers per slot. That crossed the slot's ~5 GiB soft cap. The
  kernel throttled the job by reclaiming memory instead of killing it, so there
  was no OOM and no message saying why. Each slot logged over a million
  memory-high events and stalled for up to 24 min, imports took 4–28× their
  baseline, and tests timed out at 5–15 s. Trunk went red with no code change.
  The same suite had been green two days earlier, and longer per-test timeouts
  did not help.

## Why memory throttling looks like flaky tests

Throttling stalls every test the same way, so the failures look like flaky tests even though nothing in them changed.

## Measured: a runner disk at 99 %

Measured: the runner container's disk at 99 % was what blocked a second agent, not its memory.

## Measured: leaked temp dirs on a persistent runner

Measured: 5 000+ leaked dirs, 2.1 GB, in a `/tmp` shared by the agents of seven repos, where one repo's leak can fill the disk every other repo's CI runs on.

## Measured: restoring a hosted cache on a persistent runner

, and restoring GitHub's copy of it cost ~37 s per job

## Measured: a silent toolchain default

Measured: a silent default is how one repo built on Node 20 while deploying on Node 22, undetected for months.

## Measured: a Python repo with no template

Measured: a Python repo adopted the handbook, found no Python template, and copied the Node one with `python-version: "3.13"` hardcoded in.

## Why a test fixture neutralises ambient machine state

This handbook installs a global `core.hooksPath`; a fixture that `git init`s and `git commit`s without overriding it runs the developer's real pre-commit hook inside a fake repo. Measured twice, in the identical shape (ambient `gh` credentials, then `core.hooksPath`).
