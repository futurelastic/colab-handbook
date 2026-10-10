# code-ship · B1 Red trunk (#353, #354)

Reference for [`code-ship`](SKILL.md) B1. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### Red trunk — first ask "is the red real?", then "is this branch the patch?" (#353, #354)

**Before anything below, classify `<base>`'s red run** with the same test B1a uses
(*Telling infra from finding*, below). `red:infra` → re-run it once
(`gh run rerun <databaseId> --failed`) and re-read B1; a second identical failure is the
runner — hand it to the ops lane, the ship still stops. `red:finding` → the red is real:
it needs a `TRUNK RED:` issue and a patch, and the rest of this section applies. Filing a
`TRUNK RED:` issue for a run that died at setup sends someone hunting a regression that
does not exist; re-running a red that names assertions buries one that does.

**The runner-side signatures, and the one re-run, step by step (#540).** These read as
`red:infra` evidence under B1a's step 2, provided no named assertion failed (step 1 still
wins):

- the job lost communication with its runner;
- the job ran past its `timeout-minutes` with no test output in its log;
- the runner crashed before the job's first step;
- a fixed-port `EADDRINUSE`;
- the job died in under a second.

```sh
gh run list --commit "$RED" --json databaseId,workflowName,attempt,status,conclusion,startedAt
gh api "repos/{owner}/{repo}/actions/runs/<databaseId>/jobs" \
  -q '.jobs[]|"\(.name) \(.conclusion) \(.completed_at) \(.runner_name)"'   # gh run view --json jobs has no runner field
```

1. **Several jobs died within the same minute on different runners?** Check the host
   first — load, swap, disk, the runner service. A re-run onto a sick host fails the same
   way and spends the one re-run for nothing; a host problem is the ops lane's, and the
   ship stops.
2. **The re-run is keyed on the run's `attempt`.** `attempt` 1 ⇒ the re-run is still
   available. `attempt` above 1 ⇒ it is already spent — by the repo's scheduled driver or
   another ship pass — so go straight to step 5. That keeps one re-run per red sha whoever
   makes it, which is what stops a green second run from burying a real defect.
3. **Cancel only a queued duplicate first.** A second run of the same workflow at the same
   sha, still queued, holds the concurrency slot the re-run needs:
   `gh run list --commit "$RED" --workflow <w> --status queued --json databaseId`, then
   `gh run cancel <id>`. Never cancel a run that is in progress, and never one at another
   sha. This is the one cancel this skill makes, and it is on `<base>`'s red only — B1a's
   branch-CI rule still permits a re-run and nothing else.
4. **Re-run the failed jobs and wait with the one primitive:** `gh run rerun <databaseId>
   --failed`, then `colab ci-wait --sha "$RED" --branch <base>` (#495; the trunk bound, #559) — never
   a hand-rolled `sleep` loop. Green ⇒ re-read B1 and carry on.
5. **A repeat red is the real thing.** It is a code red ⇒ a `TRUNK RED:` issue and a patch
   (the rest of this section), or — when the repeat shows the same runner-side signature —
   an infra report for the ops lane. Either way the ship stops at this red.

An `EADDRINUSE` keeps B1a's double rule: re-run to unblock, and file a defect as well when
the fixed port is the code's own.

A red `<base>` stops the ship unless a door opens — the machine-checkable *Cure rule* or
a human ci-grant (`CONVENTIONS.md` [§4, *Cure rule*](../../CONVENTIONS.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281)).
The cure needs the branch **green at its own head**, and on a repo whose workflows
trigger only on trunk push (and `pull_request`) that run cannot exist until someone
opens a PR — B1a then reads `none`, cannot-arrive. Opening one is legitimate **only for
the branch carrying the fix**, and the reason is the merge ref: a PR's run is against
trunk-plus-branch, so it **includes the red**.

| branch | how you tell | what this skill does |
|---|---|---|
| **the patch** | its title or issue says it repairs the red (`TRUNK RED:`), or its head fixes the failing test; its head contains the red sha, or will once synced (B0) | goes **first**, ahead of anything else queued. Sync it onto the red if it does not yet contain it (cure condition 1 — pays one CI round, by design), push, open a PR if the repo cannot otherwise run CI for the branch (`colab ship` closes it once the branch lands, #584), then re-read B1a at the new head. Green → the cure door opens at B2 |
| **a bystander** | ready work that merely happens to be queued — nothing in it touches the red | **waits for green trunk.** No PR, no rebase onto the red: its PR's run inherits the red through the merge ref, says nothing about the branch, and spreads the failure signal. Record it as a defer — precondition: trunk red; clears on: a green run on `<base>`; re-measure trigger: that run |

**Both read the same remedy** ("open a PR to obtain branch CI"; `colab ship`'s cure
refusal), which is exactly why the cure looks equally available to both. Ask the
question before offering the cure to anything.
Why: [ADR 536](../../docs/adr/536-code-ship-b1-red-trunk-rationale.md).

- **The red is in a main-only workflow** (`Release (auto)` — it never runs on a
  branch) **and the branch is the patch?** Its evidence is a **dry run**, not a PR
  (#474, `CONVENTIONS.md` *Cure rule*, *Dry-run evidence*). A real `colab ship`
  dispatches it once and refuses until it completes. `--dry` only prints the
  command: `gh workflow run release-auto.yml --ref <branch> -f dry_run=true`. Then
  wait under B1a's bound and re-run ship. The cure admits it only if
  every step that ran on trunk passed in the dry run. A red inside a `[publish]`
  step never cures this way: that is a ci-grant. A bystander never dispatches one,
  and containment refuses it anyway.
- **The red is in a trunk-only JOB of a branch workflow** (its `if:` skips it on a
  branch push — a long E2E suite, say) **and the branch is the patch?** Its evidence
  is a plain `workflow_dispatch` of that workflow at the branch head (#510,
  `CONVENTIONS.md` *Cure rule*, *Dispatch evidence for a job a branch push skips*).
  A real `colab ship` dispatches it once and refuses until it completes; `--dry`
  prints the command (`gh workflow run <file> --ref <branch>`). Wait with
  `colab ci-wait --sha <head> --branch <branch> --timeout <the job's usual length>`.
  If that is longer than B1a's bound, do not sit on it: record a defer
  whose clears-on is that dispatch run finishing, and re-run ship then. The cure
  admits it only from the same workflow file at the same head, with the step that
  failed on trunk passing in it; `skipped` is never a pass.
- **The cure refuses, the branch is the patch, and trunk declares `ci-grant: reviewer`?**
  You may open the door yourself (#504, `CONVENTIONS.md` *Red-trunk exemption*). Review the
  branch against the red first — does its head repair exactly the checks that are red? —
  then `colab ci-grant <N> --branch <b> --role ci-reviewer --reviewer <your id> --verdict pass
  --cures "<workflow / job>; …"`, where `<N>` is its `TRUNK RED:` issue. The command measures
  every guard and refuses on any; a refusal is final for this head, never something to route
  around. Then re-run ship, which re-measures them all. Without the opt-in, the door stays a
  human's: say what the human grant needs and stop.
- **Not sure it is the patch?** It is a bystander. A wrong bystander costs one wait for
  a green that the real patch is about to produce; a wrong patch opens a red PR, spends
  a CI round, and teaches every reader of that run the failure is the branch's.
- **Two branches both claim to be the patch?** Take the one whose head demonstrably
  repairs the failing test; the other waits. The cure door opens once per continuous
  red episode (anti-stacking), and again only when trunk's red-job set has strictly
  shrunk since (`CONVENTIONS.md` §4, *Cure rule*, condition 3, #477) — so a second
  "cure" of the same failure is at best a no-op, while a fix for a *different* still-red
  job can cure in turn.
