# A main-only workflow is cured by a dry run, matched step by step

## Context

The cure rule's 2b (#297) asks that every job red on trunk exists on the
branch's runs at its head and concluded `success`. That is the claim stated
exactly. But some checks never run on a branch: the release workflow fires on
`workflow_run` after trunk CI, or on a schedule. For a red there, 2b refused
every fix, because the job is absent on the branch. A human `ci-grant` was the
only door.

Measured: 3 of 6 grants in one day were for `Release (auto) / Cut, finalize,
publish`. Each fix was mechanical: the runner label moved to the self-hosted
pool, or a `HANDBOOK_REF` default named a branch that did not exist. A human
reading a one-line grant prompt was asked to certify something the CI could have
measured.

The template already declared a bare `workflow_dispatch:`. That made branch
dispatch *dangerous* rather than merely unhelpful: dispatched on a branch, it ran
promote, cut and finalize against `ref: main`, for real.

## Decision

**The workflow gets a dry-run mode.**

- `workflow_dispatch` gains a `dry_run` input.
- A dispatch on any ref other than `main` is dry whether or not the input is set.
- A dry run checks out the dispatched sha and persists no credentials.
- Promote, cut and finalize run with `--dry`. The CLI computes the same verdicts
  and writes nothing. Their names are stamp markers, so they keep running and
  keep their names.
- The steps hand no tag on, whatever the verdict says.
- The two publish-chain steps are renamed to end in `[publish]` and are skipped.
- The npm and deploy jobs need a tag, so they skip by construction.
- A sentinel step runs only in this mode. It is the one signal ci-cure uses to
  recognise a dry-run instance.

**ci-cure admits a dry-run instance as 2b/4a evidence under three rules.**

- **D1** — both step lists are measurable.
- **D2** — every step that ran on trunk, the failing step included, concluded
  `success` in the dry run.
- **D3** — every other non-success step in the dry run is a skipped `[publish]`
  step.

When a green ordinary instance exists, it outranks the dry one.

**`colab ship` dispatches the dry run once, on the real path only.** It
dispatches only when the 2b refusal would be cured by it and every later
condition already holds. The dispatch is gated on a static read of the branch's
copy: it needs a `name:`, the `dry_run` input and the sentinel step. Ship never
waits.

## Why these choices

- **A step-name marker, not a list.** It is checkable from the job rows the
  caller already reads, so there is no extra I/O and the module stays pure. It
  also protects itself. Steps match by exact name, so marking the step that
  failed on trunk renames it, and D2 then reads that step as absent. A list
  declared in the workflow would be read from the branch, which is the party
  being graded. A fixed set in the CLI breaks on the first adopter edit.
- **D2 is the "not a back door" proof.** A red inside a `[publish]` step is
  skipped by the dry run, so D2 refuses it. A dry run cannot cure a red in a step
  it does not execute.
- **D3 closes the remaining gap.** D2 constrains only the steps that ran on
  trunk. Without D3, a dry run could also skip ordinary steps after trunk's
  failure point and still pass.
- **The D-rules apply only to dry-run instances.** #297 kept 4b off the
  ordinary path because of cache-conditional and push-only false refusals. A dry
  run has neither problem. It is the same job, dispatched, with exactly the
  publishing steps off.
- **No automatic wait.** Ship's measurement runs up to three times per
  invocation, and no read in it polls. The dispatch prints the run and refuses.
  The coordinator's existing bounded wait (code-ship B1a) covers the gap.
- **The branch copy gates the dispatch.** A pre-#474 copy has no forced dry
  mode. Dispatching it on a branch would really promote and tag.

## Limits, stated

- A red in a `[publish]` step, or in the npm/deploy jobs, still needs a
  ci-grant. A dry run never executes those steps.
- A red job that ran zero steps (a runner that never picked it up) has no usable
  duration. On the carve-out path, 4c refuses it. Relaxing 4c for that case is
  left unmade, for the same reason as the timeout relaxation in the #321 ADR: it
  is one `if`, and it should be added when the refusal is observed, not before.
- A dry run proves the steps ran. Like the carve-out, it cannot prove what they
  asserted.
