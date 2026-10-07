# Branch CI: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §4, *Branch CI*](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the branch's own run is read

Measured, 2026-09-05: a branch sat red three times on its remote run while its wrap had
recorded a clean local gate, and no step between the implementer's wrap and the merge was
reading that run at all.

## Why a green branch-CI run can stand in for the hermetic run (#408)

Measured on this repo's own ship passes: the local
suite took 6–10 minutes per run and was repeated up to six times in one pass (23 minutes),
while branch CI ran the same tests in about 2 minutes.

## Why local is a smoke check and branch CI the one gate (#410)

Measured on shared agent workstations
(load ≈ 22 on 16 cores): full local suites took 6–10 min and failed on timeouts, then were
re-run, while the same suites took 2–7 min in branch CI on clean runners — and the #403
hermetic rule doubled each local run. No source recommends running the full suite both
locally and in CI:

- Fowler, *Continuous Integration* (2024 rev.) — the CI build is the final check; keep the
  commit build under ~10 min. <https://martinfowler.com/articles/continuousIntegration.html>
- *Software Engineering at Google*, ch. 23 (2020) — presubmit runs only fast, reliable tests;
  larger suites run after. <https://abseil.io/resources/swe-book/html/ch23.html>
- Humble & Farley, *Continuous Delivery*, ch. 7 (2010) — commit stage under 5 min, never over 10.
- Machalica et al., *Predictive Test Selection* (ICSE-SEIP 2019) — server-side selection
  halves cost and still catches > 99.9% of faulty changes. <https://arxiv.org/abs/1810.05286>
- Lam et al., *The Effects of Computational Resources on Flaky Tests* (2024) — 46.5% of flaky
  tests are resource-affected, CPU most. <https://arxiv.org/pdf/2310.12132>

## Why `stale-base` exists (#395)

Measured: one branch changed a shared test base class that a
  second branch's new tests also relied on; both were green, trunk went red on landing.

## Why the first push of a claim reads green from a guard run (#418)

Two shapes are
  deliberately not used. Skipping every job on `github.event.created` leaves a run whose jobs
  were *all* skipped; it concludes `skipped`, which is not green under the quantifiers above.
  Waiting in the guard for trunk's in-flight run holds the runner slot that run is queued for.

Measured before the change, across five adopting repos over 24 h: ~19% of all CI runs
  (~104 a day, ~660 runner-minutes) re-ran a trunk-tested sha on a freshly claimed branch.

## Why trunk reuses a green run of an identical tree (#493)

Measured on one
  adopter with a 35–55 min sharded suite on self-hosted runners: trunk's duplicate run took
  33–347 min wall time, most of it queueing behind branch runs for the same runners, and one
  went red on a timeout over a tree that had already passed.

## Why an unclassifiable red is `red:finding`

A wrong `red:finding` costs one hand-back to someone who can look; a wrong `red:infra`
  spends the one re-run and then parks the work in a lane nobody opened.

## Why a timeout is `red:infra` only if the host was loaded (#354)

Measured: two `Test timed
    out in 5000ms` failures in a file that took 498 s for 49 tests, on a self-hosted
    runner sitting at load 41 on 16 cores — re-ran green.

## Why a red base lets only the patch open a PR (#353)

Measured: a trunk went red on a docs-only merge — a test deferring against a
  hardcoded date that real time walked past, a calendar bomb, no branch's regression.
  Three branches waited reading one remedy; the one whose parent was the red sha and
  which fixed the clock opened a PR, ran green, and cure-merged; the two bystanders
  stayed parked until trunk was green, correctly.
