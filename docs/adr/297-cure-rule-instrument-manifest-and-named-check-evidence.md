# The cure rule proves the red check passes, and treats `package.json` scripts as instrument

## Context

The cure rule (#281) lets a branch merge into a red trunk with no human
attestation. It can do that because it measures the fact a ci-grant only asserts:
the branch contains the red sha **and** is green at its own head, so its tree
passed the suite trunk is failing. Its condition 4 refuses a branch that edits
`.github/workflows/**`, because a branch may not weaken the instrument grading it
and then present the result as proof.

#297 found two places where the rule did less than it claims.

**The instrument is wider than the workflow directory.** The Node CI template
does not hardcode what it measures. Its "Detect optional scripts" step asks
`package.json` whether `typecheck`, `lint` and `test` exist and **skips** each
step whose script is absent. A skipped step leaves the job `success`. So removing
`scripts.test` stops the failing suite from running at all, touches no workflow
file, and satisfies containment, evidence and condition 4. The likely path is not
malice: it is an ordinary refactor of the `scripts` block that happens to land
while trunk is red. The gate could not tell that apart from a cure. The cost is
amplified: anti-stacking allows one exemption per red episode, so a false cure
leaves trunk red **and** closes the cure door for the real fix.

**Evidence was run-level.** Condition 2 read a single run conclusion. It never
checked that the check trunk is red on ran on the branch and passed. A `paths:`
filter, a matrix change or a renamed job can leave a run green while the named
check never ran.

While planning, three fail-open paths turned up in the same code, all of the
same kind:

- the diff was read with `git diff --name-only`, which has rename detection on
  and lists only a rename's new path. Moving `.github/workflows/ci.yml` out of the
  directory therefore read as not touching workflows;
- a failed diff read fell back to "nothing touched";
- the branch's job evidence came from the one green run the evidence read picked.
  That was harmless while only the carve-out used it. Applied to every cure, it
  would make a red job in a sibling workflow read as "absent on the branch".

The maintainer ruled on 2026-09-25 to adopt both proposed changes. Both make the rule
stricter.

## Decision

**Condition 2b.** On every cure, every job that is red on trunk's runs at the red
sha must exist in the branch's runs at its own head, completed and concluded
`success`. This reuses #321's `redJobsProvenOnBranch` (sub-test 4a) rather than a
second reader, so the two cannot drift apart. Supporting changes:

- the branch side reads **every** run at the head, not the one picked row;
- jobs are matched on **workflow name plus job name**. Over a union of runs, a
  bare-name match would let a passing `test` in one workflow stand in for a failed
  one in another;
- a job seen twice at one sha passes only if no instance failed and none is still
  in flight. Cancelled plus success passes; failure plus success refuses.

**Condition 5.** The branch diff must not change the `scripts` block of any
`package.json`. It is a new, separate parameter and block, with **no carve-out**,
exactly as #321 asked. The rules for what counts:

- any `package.json`, at any depth;
- scripts compared as canonical JSON, so reordering keys is not a change and
  editing a command is;
- a manifest added, deleted or renamed counts;
- a manifest that does not parse, or is not a plain file, is unmeasurable, and
  unmeasurable refuses.

It is checked **before** the workflow block. That block returns success when the
carve-out admits, so a check placed after it would never be reached by a branch
that touches both.

**Diff measurement moved into `tools/lib/cure-diff.js`.** It reads with
`--no-renames` and returns `null` on any unmeasurable input. `cureVerdict` refuses
on `null`. This is the same git-injected shape as `docs-only.js`, so the tricky
cases are tested against real repositories.

The verdict order is now: containment → 2a (run green) → 2b (red jobs pass) →
anti-stacking → diff measurable → 5 → 4 with its carve-out. On success the
verdict carries `provenJobs`, and so does `ciCure.provenJobs` in
`ship --dry --json`.

## Alternatives rejected

- **Widen `workflowsTouched` to cover `package.json`.** This would let a scripts
  change through the #321 carve-out. That door's evidence (job names, executed
  steps, wall time) cannot see a scripts weakening, which happens inside a step
  whose name and conclusion do not change. Two instrument paths, two doors.
- **Hoist 4b and 4c to every cure as well.** The executed-step superset refuses
  genuine cures often on the ordinary path. A cache-conditional step that ran on
  trunk is skipped on a cache hit. A push-only step that ran on trunk is skipped
  on the `pull_request` run a branch often offers as evidence (#353). It would
  catch the scripts case, but condition 5 already does, without these costs.
- **Root `package.json` only, or find the one manifest by parsing the workflow's
  `working-directory`.** The working directory is an adopter's edit point and
  workspace runners read nested scripts. Parsing adopter YAML to pick one
  manifest is brittle, and it fails in the open direction. A false refusal on an
  unrelated nested manifest falls through to ci-grant, which is the safe
  direction.
- **Refuse only when `typecheck`/`lint`/`test` disappear.** Editing the command
  (`"test": "true"`) is the same weakening under a name that still exists.
- **Adopt "every check-run must pass" semantics, as some consumers fold them.**
  That would refuse a genuine cure because of an advisory failure that exists only
  on the branch. The predicate chosen, "the one check that was failing now passes",
  is narrower than both run-level green and fold-every-check. It is scoped to
  trunk's red set, so the two readings do not fight.

## Consequences

- **New accepted false refusals, all falling through to the human ci-grant:**
  - a job-level `continue-on-error` job that fails on trunk persistently. The
    templates use step-level `continue-on-error`, which leaves the job `success`,
    so they are not affected;
  - a trunk-only workflow that is red at the red sha. This is a correct refusal:
    the branch cannot prove trunk will go green;
  - a red run with no job that can be named;
  - any nested manifest scripts change during a red trunk;
  - a job whose name interpolates the event name.

  The `continue-on-error` relaxation is left unwritten deliberately, in the same
  spirit as #321's `timed_out` one. Its predicate would be: the branch job is not
  `success` inside a run that concluded `success`, with workflows untouched.
- **Cost.** A cure attempt past containment and 2a now makes one `gh run list`
  per side and one `gh run view` per run read. This happens only on the red-trunk
  path. A green-trunk ship makes none of these calls, and neither does a branch
  that already failed containment or 2a.
- **Out of scope, same class of hole.** The Python CI template's "Detect optional
  tooling" step skips the test step when `pytest` is not declared. Neither 2b nor
  condition 5 sees that. It is filed as a follow-up. The Laravel template fails
  closed and is fine.
- **Honest limit, unchanged:** test-file self-weakening is still invisible at this
  gate. Check-runs name jobs, not files.

Builds on
[`321-workflow-carve-out-measures-execution-not-duration.md`](321-workflow-carve-out-measures-execution-not-duration.md).
