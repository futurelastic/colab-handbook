# Cure rule: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Cure rule*](../../CONVENTIONS.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Condition 1

A
ci-grant's evidence guard checks the branch's own head is green, but never
containment: a branch cut from an OLDER, green base can carry a green run that
proves nothing about the redness it is being exempted from.

## Condition 2b

A green run alone never proved the check trunk is failing ran
here: a `paths:` filter, a matrix change or a renamed job leaves the run green
while the named check never ran. *"The one check that was failing now passes"*
is the claim, stated exactly.

## Condition 3, progress admission

A trunk with two independent failures, or a fix
that repaired one of two red jobs, then heals by successive fixes with no human
step.

## Condition 5

The Node CI template does not hardcode what it measures: it asks
`package.json` whether `typecheck`, `lint` and `test` exist and **skips** each
step whose script is absent, and the job still concludes `success`. So
deleting `scripts.test` stops the failing suite from running without touching
a workflow file — the manifest is part of the instrument too.

## Condition 6

The
Python CI template runs ruff, mypy and pytest only when the tool is installed,
and what is installed comes from the files it installs from — so dropping
`pytest` from `requirements-dev.txt` skips the Test step and the job still
concludes `success`.

The whole file counts, not a block: in Python the dependency list *is* the
switch, and a tool can arrive transitively, which no block-level read can
measure.

## Condition 6, pin-only admission

That is
the answer to a pin dropping a transitively installed tool: steps up to trunk's
failure are covered by the step proof, steps past it were never reached on
trunk, so a skip there is unmeasurable and refuses.

## Order of checks

Conditions 5 and 6 come before 4 because the carve-out *admits*: a check placed
after it would never be reached by a branch touching both.

## Workflow carve-out (#321)

Worse, the human is measurably the wrong judge here: a
genuine repair and a "CI fix" that pins every job to a runner missing a shared
library read identically in a one-line grant prompt, and granting the wrong one
converts a 30-hour stall into a permanently red trunk. The CI evidence tells
them apart.

## Carve-out 4b

This is the
structural, primary sub-test: it embeds no constant and is symmetric with 4a
one level down. It is also why job-level `success` is not enough on its own —
GitHub reports a job whose steps were **all** skipped as `conclusion:
success`, so run- and job-level conclusions are blind to exactly the fast-exit
this catches.

## Carve-out 4c

The comparison is against a
measurement taken in the same repo, on the same job, on the same runner class,
minutes apart — so there is no repo-specific constant to tune. Measured case:
`browser` fast-failing at 36s pre-fix versus passing at 11m8s on the repair.

## Dry-run evidence (#474)

`release-auto.yml` fires after trunk CI or on a schedule, so 2b
refused every fix for a red in it (the job is absent on the branch), and a human
ci-grant was the only door, even for a mechanical defect such as a moved runner
label or a `HANDBOOK_REF` naming a missing branch.

It is also what keeps the dry run from being a back door: a red **inside** a
`[publish]` step can never be cured this way, because the dry run skips exactly
that step.

A dry run that also skipped an ordinary step past trunk's failure point
has run part of the job, not the job.

The marker is a step **name** on purpose. Steps are matched by exact name, so
marking the very step that failed on trunk renames it, and D2 then reads it as
absent and refuses. A list declared inside the workflow would be read from the
branch, which is the party being graded.

## Dispatch evidence (#510)

The workflow runs on a branch push, but one of its **jobs** is trunk-only by
its own `if:` — true on trunk, on a schedule and on `workflow_dispatch`, false on a
branch push — typically a long end-to-end suite moved off the branch path to keep
branch CI short. The fix branch's push run is green with that job `skipped` (or,
for a matrix, the red shard absent), so 2b refuses and only a ci-grant remained.
A `workflow_dispatch` of the same workflow on the branch runs the job.

## Dispatch evidence (#510), W1

Ids are per workflow file and the same on every ref; display names are not
unique.

## Dispatch evidence (#510), W5

Deliberately not the full executed-step
superset (D2/4b): a cache-conditional step that ran on trunk is skipped on a
cache hit, which would refuse genuine cures.

## Why the door needs no human step

Conditions 1+2 together mean the branch's tree passed the full suite **including
the tests trunk is currently failing** — merging it provably turns trunk green.
That is the one thing the human click on a ci-grant is supposed to certify,
mechanically checkable instead — which is why this door needs no `COLAB_HUMAN=1`,
no label, and no tracker comment: nothing here is a human write.

## Honest limits and accepted false refusals

- **Honest limit, not glossed over:** test-file self-weakening (gutting the failing
  tests to go green) is invisible at this gate either way — check-runs name jobs,
  not files. Condition 4 closes only the adjacent, checkable door (weakening the CI
  config itself); content weakening is caught where it is caught today — review/grade
  time, downstream of ship.
- **The carve-out's own honest limit, in the same register:** it proves the red
  jobs still exist, still ran the steps they ran on trunk, and still cost at
  least the wall time the failure did. It cannot see what those steps
  **asserted**. A workflow edit that preserves every step name and every second
  of wall time while weakening what the commands actually check passes this door
  — the same content-blindness above, moved one layer down into the workflow
  itself. What it closes is the structural form: deleting, renaming, `if:`-ing
  away, or fast-exiting the job trunk is red on.
- **Two known, accepted false refusals — both fall through to the ordinary
  ci-grant, which is the safe direction.** (i) A trunk job that failed by
  **timeout** or hang ran *longer* than any healthy green run, so 4c refuses the
  genuine repair; relaxing 4c for a `timed_out`/`cancelled` red job is a
  deliberately unmade decision — one `if`, and the obvious first follow-up the
  moment it is observed in the field, but adding it unmeasured is the
  speculative loosening condition 4 exists to resist. (ii) A repair that
  legitimately **renames** a job or a step fails 4a/4b, because the gate cannot
  distinguish a rename from a deletion. Expect this to be the most common benign
  refusal.
- **#297 adds more accepted false refusals, in the same safe direction.** (iii) A
  job with job-level `continue-on-error` that fails on trunk *persistently* is in
  the red set, so it refuses every cure; step-level `continue-on-error` (what the
  templates use) leaves the job `success` and is unaffected. Relaxing this is
  left unwritten for the same reason as (i). (iv) A workflow red on trunk that
  never runs for a branch (a deploy on push to trunk) has no branch counterpart,
  so 2b refuses — correctly: the branch cannot prove trunk will go green —
  **unless the workflow offers dry-run evidence (#474, above)**, which gives it one. (v) A
  red run with no job that can be named refuses on every path. (vi) Any nested
  `package.json` scripts change during a red trunk refuses condition 5 — unless it
  is add-only (#475). (vii) A job
  whose `name:` interpolates the event name differs between the push and the
  `pull_request` run, so 2b cannot match it.
- **#377 adds one more, same direction.** (viii) Any change to a Python dependency
  manifest during a red trunk refuses condition 6 — except a pin-only change that
  passes #476's step proof. Narrowing it to "a requirement name disappeared" stays
  unmade: a version change can drop a transitively installed tool. What #476 measures
  instead is whether any tool step was skipped where trunk never got to look, so a
  pin fixing a red that came *before* a step the repo never had (say, no mypy and
  the red in Lint) still refuses. Reasoning:
  [`docs/adr/377-cure-rule-python-dependency-manifests.md`](../../docs/adr/377-cure-rule-python-dependency-manifests.md),
  [`docs/adr/475-476-cure-rule-narrow-manifest-admissions.md`](../../docs/adr/475-476-cure-rule-narrow-manifest-admissions.md).
- **#510 adds three, same direction.** (ix) A workflow whose `run-name:` renames
  its dispatch runs, or whose matrix expands differently under `workflow_dispatch`,
  cannot be matched job for job. (x) A workflow whose dispatch needs required
  inputs fails the input-less dispatch; ship prints the command to run by hand.
  (xi) A dispatch run whose workflow id could not be read refuses rather than fall
  back to the display name.

## Instrument paths

Two instrument paths, two different doors. What is named once
is the carve-out *predicate*, never the path list. Why only 4a was hoisted to
every cure, and 4b/4c were not: [`docs/adr/297-cure-rule-instrument-manifest-and-named-check-evidence.md`](../../docs/adr/297-cure-rule-instrument-manifest-and-named-check-evidence.md).

## Containment

- **Containment costs a fresh CI round, by design.** Requiring the red sha in the
  branch forces a rebase onto red trunk, which moves the branch head and
  invalidates any prior green run — every cure pays one CI round at the new head.
  That is the price of the proof, not overhead to trim.

## Trailer

This is not decoration: anti-stacking
permits **one** exemption per continuous red episode (more only on progress,
condition 3), so a later reader
has to be able to tell which door spent it — a cure that went through the
widened door on a branch editing the CI config is a materially different fact
from an ordinary one, and the commit is the only artifact that still says so
after the runs age out.

## Group branches

- **Group branches get simpler under this door.** A ci-grant on a group branch
  requires a valid grant on every member issue; the cure's evidence is branch-level,
  so the all-or-nothing-per-branch property holds with zero per-issue paperwork.
