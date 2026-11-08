# Two template steps a dry run always skips are admitted by name

## Context

D3 (#474) says every step a dry run did not run to success must be a skipped
`[publish]` step. Later template work added steps a dry run skips for other
reasons, and no check connected the two:

- `Retry a refused cut once the CLI moved (#547)` runs only on the hourly retry
  run, which is a schedule. A dispatch never runs it.
- `Start the heavy lane at the new candidate` needs a tag, and a dry run hands
  none on.

So D3 refused every dry run of the unmodified template, and #474's door was closed
for any repo on that template. The refusal was observed on a cure branch for a
trunk whose hosted runners refused every job.

## Decision

- **D3 also admits those two steps, by exact name.** The names are a constant in
  `tools/lib/ci-cure.js`. `Finalize the newest clean candidate` is not on the list:
  it runs in a dry run unless the heavy lane is not green at the candidate, and a
  dry run that skipped it has not run the job. That still refuses.
- **The late-skip test (#476) exempts the same names** on a dry run, because it
  relies on D3 having refused every other skip.
- **4c is not relaxed.** ADR 474 said a zero-step red has no usable duration. Measured
  on fleet trunks: all 27 red jobs with no steps had a positive duration. The 20 with
  no runner assigned had 2 to 6 seconds, the 7 with a runner had 8 to 782 seconds, and
  none had 0. A branch's real run clears that floor, so the relaxation is not needed.
- **A zero-step red gets one new test on the carve-out.** 4b compares against the
  steps that ran on trunk, so it has nothing to compare here. GitHub reports a job
  whose steps were all skipped as `success`, which is the reason 4b exists. So the
  branch's job must show one step of its own that ran, not counting the runner's
  `Set up job`, `Complete job` and `Post` steps.
- **A template test classifies every conditional step in the release job.** A new
  step with an `if:` fails it until someone decides how a dry run reads that step.
  That missing check is how #547 closed the door without anything going red.

## Why these choices

- **Not "also skipped on trunk".** Steps past trunk's failure point are always
  skipped on trunk, and on a zero-step red every step was. That admits exactly what
  D3 refuses.
- **Not a second name marker.** It changes the template, so it helps nobody until
  each adopter syncs, and the issue asks for the unmodified template to pass.
- **Not leaving out the runs `colab trunk-ci` sets aside (#503).** Trunk's verdict
  ignores a post-CI release run, yet the cure rule still asks the branch to prove
  it, so the two disagree. They stay that way: the cure rule is the stricter one,
  and a branch that moves the release workflow's runner should show that workflow
  still runs. The same red-job read also feeds the progress admission (#477) and the
  reviewer grant's cures.
- **A list in the CLI, despite ADR 474's objection.** That ADR rejected a fixed set
  because it breaks on the first adopter edit. Here a break means a refusal, which
  falls through to a ci-grant, and it needs nothing from any adopter. The list is
  also not read from the branch being graded.

## Limits, stated

- A branch that edits its workflow can rename a step to a listed name, as it can
  append `[publish]` or gut a `run:` body. This is the carve-out's stated blindness
  to content. D2 still refuses for any step that ran on trunk.
- A red on a run where a listed step ran on trunk still refuses. D2 requires the
  step to pass in the dry run, which skips it. A red in the cut step of a retry run
  is a false refusal of this kind, left unmade until it is observed.
- A zero-step red with equal or missing timestamps still refuses at 4c.
- The measured sample is the trunk failures visible on 2026-11-08. The run behind
  the original refusal was not among those identified.
