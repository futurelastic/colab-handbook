# Shared files start in parallel; only same logic groups, only coupled paths hold a start

## Context

Since the grouping rule was written, the handbook said that issues touching the same files
must move on one branch, and triage's §5 file gate kept an issue off READY while any live
branch wrote a path it would edit. A session orchestrator following the handbook therefore
serialised same-file work by hand, and on prose-heavy repos (one normative document, one
skill tree) that meant most of the backlog queued behind one file.

Owner ruling, 2026-10-19 (#630): issues that merely touch the same files may be worked in
parallel. Evidence gathered for the ruling:

- Across published studies, 3–19% of merges conflict textually.
- In one measured repo, only ~6% of merges sharing a file conflicted — about 17 blocked
  pairs for every real conflict.
- No verified industry merge system blocks the *start* of work on file overlap; they check
  at integration (trial merge, merge queue, landing order).

## Decision

1. **A collision is two issues that change the same logic, or one that needs the other's
   unmerged code.** A shared file alone is not a collision. It is reported (`overlap:`),
   and both issues start. Integration settles the rest: a trial merge, then landing order and
   a rebase at ship.
2. **Grouping keeps its whole contract for true collisions** — one `group:<key>` label, one
   branch, triage prevents and names a second branch, ship lands members one at a time. ADR
   316's failure was a logic dependency (branches pulling each other's unmerged fixes), not
   a shared file, so its enforcement stands unchanged.
3. **`contention.coupled`** (`project.schema.md`) lists the paths — migrations, a schema, a
   public API contract — that no two live branches may edit at once. It is the only
   path-keyed start brake.
4. **Triage's §5 file gate is narrowed, not retired.** It still holds an issue whose own work
   already has a live branch. Its file half now holds a start only on a `contention.coupled`
   path. The ask left this open; the ruling's "an orchestrator holds starts only on these"
   settles it, and triage is that holder inside this repo.
5. **The hot-file step keeps its mechanism.** It counts what the file gate holds, so it now
   fires only on coupled paths, where a queue still forms. `thresholds.hot-file-count` is
   unchanged.
6. **`Touches:` stays as a hint**, and triage still appends a measured live-branch path to it.
   It informs a reviewer and the trial merge. It no longer brakes a start.

## Alternatives rejected

- **Retire the file gate entirely.** That would leave nothing reading `contention.coupled`
  in this repo, so migrations would start in parallel too. Two migrations racing for the
  same sequence is exactly the case where a conflict surfaces after deploy, not at merge.
- **Keep the file gate as it was.** It contradicts the ruling, and it costs the measured
  ~17 blocked pairs per real conflict.
- **A flat `contention-coupled:` key.** It would need no reader change. But the ruling named
  `contention.coupled`, and an orchestrator in another repo implements against that name.
  The audit's reader now takes an inline list under `contention:` only. Every other map
  still refuses lists.
- **"A shared file every unit must edit is a design defect — fix the file before grouping"**
  (#371). Dropped as a rule. With parallel starts, such a file no longer serialises anything,
  so it stops being a defect of *process*. If it causes real conflicts at landing, the
  hot-file step — for coupled paths — or an ordinary refactor issue answers it.

## Consequences

- More branches touch the same file at once, so ship sees more rebases. `colab ship`
  already lands one branch at a time against a re-fetched base. Landing order and a
  trial merge are the integration check.
- `colab holders <path>` keeps its meaning (who has unlanded edits on a path). Its non-empty
  answer is now information, not a stop.
- Superseded in part: [316 grouping incident](316-grouping-measured-incident-rationale.md),
  [539 grouping rationale](539-grouping-rationale.md) (the file-overlap trigger). The
  enforcement design in
  [316 enforcement](316-group-serialisation-enforced-at-triage-and-ship.md) is kept; its
  "no skill here polls" bound and its 6-of-6 path-keyed false-positive measurement are why
  triage, not a live check, enforces a group.
