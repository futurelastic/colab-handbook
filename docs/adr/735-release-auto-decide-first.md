# The release workflow rules "nothing to do" in a first job, and only where it can prove it

## Context

`templates/release-auto.yml` runs on CI completion (`workflow_run`), daily, and hourly (the #547
retry). Most of those runs find nothing to do. Each one still took a runner and paid the full
job setup before saying so: a full-history checkout, the colab CLI clone, and only then the
decision. Measured over 14 days across about 70 repositories, `Release (auto)` was the workflow
that most often re-ran at a commit it had already handled. One repository had 144 such runs, and
several had 100+ runner-minutes each. On a pool with few slots per lane, those runs queue in
front of real work.

Three things constrained the fix:

- **#435.** A run whose every job a job-level `if:` skips concludes `skipped`, and `colab ship`
  reads that as trunk not green.
- **ci-cure's dry-run evidence (#474, #694).** A dispatched dry run must still run the whole
  `release` job, sentinel step included, or the cure rule cannot accept it.
- **No toolchain, no CLI.** Whether a finalize, a promotion, or the npm or downloads sweep has
  anything due is the CLI's call. A job without the CLI cannot rule on it.

## Decision

A first job, `decide`, sets a `work` output. `release` runs only when `work == 'true'`, so `npm`,
`npm-record`, `deploy` and an adopter's downloads jobs skip with it, because they all need
`release`. `decide` is a **filter, never a second decider**. It says "no work" only where today's
`release` job is provably a no-op, and "work" whenever it cannot read what it needs:

| run | `work` |
|---|---|
| `workflow_run`, CI not `success` | false: nothing is cut at a red sha, and nothing else runs on this event |
| `workflow_run`, the tested sha carries `vX.Y.Z` or `vX.Y.Z-rc.N` | false: `cut --auto` there is a no-op (already-candidate, already-final, nothing merged since) |
| the hourly run | the #547 retry step's verdict. The step moved into `decide` under the same name, id and `if:` |
| the daily run, any dispatch | always true |
| a failed tag read, an unnamed sha, an unknown event | true |

`decide` uses a one-commit sparse checkout and `git ls-remote --tags` (peeled), and makes no
toolchain install. For the retry's "the CLI moved" date it uses a blob-less depth-1 clone of
`HANDBOOK_REF`, about 1.5 s and 140 KB. It has no job-level `if:` and no `needs:`, so it always
concludes success, and a run that skips every other job still concludes success (#435).
`RETRY_RUN` moved to the workflow-level `env:`, so both jobs read one copy of the hourly cron string.

## Alternatives rejected

- **Filter the daily run too.** Ruling that finalize, promotion and both sweeps are idle needs the
  CLI or a new verb (`release idle`). The daily run is one run a day, and the measured waste was in
  the frequent runs. If that ever changes, the new verb is a separate change.
- **Keep the retry step in `release` and repeat its logic in `decide`.** That would be two copies
  of one decision, which drift. Moving the step keeps its name, which ci-cure's
  `DRY_RUN_CONDITIONAL_STEPS` and the template tests pin. Adopters' older copies, with the step in
  `release`, are read exactly as before.
- **Move `concurrency:` onto the `release` job**, so that a no-op run neither waits in the group nor
  displaces a pending real run. That changes #547's displaced-run reasoning, and it is not needed
  for the cost fix. It is left as its own change.
- **Change the Forgejo twin.** `templates/forgejo-release-auto.yml` has no hourly run and no
  `workflow_run` re-runs, only one dispatch per green CI plus a daily run, and its wait step needs
  the CLI anyway.

## Consequences

- A no-op hourly or CI-fired run is one short job. The heavy job never starts.
- **Accepted delay.** If a route switches to `library-fast` or `deploy-tag-fast` while main's head
  carries only a candidate, a CI re-run no longer cuts the final there. The daily run does, within
  24 h.
- If `HANDBOOK_REF` cannot be fetched (a fork or mirror without the channel), every hourly run with
  an untagged head still runs the full job. That is today's cost, not a new one.
- `decide` needs a runner too, for seconds. On a private repo it belongs on the self-hosted class
  like `release`. The runner audit (`tools/lib/release-runner.js`) flags it when it is not.
- A red in `decide` is cured by a dispatch instance (ci-cure's W rules), not a dry run. Its steps
  run on a dispatch, except the retry step, which is the same stated limit that step always had.
- The handbook's own `release-auto.yml` does not adopt it. It has no hourly run, and a workflow
  edit there would put the change under the cure rule's workflow refusal.
