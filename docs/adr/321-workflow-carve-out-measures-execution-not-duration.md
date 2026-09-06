# The workflow carve-out measures EXECUTION, and only then wall time

## Context

The cure rule's condition 4 (#281) refused unconditionally on any
`.github/workflows/**` touch, with a sound stated reason: a branch that edits
the CI configuration doing the grading may not grade itself.

The blind spot is structural, not incidental. **The repair for a
CI-infrastructure outage IS a workflow change.** When trunk goes red because the
runner pool cannot reach a job's service container, the branch that fixes it
necessarily edits a workflow file — and was therefore permanently cure-ineligible
however green it was. The only exit was `colab ci-grant`, a `COLAB_HUMAN=1` gate,
so a mechanically-verifiable repair waited on a human who might not be watching.

The measured case (#321): a Tier A repo's `browser` job was SIGTERMed at its
"Wait for MySQL" step after 36s. The repair pinned the jobs to a
correctly-networked runner pool; `browser` came back green at 11m8s. Five
unrelated finished branches sat blocked behind the red trunk for ~30 hours.

**The human gate was not merely slow here — it was the wrong instrument.** A
second branch in the same repo was *also* a "CI fix": it pinned every job to a
dedicated runner that turned out to be missing a shared library the browser
suite needs. Granting that one would have converted a 30-hour stall into a
permanently red trunk. The two read identically in a one-line grant prompt. The
CI evidence tells them apart.

## Decision

Condition 4 stays a refusal **by default** and gains exactly one guarded
carve-out, admissible only on evidence the gate can measure. On top of conditions
1-3, all of:

- **4a — job-name superset.** Every job RED on trunk's run at the red sha exists
  on the branch's own green run, completed, concluded `success`.
- **4b — executed-step superset.** For each of those jobs, every step that
  actually *ran* on trunk (reached a terminal, non-skipped conclusion) is present
  on the branch's job and concluded `success`.
- **4c — duration floor.** Each of those jobs cost at least the wall time its
  failure did on trunk.

**4b is the primary sub-test, and 4c is explicitly secondary.** The issue as
filed proposed "a duration consistent with having actually run" as the
non-trivial-execution test. That is not what landed, because a duration
*threshold* embeds a repo-specific constant nobody can defend and nothing can
falsify. 4b instead is structural: it is condition 4a applied one level down, it
embeds no constant, it is self-calibrating against the failure it is being
compared to, and it closes the whole cheap attack family by construction —
deleting the red job, renaming it, and `if: false`-ing or `paths:`-filtering the
failing step all fail 4a or 4b with no tuning.

4c survives as a genuine second guard rather than redundancy: 4b proves the
*steps* ran, but cannot see a step's `run:` body gutted to a no-op inside the very
workflow file the carve-out is opening for. That is the one remaining attack that
lives entirely inside the edited instrument, and duration is the only signal that
touches it. It is defensible only because the comparison is **relative** — same
repo, same job, same runner class, minutes apart — so there is still no constant.

Job-level `conclusion: success` alone is not sufficient and cannot be made so:
**GitHub reports a job whose steps were all skipped as `conclusion: success`.**
Run- and job-level conclusions are blind to exactly the fast-exit 4b exists to
catch.

Every unmeasurable input refuses: absent job evidence, an **empty** red-job set
(a `.every()` over `[]` is vacuously true — the fail-open shape this rule had to
pre-empt), an unreadable step list, an absent/zero/negative duration.

The judgement is pure (`tools/lib/ci-cure.js`: `redJobsProvenOnBranch`,
`workflowCarveOut`, `shapeJobEvidence`); `tools/colab` only measures, and its
job-level reads are gated on `workflowsTouched` so no other ship path pays for
them.

## Alternatives rejected

- **An absolute duration floor** ("a job must take more than N seconds"). N is
  unknowable across repos and runner classes, unfalsifiable, and would need
  per-repo configuration — a new descriptor field to admit one branch class.
- **Trusting `conclusion === 'success'` at job level.** Blind to the all-skipped
  job, which is the exact fast-exit being guarded against.
- **Relaxing condition 4 outright for "CI fix"-shaped branches** (by title,
  label, or path heuristic). This is the human-prompt failure re-implemented in
  code: the good repair and the trunk-breaking one are indistinguishable by
  anything except their evidence.
- **Folding `package.json`'s `scripts` block into `workflowsTouched`** as one
  "instrument" flag (the shape #297 will be tempted by). Rejected, and the
  rejection is load-bearing: the carve-out's evidence *cannot* adjudicate a
  scripts-block weakening in the general case — it happens inside a step whose
  name and conclusion are unchanged and whose duration delta may sit below any
  signal, so 4b and 4c would both silently pass a change they are structurally
  unable to see. **Two instrument paths, two doors.** What is named once is the
  carve-out *predicate*, never the path list.
- **Exempting 4c when the red job concluded `timed_out`/`cancelled`.**
  Deliberately unmade rather than rejected — see Consequences.

## Consequences

- **Two accepted false refusals, both falling through to the ordinary ci-grant
  — the safe direction.** (i) A trunk job that failed by *timeout* or hang ran
  longer than any healthy green run, so 4c refuses the genuine repair; the
  refusal reason says so in as many words. (ii) A repair that legitimately
  *renames* a job or a step fails 4a/4b, because the gate cannot distinguish a
  rename from a deletion. Expect (ii) to be the most common benign refusal.
- **The `timed_out` relaxation is one `if`, and is deliberately left unwritten.**
  It is the obvious first follow-up the moment that refusal is observed in the
  field; adding it unmeasured is precisely the speculative loosening condition 4
  exists to resist.
- **Honest limit, in the same register as the rule's existing test-file
  confession:** the carve-out proves the red jobs still exist, still ran the steps
  they ran, and still cost at least the wall time the failure did. It cannot see
  what those steps *asserted*. A workflow edit preserving every step name and
  every second of wall time while weakening what the commands actually check
  passes this door — the same content-blindness, moved one layer down into the
  workflow itself.
- **The audit trail now names which door fired.** Anti-stacking permits exactly
  one exemption per continuous red episode, so `CI-Cure:` gained a
  ` via workflow-carve-out jobs <a,b>` suffix and `--dry --json` gained
  `ciCure.via`. The `--grep=^CI-Cure:` scan is prefix-anchored, so the suffix does
  not disturb its only consumer.
- **`redJobsProvenOnBranch` is exported unhoisted, on purpose.** #297 wants
  exactly this predicate to tighten condition 2 from "the branch's run is green"
  to "the check that failed on trunk passed here" — one call inserted after the
  condition-2 block, rather than a second, independent check-runs reader that
  would drift from this one. Whether to hoist it is #297's call to make with its
  own reasoning, not something to inherit silently.
- **This repo's own fixtures cannot exercise the carve-out end to end**, for the
  pre-existing reason `tools/lib/ship-ci-cure.test.js`'s banner already documents
  (a local-bare `origin` makes every `gh run list` fail, so the raw verdict is
  always SELF_CLEARING and neither door is consulted). Mitigated by keeping all
  judgement — including the red-job selection rule — in pure, unit-tested
  functions, leaving the caller's untestable residue to plain I/O.
