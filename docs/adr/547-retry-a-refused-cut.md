# A cut refused by the CLI is re-tried by an hourly run that reads, never stores

## Context

`templates/release-auto.yml` cut a candidate on three triggers only: a green trunk CI run, the
daily schedule, and a manual dispatch. When `colab release cut --auto` refused because of a
defect in the CLI itself (a false positive in one of its checks), the fix reached the adopter
when its `HANDBOOK_REF` channel moved — and nothing in the adopter's repo changed, so no trigger
fired. Measured on one adopting repo: the fix was on the `next` channel 18 minutes after the
refusal, a person dispatched the workflow by hand about 2.5 h later, and the next scheduled run
was about 22 h away. Downstream work (a staging deploy, an edge test run) waited the whole gap.

## Decision

An hourly `schedule` entry, recognised by the `RETRY_RUN` job env (`github.event.schedule`
compared with that cron string), runs one extra step — *Retry a refused cut once the CLI
moved* — and lets the cut step run only when that step says `retry=true`. It answers `true`
when main's head carries no `v*` tag and either:

- the fetched CLI reached `HANDBOOK_REF` within `RETRY_WINDOW_MINUTES` (default 130): the
  date of the release tag at the CLI's commit, which is when a channel moved onto it, else
  the commit's own date (a plain branch ref); or
- the newest **other** run of this workflow at main's head concluded `cancelled`, or the run
  list cannot be read.

The hourly run never promotes and never finalizes; those stay on the daily run.

## Alternatives rejected

- **Record the refusal and read it back** (an uploaded artifact, a commit status, a git
  note). Each needs a new write surface — a new pinned action, `statuses: write`, or a ref
  that is a commit in a workflow that promises never to write one — to store a fact
  that can be re-derived. The tag date and the run list are already readable.
- **Cut on every hourly run.** The CLI would keep cadence windows, but a held head would
  be tagged sooner than the daily run tags it, and a standing refusal would be re-announced
  24 times a day. Retrying only when the CLI moved is the case the issue describes.
- **Gate on the commit date alone.** A channel can move onto a commit made hours earlier (a
  fix merged, then released later), so the commit date can predate the refusal it fixes.
  The release tag's date is when the channel moved.

## Consequences

- **The hourly run shares the `release-auto` concurrency group, and that has a cost.**
  GitHub cancels a *pending* run in a group when a newer one queues, so an hourly run can
  displace a pending run started by a merge. The cancelled-run branch exists for this case:
  the hourly run then does the displaced run's cut. Giving retries a separate group was
  rejected because two cuts could then race for the same `-rc.N`.
- Any move of the CLI earns one retry, whether or not the last verdict was a refusal. The
  cut is idempotent, so that retry is a no-op or the same verdict.
- The cron string sits in two places (`on.schedule` and `RETRY_RUN`); a test asserts they
  match. If they drift, the hourly run reads as a daily run and promotes and finalizes every
  hour, and the header says so at the EDIT point.
- The handbook's own `release-auto.yml` does not adopt it: it runs its checkout's CLI, so a
  fix to the CLI lands by a merge, and that merge fires the CI trigger.
- `CONVENTIONS.md` §6's paragraph on the template ("cut on a green CI run on `main`,
  finalize daily") and the `templates/README.md` row are still true, but they don't
  mention the retry. Both files were held by another live branch at the time, so a
  one-clause addition is left for after it lands.
