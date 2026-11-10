# CI wait bounds are measured from the repo's own CI, scaled by one declared factor

Issue #559, under the repo-owned thresholds epic (#558).

## Context

Every CI wait was a fleet-wide constant, and two of them disagreed. The skills passed
`--timeout 15m` to `colab ci-wait` everywhere, while `ci-wait`'s own default was 45 minutes,
so a caller that omitted the flag silently waited three times as long. Repos' CI ranges from
a few minutes to nearly half an hour. A slow repo deferred nearly every landing at 15
minutes, and a fast one waited far past its run. The epic's rule is that a threshold
depending on a repo's nature comes from that repo: measured from its history, or declared
in its `project.yml`.

## Decision

**What is measured.** For each clean first-attempt green sha, `colab ci-profile` takes the
wall time from the first verifying run's creation to the last one's finish. That is exactly
the wait a session sits through: "every run at the sha has finished". It reads the same run
set `ci-wait --sha` waits on (`verify-runs.js`), split into branch runs and trunk runs, over
the last 30 days. Re-runs (attempt > 1), red shas and unfinished shas are not samples: a
re-run measures an incident, and a red run measures how fast something failed. A branch
group at a sha that is also a trunk sha is dropped, because a branch cut moments ago re-runs
trunk's content in seconds.

**What is declared.** One number, `ci-wait-factor` (≥ 1, default 2). Duration is not a
declaration (`ci` stays not-a-field). Only the patience is.

| bound | derived | bootstrap (no history) |
|---|---|---|
| branch / trunk CI wait (B1a, the post-sync re-run, B2a's trunk cap, `ci-wait`'s default deadline) | 2 min + factor × p95 of that kind, rounded up to the minute | 15 min |
| wedged-run age (`colab ship`) | factor × the longer wait, never above 6 h | 6 h |
| empty-read grace (`colab ship`) | factor × the trunk push → run p95, never below 2 min | 10 min |
| zero-jobs floor | a documented default | 2 min |
| poll backoff | 30/60/120 s, stretched in proportion to a wait past 15 min | 30/60/120 s |

- **The 2-minute term** is the platform's job-materialization window (ci-verdict's zero-jobs
  floor). It is the one constant that is not about the repo, and it keeps a 20-second CI from
  producing a wait shorter than the time a run can take to appear at all.
- **Bootstrap equals today exactly.** A kind with fewer than 10 samples keeps its pre-#559
  value, so nothing changes for a repo until it has history (the epic's option (a)).
  `ci-wait`'s bootstrap default moves from 45 to 15 minutes, which is the one-source fix.
  Every skill already passed 15m, so only bare callers see a change, and a TIMEOUT is a
  defer (exit 3), never a verdict.
- **Safety limits only tighten.** The 6 h wedge age is the hosted-runner job limit, so
  measurement may lower it and never raise it. The 30/60/120 s schedule is a REST-quota
  floor, so measurement may stretch it and never speed it up.
- **The zero-jobs floor is not derived.** The run list carries no queue signal:
  `run_started_at` equalled `created_at` on every row measured. Sampling the jobs API would
  cost about 10 calls per refresh, for a value that only ever delays one signal by two
  minutes.
- **Caching.** The profile is cached per checkout for a day, in the git common dir. The
  bounds are recomputed from it on every read, so a changed factor applies at once.
  `colab ship` reads the cache and never fetches, so a verdict never waits on a history read.
  `ci-wait` with no `--timeout`, and `ci-profile`, refresh a stale cache. A failed refresh
  falls back to the stale profile, or to the bootstrap, and says so.
- **Skills omit `--timeout`.** Then `ci-wait` is the one source. The kind comes from the
  target: `--branch` equal to trunk, or a sha already on trunk, uses the trunk bound; any
  other branch uses the branch bound; a bare run id uses the larger of the two.

## Consequences

- Measured on this repo (2026-10-07): branch p95 3m37s and trunk p95 3m42s, so both waits
  are 10 min (from 15), the wedge age is 20 min (from 6 h), and the empty-read grace is
  2 min (from 10).
- Each machine caches its own profile, so bounds can differ slightly between machines.
  Accepted: every value is conservative relative to its own sample.
- The CI templates' descriptor check does not validate `ci-wait-factor` yet. That is a
  follow-up, because those templates are edited by other live work.

## Amendment — guard skips are not trunk samples (#706)

**What broke.** The trunk sample counted every clean green trunk sha. On a repo that ships by
squash merge, nearly every trunk run is the CI templates' `dedupe` guard (#418, #493) skipping
the suite, so the trunk p95 measured the guard. One adopting repo measured trunk p50 33 s and
p95 50 s against a branch p95 of 27 min, so its trunk wait was 4 min. A trunk run that does run
the suite (an untested tree, or a `gh run rerun --failed`) takes 15–20 min, and every
`ci-wait` on it timed out, which `code-sweep` §4.0 turned into a deferral. This repo had the
same shape: 47 of 47 trunk shas were guard skips (12–24 s), and the trunk wait was 3 min.

**The sample filter.** The run list has no job-level signal. So the refresh reads the check
suites of the newest 50 trunk shas, in batched GraphQL calls of 25 shas each. Each trunk run
takes its jobs from the suite that matches its `check_suite_id`. A run has the guard-skip
shape when exactly one job succeeded and every other job (at least one) was skipped. That is
`treeSkipCheckRuns`'s name-independent shape without the annotation test, because the #418
sha skip leaves no notice. A trunk sha leaves the sample when every green run at it has that
shape, and `colab ci-profile` names the dropped shas. Their push → run lag still counts,
because the lag is real either way. A sha past the cap is not counted, so the sample stays
the newest shas whose shape is known. A run whose read failed is kept, which is the pre-#706
reading.

**The floor.** Once the skips are gone, a squash-merge repo has only a few full-suite trunk
shas. Its trunk kind then falls below 10 samples and returns to the 15 min bootstrap, which
is still shorter than a 20 min run. So the trunk bound is never below a **measured** branch
bound: a full-suite trunk run runs the branch's suite. A longer deadline costs nothing when
the run finishes, because `ci-wait` returns as soon as it does. The only cost is that a
genuinely stuck trunk run is reported later. `ci-profile` prints the trunk's own bound next
to the floor.

**Cost.** Two GraphQL calls per refresh, once a day per checkout. Measured here, the refresh
took about 6 s longer. The first draft read one REST call per run, and spent 78 s on 60 runs
that covered only 25 shas. The cache version moved to 2, so profiles taken from skips are
read again. Branch runs are not read: their guard fires only on a ref's first push at an
already-tested sha, which `colab`'s claim refs (#550) no longer produce.

