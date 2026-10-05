# A job a branch push skips is cured by a dispatch of the same workflow, matched by id and failing step

## Context

The cure rule's 2b (#297) asks that every job red on trunk exists on the
branch's runs at its head and concluded `success`. #474 gave a **main-only
workflow** a way through: a dry run dispatched on the branch. This is the same
gap one level down — the workflow runs on a branch push, but one of its **jobs**
does not.

Measured on one adopting fork: the repo moved its end-to-end job to trunk-only.
Its `if:` is true on trunk, on a schedule and on `workflow_dispatch`, and false
on a branch push. Branch CI went from 2–3 h to about 15 min. Trunk then went red
on two E2E shards, plus jobs killed by a hung cache save. The fix branch carried
both fixes, and its push run was green — with E2E **skipped**. `colab ship --dry`
said *not cure-eligible*: the failing checks were absent from every branch run, so
nothing proved the fix cured them. The only door left was a human `ci-grant`.

Reading the code while planning turned up two facts that shaped the change:

- ship already read **every** run at the branch head, dispatch runs included, and
  kept a `success` instance over a `skipped` one. So a green dispatch was
  *already* counted — matched on the workflow's **display name** plus the job
  name, any event, with no step check and no record. The fork was refused only
  because no dispatch run existed and nothing offered to start one.
- run rows carried no workflow id, so "same workflow" could not be checked.

## Decision

**The evidence contract comes first.** A dispatch instance — a job row from a
`workflow_dispatch` run that is not a #474 dry run — counts for 2b/4a only when:

- **W1** — the run's workflow id equals the red run's. Either missing refuses.
- **W2** — the run is at the branch's evidence head sha.
- **W3** — the event is `workflow_dispatch`; ordinary instances are unchanged.
- **W4** — the job completed `success`, with no instance at the head red or
  pending (2b's existing tests). `skipped`, `neutral`, `cancelled` and absent
  never count; a job that ran and failed on the push run is not rescued.
- **W5** — every step that went red on trunk is present by exact name in the
  dispatch instance and concluded `success`.
- **W6** — per job, by exact name; matrix shards by their expanded names.

Instances rank green ordinary > green dispatch > green dry run, so each rule set
applies only when that instance is the job's sole evidence. W1/W2 also apply to
a dry run whose run reports `workflow_dispatch`.

**Then: ship dispatches once and never waits** — the shape #474 chose. A refused
cure whose red jobs are absent or `skipped` on the branch, in a workflow that
declares `workflow_dispatch` (branch copy), is not dry-run capable, has a green
non-dispatch run at the head, and has no dispatch run there yet, gets
`gh workflow run <file> --ref <branch>` on the real ship path. `--dry` and
`--dry --json` only report it (`ciCure.dispatchWanted`). The agent waits with
`colab ci-wait` and re-runs ship. A proven cure's trailer appends
` via dispatch jobs <a,b>` and the payload reports `ciCure.dispatch: {jobs}`.

## Why

- **Workflow id, not display name.** Two workflow files can share a `name:`; a
  passing job in one must never stand in for the red one in another. The id is
  per file and stable across refs. When it cannot be read, the rule refuses —
  falling back to the name would reopen exactly the hole W1 closes.
- **W5, not the full executed-step superset (D2/4b).** The superset refuses on a
  cache-conditional step that ran on trunk and is skipped on a cache hit — and the
  measured red included a hung cache save. What a dispatch must prove is narrower
  and exact: the step that failed now ran and passed. A job whose steps were all
  skipped still reports `success`, which is why job-level success alone is not
  enough.
- **The green non-dispatch run (gate c).** It tells branch CI apart from a
  main-only workflow. A main-only workflow dispatched without a forced dry mode
  could publish; those stay on #474's dry-run path or a ci-grant.
- **Dispatch, but no wait.** Accept-only would leave the agent to work the command
  out itself. Waiting inside ship would hold a 2–3 h job against a measurement
  that runs up to three times per invocation, and against code-ship B1a's 15-minute
  bound. The wait is the caller's, with the one wait primitive.
- **Accept-only first was considered and not chosen.** The accept half was mostly
  a tightening of what was already counted. Dispatching closes the actual refusal.

## Limits, stated

- A trunk red with no red **step** (a timeout, a lost runner) leaves W5 nothing to
  check; W4 decides.
- `run-name:` that renames dispatch runs, or a matrix that expands differently
  under `workflow_dispatch`, cannot be matched job for job — a false refusal.
- A workflow that requires inputs fails the input-less dispatch; ship prints the
  command for a human or agent to run with them.
- A dispatch can trigger other jobs gated on `workflow_dispatch`. The green
  non-dispatch run narrows this to branch CI workflows but does not remove it. No
  per-repo opt-in was added, matching #474; revisit if a repo is measured with a
  side-effecting dispatch-only job in branch CI.
- After a cure merge, a template's trunk dedupe guard may cite the branch's push
  run — where the trunk-only job was skipped — and skip that job on trunk until
  its next schedule. The tree did pass the job in the dispatch run, so the result
  is not wrong, but trunk shows no run of it at that sha. Left for its own issue.
- The content-blindness the cure rule already confesses — what the steps
  *asserted* — is unchanged.
