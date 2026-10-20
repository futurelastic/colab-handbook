# A red trunk — the two doors, and who opens the patch

The mechanics behind invariant 1 of the CI contract
([CONVENTIONS.md §7](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607)): never merge onto
a red trunk; only its fix lands. Moved verbatim from CONVENTIONS.md §5 by #635; each section keeps
its heading there as a stub. What lives in this directory, and why: [README](README.md).

## A red trunk with no patch — never parked in silence (#390)

The rule: [CONVENTIONS.md, *A red trunk with no patch — never parked in silence (#390)*](../../CONVENTIONS.md#a-red-trunk-with-no-patch--never-parked-in-silence-390).

The two doors below, and `code-ship`'s red-trunk ordering, cover **landing** a patch for
a red trunk. Something has to **create** one first. The invariant:

> **A green, finished branch is never parked behind trunk CI while there is neither an
> open, accepted `TRUNK RED:` issue nor a re-run in flight.**

An issue that diagnoses the red under another title, or still carries `agent-filed`, does not count. Triage's §0 therefore treats "trunk red,
and no open accepted `TRUNK RED:` issue" as a change that forces a full pass, even when
none of its fingerprint inputs moved. The full pass adopts such an issue: it retitles it
and drops `agent-filed` (#430).

Two actors hold it, one per half, and neither does the other's:

- **The re-run — the repo's scheduled driver, where one exists.** Once per red sha,
  only when the red commit's diff is docs-lane-only
  ([§2](../../CONVENTIONS.md#autonomy--the-docs-only-exception-345)) and no `TRUNK RED:` issue is open. It is
  the **only** re-run actor for a red trunk ([§4](../../CONVENTIONS.md#4-branches-and-commits),
  *Telling `red:infra` from `red:finding`*).
- **The filing — triage.** When the re-run has been tried for that sha, or cannot apply
  (the commit touches more than docs, or nothing drives the repo), and no accepted
  `TRUNK RED:` issue is open, triage files `TRUNK RED: <sha> fails <check>` — or comments
  the occurrence on an open issue for the same flake class, or adopts an open issue that
  already diagnoses the sha — at most once per red sha. It is
  one of triage's authorised writes (`skills/code-triage` §0.2, write 8), and triage
  never re-runs a job itself.

Why, with the measurements: [ADR 390](../../docs/adr/390-red-trunk-no-patch-rationale.md).

Why, with the measurement: [ADR 539](../../docs/adr/539-red-trunk-rationale.md).

## Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

The rule: [CONVENTIONS.md, *Red-trunk exemption — the one-shot door through trunk-CI-green (#105)*](../../CONVENTIONS.md#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105).

Why, with the measurements: [ADR 105](../../docs/adr/105-red-trunk-exemption-rationale.md).

- **Two roles, as for a migration grant (#504).** The repo says which it accepts:

  | Role | Who decided | Marker | Bound to | Accepted |
  |---|---|---|---|---|
  | **[Hard — gate: colab ci-grant refuses]** `human` | a person, `COLAB_HUMAN=1` | `🚨 Red-trunk CI grant` | the branch and the red trunk sha | on every repo — the default |
  | `ci-reviewer` | the coordinator agent, with a review record | `🩹 Red-trunk CI review grant` | the branch's exact HEAD and the red trunk sha | only under [`ci-grant: reviewer`](../../project.schema.md#ci-grant--optional) |

  **[Hard — gate: colab ci-grant refuses without COLAB_HUMAN or the reviewer opt-in]** `colab ci-grant <N> --branch <b> --role ci-reviewer --reviewer <id> --verdict
  pass --cures "<check>; <check>"` mints it **without** `COLAB_HUMAN=1` — the only grant
  that does — and only where trunk's committed `project.yml` declares the opt-in (a branch
  cannot opt itself in). Every guard is **measured** at mint, nothing is taken from the
  flags: the branch's trailing number group carries `#N`; `#N` is open and titled
  `TRUNK RED:`; trunk is red in the sense `ship` checks; never stacks (the same guard as the
  human grant); the branch's own CI is green at its **exact** pushed head; and every check
  the record claims to cure is red on trunk at the red sha. The review record (a fenced
  `ci-review` block) carries `verdict: pass`, the reviewed `head`, the `red` sha and the
  `cures`. `ship` re-measures all of it — issue, title, opt-in at the merge target, red sha,
  branch green at exactly that head, cures still red — and honours an optional
  `not-before` (a revoke window the host imposes) by reading the grant as *not yet usable*
  until it passes. **Revoking stays human** (`COLAB_HUMAN=1 colab ci-grant <N> --revoke`
  cancels every role). The reviewer identity is declared, not attested — the same caveat as
  the migration reviewer. Why, with the measurements: [ADR 105](../../docs/adr/105-red-trunk-exemption-rationale.md).
- **[Hard — gate: colab ship refuses a stale CI grant]** **Bound to one issue, the branch, AND the exact red trunk sha reviewed against** — it
  expires the instant trunk's head moves, for any reason. A moved branch voids it too, except by the stale-base sync `ship` demands (#615): clean merges of trunk at or before the red sha keep it.
- **[Hard — gate: colab ship refuses unmeasured evidence]** **Evidence is measured, never asserted** — creating one requires a completed,
  successful CI run for the branch's own current head sha; `--evidence-run` is
  recording-only and never substitutes for the measured run.
- **[Hard — gate: colab ci-grant refuses a stack]** **Never stacks** — refuses against a green trunk, and refuses again if a prior grant
  already merged something and trunk has been red continuously since.
- A grant-authorised merge carries a `CI-Grant:` trailer in the squash commit itself, in
  addition to the tracker comment.
- **Scoped to exactly one precondition** (trunk-CI-green) — never exempts no-new-
  migrations, claim corroboration, the trunk-checkout check, the hand-merge conflict
  preview, or `colab promote`. **Trunk-only** — an integration line's red borrows trunk's
  advisory verdict when the line has no runs of its own; the exemption does not extend to lines.

Why, with the measurement: [ADR 539](../../docs/adr/539-red-trunk-rationale.md).

## Cure rule — the machine-checkable door through trunk-CI-green (#281)

The rule: [CONVENTIONS.md, *Cure rule — the machine-checkable door through trunk-CI-green (#281)*](../../CONVENTIONS.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281).

A second door through the same precondition, tried **before** ci-grant and needing
**no human step at all** — `colab ship` fires it automatically the moment the raw
trunk-CI-green check fails HUMAN_GATED, and falls straight through to the ordinary
ci-grant when any condition below is not met. Fires **iff**:

1. **[Hard — gate: colab ship refuses (cure rule)]** the branch **contains trunk's current red head sha** as an ancestor.
2. **[Hard — gate: colab ship refuses (cure rule)]** the branch's own CI is green **at its own current head**, measured, never asserted —
   identical "ask by sha" discipline to ci-grant's evidence guard — **and** (2b, #297)
   every job that is RED on trunk's runs at the red sha exists in the branch's runs at
   that head, completed and concluded `success`, matched per workflow. It is scoped to
   trunk's **red set**, so an advisory job failing only on the branch does not refuse. A job instance from a `workflow_dispatch` run counts here only under the
   #510 rules below (*Dispatch evidence for a job a branch push skips*).
3. **[Hard — gate: colab ship refuses (cure rule)]** the **same anti-stacking guard** ci-grant uses holds — no prior grant OR cure already
   merged while trunk has stayed continuously red since. A repo that auto-cures once and
   stays red anyway must not auto-cure again on the same continuous red. **One admission
   — progress (#477):** a further cure passes condition 3 when trunk's red-job set at
   its current red sha is a **strict subset** of the red-job set at the red sha the
   prior exemption was measured against (the `over-red` sha its `CI-Grant:` / `CI-Cure:`
   trailer names), jobs matched per workflow as in 2b. An **unchanged** set refuses, and so does a set with **any new**
   red job, even if another healed. Either set unmeasurable (runs aged out, a job still in
   flight) refuses. The candidate must still cure the remaining set under every other
   condition. The admission belongs to the cure rule only; a human `ci-grant` create
   keeps the plain guard.
4. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** touch `.github/workflows/**` — a branch may not
   self-certify a change to the CI configuration that is grading it. This door
   stays behind a human ci-grant, **unless** the branch passes the carve-out
   below. The diff is read without rename detection, so moving a workflow file
   out of the directory counts as touching it (#297).
5. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** change the `scripts` block of any `package.json` (#297).
   Any `package.json` at any depth counts; key order does not,
   a changed command does; deleting or renaming a manifest counts. There is **no
   carve-out** for this condition — see below for why the #321 door cannot adjudicate
   it. **One narrow admission (#475): an add-only change.** When every touched
   `package.json` exists on both sides, keeps every script it had with an identical
   command, and only *adds* keys, it passes
   condition 5 provided every step that ran in each red job on trunk, the failing one
   included, ran on the branch and concluded `success` (the 4b read, without 4c). Its
   limit: an added npm **lifecycle** hook (`postinstall`, `prepare`, or
   `pre<x>`/`post<x>` for a script `<x>`) is never admitted. A
   removed, renamed or changed script, a new manifest, and an add-only change in one
   manifest beside any other change in another still refuse.
6. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** change a Python dependency manifest (#377). What counts,
   at any depth: `pyproject.toml`, `setup.py`, `setup.cfg`; any `.txt`/`.in` whose name
   contains `requirements` or that sits under a `requirements/` directory; and any file
   one of those pulls in (a `-r`/`-c` include, a `[tool.setuptools.dynamic]` `file =`),
   read from both sides of the diff. Lockfiles are not read by the template and do not
   count. **No carve-out**, for the same reason as 5. **One narrow admission (#476): a
   pin-only change.** When every touched manifest exists on both sides and differs only
   in the version specifier (or `--hash`) of requirements present at the same position
   on both sides — no requirement added, removed, reordered or renamed, no extras or
   marker changed, no option line (`-r`/`-c`/`-e`/index) changed — it passes condition 6
   on the same step proof as 5's admission **plus one test**: no step *after* the last
   one that ran on trunk may be `skipped` on the branch. A `pyproject.toml` is read only
   inside its dependency arrays (`[project] dependencies`,
   `[project.optional-dependencies]`, `[dependency-groups]`, `[build-system] requires`);
   every other byte must match. `setup.py` (code) and `setup.cfg` are never pin-only.

**[Hard — gate: colab ship refuses (cure rule)]** An unmeasurable diff — a failed read, a manifest that does not parse, a manifest
that is a symlink — refuses, the same as any other unmeasured signal. Order of
checks: 1 → 2 → 2b → 3 → diff measurable → 5 → 6 → 4 (with its carve-out).

**The workflow carve-out (#321) — one guarded door through condition 4, not a relaxation
of it.** A workflow-touching branch may
still cure when, on top of 1-3 (2b included) and 5, **all** of:

- **[Hard — gate: colab ship refuses (cure rule)]** **4a — job-name superset.** Every job RED on trunk's run at the red sha
  exists on the branch's own green run, completed and concluded `success`.
  *"I made the red job disappear"* — deleted, renamed, filtered away — fails here.
  Since #297 this sub-test is condition 2b and applies to **every** cure; 4b and
  4c stay the carve-out's alone.
- **[Hard — gate: colab ship refuses (cure rule)]** **4b — executed-step superset.** For each of those jobs, every step that actually
  **ran** on trunk (reached a terminal, non-skipped conclusion) is present on the
  branch's job and concluded `success`. Steps *after* the failing one are `skipped` on
  trunk and so constrain nothing — only steps that demonstrably ran do. *"I made it exit
  early"* fails here.
- **[Hard — gate: colab ship refuses (cure rule)]** **4c — duration floor.** Each of those jobs cost at least the wall time its failure did on trunk.

**[Hard — gate: colab ship refuses (cure rule)]** Anything unmeasurable — no job evidence, an empty red-job set, an unreadable
step list, a missing duration — **refuses**, exactly as before. The carve-out
only ever widens the door on evidence, never on the absence of it.

**Dry-run evidence for a main-only workflow (#474).** Some workflows never run on a
branch at all. The template therefore offers a **dry run**: dispatched on the fix branch
(`gh workflow run release-auto.yml --ref <branch> -f dry_run=true`; a dispatch on any
ref other than `main` is dry with or without the input), it checks out the branch and
runs the same job with every external write off. Each decision runs with `--dry`. No
promotion, tag, Release, push or dispatch happens. Only steps whose names end in
`[publish]` are skipped. A sentinel step, *Dry run — nothing is tagged, released or
published*, runs only in that mode, and it is what marks a job instance as a dry run.
Such an instance is the job's 2b (and 4a) evidence only when, on top of 2b:

- **[Hard — gate: colab ship refuses (cure rule)]** **D1** — both step lists are measurable: trunk's ran-steps and the dry run's steps.
- **[Hard — gate: colab ship refuses (cure rule)]** **D2** — every step that **ran** on trunk, the failing one included, concluded
  `success` in the dry run. This is 4b, applied to dry-run instances on every path.
- **[Hard — gate: colab ship refuses (cure rule)]** **D3** — every step the dry run did not run to success is a skipped `[publish]` step.

A green ordinary instance of the same job outranks a dry one, so the D-rules apply only
when a dry run is the sole evidence.

**[Hard — gate: colab ship refuses (cure rule)]** When a cure refuses at 2b only because such a workflow's red job is absent on the
branch, and every later condition already holds, `colab ship` dispatches the dry
run **once**. It skips any workflow that already has a run at the branch head. It
never waits, and it never dispatches from `--dry` or `--dry --json`, which only
report the command. Re-run ship once the run completes (code-ship B1a's bounded
wait). Dispatch is gated on a static read of the **branch's** copy: it must have a
`name:`, a `dry_run` input and the sentinel step. A copy older than #474 has no
forced dry mode and would really publish if dispatched. The **limit**: a red in a
`[publish]` step, or in the `npm`/`deploy` jobs (which never run without a tag),
cannot be cured by a dry run and stays a ci-grant. So does a red job that ran
**zero** steps (a runner that never picked it up) on the carve-out path, because
4c has no usable duration for it. Reasoning:
[`docs/adr/474-cure-rule-dry-run-evidence.md`](../../docs/adr/474-cure-rule-dry-run-evidence.md).

**Dispatch evidence for a job a branch push skips (#510).** The same gap one level down.
A **dispatch instance** — a job row from a `workflow_dispatch` run that is not a #474
dry run — is the job's 2b (and 4a) evidence only when, on top of 2b's own tests, all of:

- **[Hard — gate: colab ship refuses (cure rule)]** **W1 — same workflow.** The dispatch run's workflow **id** equals the red run's.
  Either id missing refuses.
- **[Hard — gate: colab ship refuses (cure rule)]** **W2 — same head.** The dispatch run is at the branch's evidence head sha. A row
  at any other sha is never evidence.
- **W3 — the event** is `workflow_dispatch`. Ordinary instances are unchanged.
- **W4 — the job passed and nothing beside it failed.** Completed `success`; no
  other instance at the head red or pending. So `skipped`, `neutral`, `cancelled`
  or absent never counts as cured, and a job that ran and **failed** on the push
  run is not rescued by a green dispatch.
- **[Hard — gate: colab ship refuses (cure rule)]** **W5 — the failing step ran.** Every step that went red on trunk is present by exact
  name in the dispatch instance and concluded `success` — a job whose steps were all
  skipped reports `success`, so job-level success alone cannot see a step whose own
  `if:` depends on the event. A trunk red with no red step (a timeout, a lost runner)
  leaves W5 nothing to check, and W4 decides.
- **W6 — per job, by exact name.** Matrix shards match by their expanded names;
  one green shard never covers another; nothing matches by prefix.

W1 and W2 apply to a #474 dry run as well whenever its run reports
`workflow_dispatch`. A green ordinary instance outranks a green dispatch
instance, which outranks a green dry run: each rule set applies only when that
instance is the job's sole evidence.

When a cure refuses at 2b only because red jobs are absent or `skipped` on the
branch in a workflow that (a) declares `workflow_dispatch` in the **branch's**
copy, (b) is not dry-run capable (that keeps the #474 path), (c) has a completed,
successful **non-dispatch** run at the head — it is branch CI, not a main-only
workflow a dispatch could publish from — and (d) has no `workflow_dispatch` run at
the head yet, and every later condition already holds, `colab ship` dispatches it
**once** (`gh workflow run <file> --ref <branch>`, no inputs). It never waits and never
dispatches from `--dry` or `--dry --json`, which report `ciCure.dispatchWanted`.
Wait with `colab ci-wait --sha <head> --branch <branch>` sized to the job, then
re-run ship. Reasoning:
[`docs/adr/510-cure-rule-dispatch-evidence-for-branch-skipped-jobs.md`](../../docs/adr/510-cure-rule-dispatch-evidence-for-branch-skipped-jobs.md).

- **[Hard — gate: colab ship refuses (cure rule)]** **`package.json`'s `scripts` block is condition 5, not part of this carve-out, and
  must not be folded into it.** The carve-out's evidence cannot adjudicate a
  scripts-block weakening in the general case — it happens inside a step whose name and
  conclusion are unchanged and whose duration delta may sit below any signal, so 4b and
  4c would both silently pass a change they are structurally unable to see.

The full reasoning — why the executed-step superset is the primary test and a
bare duration threshold was rejected, what the two accepted false refusals cost,
and why the `timed_out` relaxation is deliberately left unwritten — is in
[`docs/adr/321-workflow-carve-out-measures-execution-not-duration.md`](../../docs/adr/321-workflow-carve-out-measures-execution-not-duration.md).
- **Where workflows never fire for a branch ref, that round is a PR — for the patch only (#353).** A bystander does not rebase onto the red and does not open a PR: it
  waits for green (*Branch CI*, above).
- A cured merge carries a `CI-Cure:` trailer instead of `CI-Grant:` — unlike the
  grant's trailer it names no issue (the cure rule never reads the tracker at all,
  so it has none to name), only the branch, the red trunk sha it contained, and the
  evidence run sha.
- **The trailer and the `--dry --json` payload name WHICH door was used.** A cure
  admitted through the carve-out appends ` via workflow-carve-out jobs <a,b>` to its
  trailer and reports `ciCure.via: "workflow-carve-out"` (with per-job durations)
  instead of `"ordinary"`. The `--grep=^CI-Cure:` scan is anchored on the prefix, so the
  suffix never disturbs it. A cure proven by a dry run (#474) appends ` via dry-run jobs
  <a,b>` the same way and reports `ciCure.dryRun: {jobs}`; on a refusal,
  `ciCure.dryRunWanted` names the dry run(s) that would supply the missing evidence,
  each with its workflow, file and exact command. A cure proven by a `workflow_dispatch`
  run (#510) appends ` via dispatch jobs <a,b>` and reports `ciCure.dispatch: {jobs}`;
  on a refusal, `ciCure.dispatchWanted` names the dispatch(es) that would supply the
  evidence, in the same shape. `ciCure.provenJobs` (#297) lists the red jobs 2b proved
  passing on the branch — a consumer rendering cure eligibility reads it (and
  `ok`/`reason`) rather than re-deriving a verdict from check-runs. A cure that changed
  a manifest under #475/#476's admissions appends ` admitted add-only-scripts` and/or
  `pin-only-requirements` to the trailer, and reports `ciCure.admitted: {scripts?,
  pins?}` (null otherwise), for the same reason. A cure that passed condition 3 by
  progress (#477) appends ` after-progress healed <a,b>` and reports `ciCure.progress:
  {healed, still}` (null otherwise); its own `over-red` sha is what the next cure on the
  same red compares against.
- **`colab ci-grant`'s anti-stacking scan now recognises either trailer** —
  `CI-Grant:` or `CI-Cure:` — as "an exemption already merged against this red".
- Scoped identically to the grant: trunk-only, and never exempts anything but
  trunk-CI-green.

Why, with the measurements and the accepted false refusals: [ADR 281](../../docs/adr/281-cure-rule-rationale.md).

Why, with the measurement: [ADR 539](../../docs/adr/539-cure-rationale.md).
