# The CI gate — how `colab` reads a branch's CI

The mechanics behind invariants 2 and 3 of the CI contract
([CONVENTIONS.md §7](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607)): how `colab ship`
reads a branch's own run, when a documentation-only change skips the wait, and how a batch lands.
Moved verbatim from CONVENTIONS.md §4 by #635; each section keeps its heading there as a stub.
What lives in this directory, and why: [README](README.md).

## Trunk CI — by commit, not by recency

The rule: [CONVENTIONS.md §4](../../CONVENTIONS.md#4-branches-and-commits), and invariants 1–2 of [the CI contract](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607).

- **[Hard — gate: colab ship refuses unless trunk CI green]** **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** **Ask by commit, not by recency
  (#92):**
  The right question: has EVERY run at this branch's current head sha completed, and did
  one of them succeed? `colab ship` asks it that way. Both halves are load-bearing: a
  sibling that is merely still in progress has not passed either (#307), so a fast
  workflow finishing green must never answer for a slow one that has not run yet.
  Only runs of workflows the repo owns count (#451): a run with `event: dynamic`
  (Dependabot Updates and GitHub's other dynamic workflows) never executes the sha, so it is
  dropped before the verdict and named in its detail; if nothing is left, the sha reads `none`.
  Only runs that **verify the code** count (#503): those triggered by a push or pull request.
  A run that comes *after* the verdict and acts on it — a `workflow_run` release such as
  `release-auto.yml`, its scheduled finalize, a dispatch, a deploy — is set aside and named the
  same way. Its failure belongs to the release lane, so it never turns trunk red for ship and
  ship never waits for it ([why](../../docs/adr/539-schema-checks-and-gates-rationale.md)) — except a
  dispatch of the push- or PR-triggered CI workflow with no push run at the sha (#567: a lost push
  event). `ship-gate-workflows:` / `ship-ignore-workflows:` override the set by workflow name ([schema](../../project.schema.md#ship-gate-workflows-ship-ignore-workflows--optional)).
  A trunk sha whose tree has **no workflow file at all** (#482) — a freshly adopted repo whose
  adoption branch is what adds CI — can never draw a run, so nothing there can be red: its
  `none` gets the *Branch CI* treatment for a run that cannot arrive, and the candidate's own
  run at its remote head decides (green passes; red, in flight or absent still refuses). A
  trunk that has workflows but no run at its sha is a real gap and still refuses.
  Each workflow is then judged by its **newest** run at the sha (#461): an earlier attempt of
  the *same* workflow that a later one superseded is set aside and named in the detail, so
  skipped `workflow_run` attempts no longer hold the sha red. A newer run decides in both
  directions — a newer failure vetoes an older success, a newer run still in flight blocks
  (#307) — except that a `cancelled` run never supersedes, because it ran nothing (#92). Runs of
  *different* workflows are never reduced: a failing one beside a passing one is still not
  green, and a workflow whose **only** run was cancelled verified nothing, so it blocks green (#628).
  `colab trunk-ci` prints that verdict for trunk's head, read-only and from the same function
  (#463); a skill that needs it calls the verb instead of restating the rule as a `gh run
  list` filter ([why](../../docs/adr/539-schema-checks-and-gates-rationale.md)).
  **Waiting for that verdict is `colab ci-wait`, never a loop (#495).** It backs off
  (30 s → 60 s → 120 s, then a deadline — the repo's own CI wait bound, measured from its
  history, `colab ci-profile`, #559), sends conditional requests so an unchanged read is
  free, and ends with its own exit code on a rate limit or an unreadable state instead of
  retrying. `colab trunk-ci` itself costs one runs read (plus one check-runs read on green) and
  caches its verdict per trunk sha for 45 s in the repo's git dir, shared by every session on
  that checkout. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
  That is the half of the question about what is merged **into**; the branch's own run
  is the other half — see *Branch CI*, below.
- **That resolves a FALSE red — a real one has two different doors, one of them
  human-only (#105), one machine-checkable (#281).** A **genuinely** red trunk (the sha
  really failed) is a true deadlock when the candidate branch's entire content IS the
  fix — see *Red-trunk exemption* and *Cure rule* below.

## Branch CI — the candidate's own run, read as a class (#314)

The rule: [CONVENTIONS.md, *Branch CI — the candidate's own run, read as a class (#314)*](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314).

Trunk CI answers *"is the thing I am merging into healthy?"*. It says nothing about the
thing being merged, and both gate a merge. A local quality gate does not answer for the
branch's CI either: local and runner disagree for ordinary reasons — a different OS, a
browser the runner has to boot, a toolchain pin the local machine already satisfies. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).

**One cause of that disagreement is closed before the push, not read after it (#403).** A
test that reads its author's machine (the home directory's config, a local daemon, a token
in the shell) is green locally and red on every runner. So the local gate is green only when
the test step has passed twice: once as-is, and once **hermetically**, with a fresh empty
`HOME`, every service-address and credential variable unset, and the network off where the
platform allows it (`colab gate-hermetic`, `code-wrap` A3). A toolchain manager's home is
the one thing carried across, pinned to its real path and printed (#447): the toolchain is
what the tests run on, not state they read. A green normal run with a red
hermetic run is its own verdict, `live-env`, and it is not green. The only exemption is a
`live-env: none` declaration on trunk's `project.yml`
([schema](../../project.schema.md#live-env--optional)). The branch-CI read below still applies:
runners differ in more ways than a stripped environment can reproduce.

**A green branch-CI run can *be* that hermetic run (#408).** A run is one when all three hold:
it is `green` at the branch's current head sha (the class below), its workflow runs the
same test command the local gate runs, and its runner does not share a developer's machine
(a hosted runner, or an ephemeral container runner, but never a self-hosted runner that
runs in someone's login session with their `HOME` and daemons). That run already had no
developer `HOME` and no local daemon, at the exact commit being merged, so repeating it
locally adds minutes and no evidence. So the hermetic verdict may be
recorded as `branch-ci` with that run's sha, and `colab gate-hermetic` runs locally only
when branch CI cannot arrive (no trigger for the branch), is not `green`, or does not run
the tests. The same holds after a sync: push and read the new branch run before
re-running the suite locally. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).

**Local is a smoke check; branch CI is the one gate (#410).** A repo whose branch CI can
arrive may say so in `project.yml` (`gate:` with `smoke:` and `authoritative: ci`,
[schema](../../project.schema.md#gate--optional)). There, `code-wrap` A3 runs the declared smoke
check once (lint, types, the tests for what changed — a few minutes, no hermetic second pass)
and pushes; the verdict is the branch-CI run at the pushed head sha, read as the class below,
and the hand-off names that run's id. `code-ship` reads the run and never re-runs the suite
locally. A clean CI runner is the hermetic run by construction, so `colab gate-hermetic`
stays only where the local gate is still the verdict. While iterating, run the tests for what
you changed; the full suite runs once, where the verdict comes from. The fallback is today's
rule, unchanged: no `gate:`, `authoritative: local`, or no workflow firing on a session-branch
push ⇒ the local full gate plus the hermetic run. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).

**Read the runs at the branch's current head sha, and report the result as one of four
classes — not as pass/fail.** The names are shared vocabulary: the implementer records
one when it pushes, the coordinator re-derives it before merging, and a fleet planner
reading either sees the same spelling. Spell them exactly so, everywhere:

| class | what the runs at the head sha show | next step |
|---|---|---|
| `green` | **every** run `completed`, at least one `success`, none `failure` | nothing owed — this precondition passes |
| `none` | no run exists, or **any** run is still in flight | a run queued or in flight has not passed, it has **not run**: wait, bounded — **the repo's CI wait bound per candidate** (measured from its own CI history, `colab ci-profile`; 15 minutes until it has one, #559), then a defer carrying a re-measure trigger, never an open-ended poll (#370). A run that **cannot arrive** for this ref — no workflows, or workflows triggering only on `pull_request` / trunk push — is not pending: proceed, and the base's own CI is the whole CI story — so the trunk run at the squash sha is read after the merge, before any evidence is posted, and a red there is filed as `TRUNK RED:` in the same pass (`code-ship` B2a, #374) |
| `red:infra` | a run failed **before** the suite could judge the branch — runner boot, browser install, billing lockout, dependency fetch. **Exit 2** where the repo separates them | re-run **once**; an identical failure twice is the runner, not the branch — hand it to the ops lane. Never merged past, never sent back to the implementer: there is nothing in the diff to fix |
| `red:finding` | the suite ran and something in it failed. **Exit 1** where separated | back to an implementer session, **as a class** — a [send-back](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409), never a coordinator fix. Never merged past, never re-run |

- **[Hard — gate: colab ship refuses stale-base]** **The run must have seen the current base (#395).** A class read at a head that does not
  contain the base's current tip is **`stale-base`**, whatever its runs say: two branches
  each green alone can combine red when neither run saw the other, and a textually clean
  merge re-runs nothing.
  The next step is mechanical — sync the base in, push, wait on the new run (the same
  bound), then land; `colab ship` refuses with this verdict, `self-clearing`. A
  head with no run at all is not stale (the `none` row above governs it). Skipping the
  re-run because the base's new commits "touch nothing the branch's tests import" is only
  ever allowed on a measurement, never on a guess — and no generic measurement exists today. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
- **The quantifiers are the trunk rule's, unchanged (#92, #307).** `every … completed`: a
  fast sibling already green never answers for a slow one still running — that sha is
  `none`, not `green`. `cancelled` is `completed` and not a `failure`, so a cancelled
  straggler beside a real `success` of its own workflow is still `green` (a cancelled-only
  workflow is not, #628); the ladder must not reintroduce the deadlock #92 fixed.
- **A claim's first push is `green` from a guard run, not a second suite run (#418).** A
  branch pushed at trunk's head (a plain-git cut; `colab` pushes a claim ref instead, §5,
  *Record of a claim*) sits on a sha the same workflow has usually already tested. The CI templates (and this repo's own
  workflow) open with a `dedupe` job that runs only on a ref's **first** push, checks nothing
  out, and asks the platform one thing: does *this* workflow already have a completed,
  `success`, non-pull-request run at *this* sha? Yes ⇒ every other job is skipped, and the run
  concludes `success` — the branch reads `green`, truthfully, because the same workflow passed
  at the same sha. Trunk's run still in flight or red, no `gh` on the runner, or any API error
  ⇒ the suite runs as before (fail-open). Every later push skips the guard at scheduling time,
  so the session's first real commit always gets the full suite at its own sha. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
- **Trunk reuses a green run of an identical tree (#493).** A ship squash-merges a branch
  whose green run already contained the current base, so the trunk commit's *tree* is
  byte-identical to the tree that run passed — only the sha is new, and a sha-keyed skip can
  never see it. On a non-creating push to trunk the same `dedupe` guard therefore also asks:
  does *this* workflow have a `success` run, from a `push` on another ref of *this* repo, whose
  commit has *this* exact tree? It filters the run listing by tree and then confirms the tree
  through the git object. Yes ⇒ the suite is skipped, the run concludes `success`, and the
  guard leaves a `tree-already-green` notice naming the run it relied on; `colab ship`'s
  trunk-CI row and `colab trunk-ci` print that run ("relied on <url>"). **The rule: an
  identical tree plus a green run of the same workflow is tested.** An identical tree covers
  every committed byte — workflow files, lockfiles, the descriptor — but not what lives outside
  the repo: runner images, unpinned toolchain downloads, secrets and variables, steps that
  branch on `github.ref`. A repo whose suite depends on those declares `tree-reuse: off`
  (`project.schema.md`) and trunk always runs in full. The guard reads `trunk:` from the
  descriptor *at that sha* and acts only there — never on a release branch, never on a
  promotion push to `main` where trunk is `dev`, never on a dispatch. Any doubt — no
  descriptor, an opt-out, an API error, no exact match — runs the full suite. A green `push`
  run at *this* sha on another ref (a `ship-batch/*` run trunk fast-forwarded to) is asked for
  first, by an exact query, so a busy repo's listing window cannot miss it (#552). A cited run
  is reused only if it skipped no job but the guard: a job gated on the trunk ref is `skipped`
  on every branch push, and reusing that run would skip it on trunk too (#511); matches are
  walked newest first and the first that passes is cited, so a skipping one never hides an older
  full run (#592). A trunk-only job (publish, deploy, release) never sits behind this gate. One reading turns such a run red: a
  cited head that is local and whose tree provably differs from trunk's (`HUMAN_GATED` —
  trunk is untested at that sha). A citation that cannot be read leaves the run green and says
  so, because the run's own `success` is the verdict, exactly as for #418. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
- **The docs-only guard has left the templates (#607).** `colab ship` decides docs-only itself
  ([*Docs-only — no CI wait*](#docs-only--no-ci-wait-606), below), so a template no longer carries
  the rule in shell. A copy that still runs the #570 guard keeps working: its `success` +
  `docs-only-skip` notice reads green. A `paths-ignore` for docs is safe now, and the templates show
  one as an option: a docs-only trunk tip with no run is read at its newest code commit.
- **An unclassifiable red is `red:finding`.** Where a repo does not separate exit 1 from
  exit 2, `failure` is all the platform reports: read the failing job's log far enough to
  say which side of the line it fell on, and if that cannot be told, report `red:finding`. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
- **Telling `red:infra` from `red:finding` is a test, not taste (#354).** The same test
  reads a red **trunk** run, where it chooses between re-running once and filing a
  `TRUNK RED:` issue — the choice this section's re-run permission otherwise leaves to
  judgement at exactly the moment it matters. Where the repo separates exit 1 from exit
  2, the exit code already answers; where it does not, apply this in order:
  1. **At least one named failing assertion ⇒ `red:finding`**, whatever else the run
     shows — a test name with an expected/received pair, an `assert` message, a count
     like `794 pass / 37 fail`. **Never re-run it**: a green second run hides a real
     defect, and a flaky one is a defect too.
  2. **Otherwise it is `red:infra` when the tests demonstrably never ran**, shown by any
     of: the run's **duration far below this repo's own norm** for that workflow
     (compare `gh run list --workflow <w> --status success -L 10 --json startedAt,updatedAt`
     — an order of magnitude short means it died in checkout, install or runner boot);
     **`gh run view <id> --log-failed` returning nothing at all**; or failure text that
     names the environment rather than the code — `EADDRINUSE`, `signal: killed`, a lost
     runner, a job queued for hours and then failed with no log.
  3. **Neither ⇒ `red:finding`** — the unclassifiable rule above, unchanged.

  Two readings that the text alone gets wrong:
  - **A timeout is `red:infra` only if the host was loaded.** The same text on an idle host
    is a real slow-test bug. Check the host (load, swap, I/O pressure) before calling it
    infra; no host evidence ⇒ `red:finding`. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
  - **Infra-shaped is not the same as harmless.** A port collision (`EADDRINUSE`) from a
    single random draw with no retry is re-run once to clear the red **and** filed as a
    defect — the re-run unblocks the base, the cause is still the code's. The two are
    not exclusive.

  Measured shapes, one repo: a build failed in **26 s** where the normal run is 20+
  minutes and `--log-failed` returned nothing — re-ran green; a job queued ~2 h and failed
  with no log while its self-hosted host had swap 100 % full — re-ran green. The contrast
  in the same repo: 37 failures each naming an assertion, at normal duration — a real
  regression that a re-run would have buried.
- **Give the branch a run of its own — but only where trunk runs have their own capacity
  (#384).** A workflow triggering on trunk push and `pull_request` alone leaves every
  PR-less session branch at the cannot-arrive `none`: its first real run is the post-merge
  trunk run, so a red there is a `TRUNK RED:` for everyone instead of a hand-back to one
  implementer, and the ship pass waits on that run before it can post evidence. Measured
  across one fleet over two weeks (~830 landings, 14 repos): CI wait was the second-largest
  source of wait inside ship passes (186 waits, median 7.4 min), and only the repos that had
  hand-edited their copy to `push: branches: ['**']` got a branch signal before the merge.
  So the CI templates now trigger on **every** branch push, with a per-ref `concurrency`
  group that cancels a superseded run on the same branch and **never** a trunk run — every
  trunk sha keeps a completed run of its own, which is what the trunk half of the gate
  reads. That is the default **only where trunk has capacity of its own**: GitHub-hosted
  runners, a runner pool, or a trunk-only runner label chosen in `runs-on` on `github.ref`
  ([*Self-hosted runners*](ci-lanes.md#self-hosted-runners--capacity-is-the-agent-count-not-the-machine-355)).
  On a **single self-hosted agent shared with trunk**, keep trunk-only triggers (and restore
  `pull_request`, below) until a trunk lane exists — measured there (#355), branch pushes queued a trunk build job 33 min
  behind other branches' jobs, delaying the one run a merge waits for. The cancel list
  names the repo's trunk and release branch by name; a trunk missing from it has each run
  cancelled by the next merge, leaving that squash sha with no completed run of its own for
  the by-commit trunk read (#92) or the post-merge read (`code-ship` B2a) to find.
- **One commit, one run: the templates do not trigger on `pull_request` (#512).** With `push` on
  `'**'` a branch that has an open PR in the same repository already has a run at its head, and
  a `pull_request` run beside it ran the whole suite a second time — measured on one Laravel
  adopter, a docs-only PR of 4 commits produced 8 runs, 4 of them duplicates; across nine
  adopting repos over 15 days, 126 push-plus-PR pairs. The second run also *decided* the
  verdict: every reader keeps the newest run per workflow at a sha, and the PR run is created
  seconds after the push run, so it won — while testing the merge ref, not the sha that lands.
  The templates therefore carry `push` and `workflow_dispatch` only. Three things follow:
  1. **A copy that went back to trunk-only push (#355) restores `pull_request: branches: [<trunk>]`.**
     There the PR run is the only branch run (the *none* paragraph above, and #353 below).
  2. **Trunk runs keep a group of their own.** The group is `ci-<ref>` for a branch, so a newer
     push cancels the older run, and `ci-<ref>-<run id>` for the trunk and release refs: GitHub
     cancels an older run still **pending** in a group even when `cancel-in-progress` is
     `false`, so a third quick merge would drop the second one's run before it started. The trunk
     list appears three times in a copy — the group, `cancel-in-progress`, and the `dedupe`
     job's `if:` — and the three must name the same refs.
  3. **Do not deduplicate any other way.** A shared push/PR group (`head_ref || ref_name`) can
     leave the merge-ref run as the survivor, lets a promotion PR cancel the trunk's own
     in-flight run, and leaves a `cancelled` run at the head. An `if:` that skips jobs on a
     same-repo PR, or `paths-ignore`, leaves a `skipped` or absent run: `colab ship` reads
     `skipped` as not green and a docs-only squash with no trunk run as `none`.
  **Fork PRs are opt-in.** A push to a fork never runs a workflow in the base repository, so
  a repo that takes fork PRs needs `pull_request`. The templates carry it commented out, and
  every suite job already carries `github.event_name != 'pull_request' ||
  github.event.pull_request.head.repo.full_name != github.repository`: uncommented, a
  same-repo PR's run skips every job (its push run tests that head) and a fork PR's run tests
  (#514). A run that skipped everything concludes `skipped`, and `colab`'s newest-run pick
  treats `skipped` like `cancelled` — it never stands for a workflow that has a run that ran.
  Uncomment only once every reader of the repo's CI does the same; until then such a repo keeps
  the trigger and the duplicate (this handbook's own `ci.yml` does). Private repos with forking disabled are not
  affected. A Laravel copy's heavy suite used to run only on the PR run; it now runs on the
  push run (`RUN_TESTS: auto`, decided from the descriptor's `trunk:`).
- **Say which `none`.** A bare `none` turns a bounded wait into a wait for a run that was
  never coming. A repo whose workflows trigger only on a trunk push and `pull_request` is
  the permanent shape: a wrap pushes a backup branch without opening a PR, so branch CI
  does not exist there before the merge — a normal state, not a missing measurement.
- **At a red base, that `none` has one way out — and only the patch may take it (#353).**
  "Proceed, the base's CI is the whole story" is a stop when the base is red, and the
  *Cure rule* below needs the branch green at its own head — a run a trunk-push-only repo
  produces for a branch **only through a PR**. A PR's run is against its merge ref, and
  that merge ref **includes the red base**. So opening one is legitimate for exactly one
  branch: the one **carrying the fix** — its head contains the red sha (cure condition 1)
  and repairs it, so its run is fix-on-top-of-red, the verdict wanted. A **bystander** —
  ready work that merely happens to be queued — waits for green: its PR inherits the red
  through the merge ref, returns a red run that says nothing about the branch, and
  spreads the failure signal. Both read the same remedy, so ask first: **is this branch
  the patch?** — its title or issue says it repairs the red, or its head fixes the
  failing test. Yes → it goes first, ahead of anything queued. No → it waits, and does
  not rebase onto the red either: containment proves a cure only for a branch that is
  one. Why: [ADR 539](../../docs/adr/539-branch-ci-rationale.md).
- **A class describes one sha.** Anything that moves the head — a sync merge of the base
  into the branch — invalidates it; read it again at the new head. A green inherited from
  an earlier sha is exactly the green-run-on-a-different-commit this section refuses.
  The one sanctioned substitute for that re-read is a **batch's combined run** — one run at
  a head that contains every member on top of the base, which grades each member's synced
  state at once ([*Batch landing*](#batch-landing--one-combined-run-then-a-fast-forward-373),
  below).
- **A red class is data, not a failed wrap.** The implementer records it and stops; the
  table says who acts next. Only `red:finding` names the implementer, and only when the
  finding is the branch's own.
- **One re-run per red episode, not per attempt** — and it is the only CI action the
  coordinator takes. A second identical failure is evidence; spending more re-runs on it
  just moves the wall further out.

## Docs-only — no CI wait (#606)

The rule: [CONVENTIONS.md, *Docs-only — no CI wait (#606)*](../../CONVENTIONS.md#docs-only--no-ci-wait-606).

**[Hard — gate: colab ship]** **⚖ Ruled by the repo owner, 2026-10-14 ([#606](https://github.com/futurelastic/colab-handbook/issues/606)).**
Documentation and design artifacts touch no code, so they do not wait for CI. **`colab ship`
decides this; the CI templates do not.** Why: [ADR 606](../../docs/adr/606-docs-only-no-ci-wait-rationale.md).

- **Which change.** Ship classifies the branch with `tools/lib/docs-only.js` — the
  [docs-only rule](../../CONVENTIONS.md#autonomy--the-docs-only-exception-345), design artifacts under `docs/`
  included — narrowed by `ci-docs-skip` ([schema](../../project.schema.md#ci-docs-skip--optional)).
  **Absent means on.** A path listed there is one the suite reads; a change touching it needs CI
  as usual. `ci-docs-skip: off` turns this path off. **`docs-only-paths`** (#626,
  [schema](../../project.schema.md#docs-only-paths--optional)) adds repo paths whose content files —
  text and the design-artifact types — count here, for a content site whose CI `paths-ignore`s them.
- **Branch CI is not required.** No run, a run in flight and a `stale-base` run (#395) all pass, as
  `docs-only: CI not required (<n> files)`. **A run that exists at the pushed head and finished red
  still refuses** — ship never overrides a red verdict.
- **Trunk CI on a docs-only tip is read at the newest code commit.** A trunk tip with no finished
  run that is itself docs-only takes the verdict of its newest first-parent ancestor that is not
  (50 commits back at most), for every ship and for `colab trunk-ci`. A tip whose run finished red
  stays red.
- **A secret check runs before the merge.** Ship scans the lines a docs-only change **adds** for
  credential shapes (private keys, cloud and API tokens, `password=`-style assignments) and for the
  terms in `.github/secret-scan-terms` when the target has one (`tools/lib/secret-scan.js`). A hit
  refuses with the file and line, never the matched text.
- Every other precondition still applies; the classification and the scan are both measured again
  after B0 sync. The 🚢 comment records `docs-only: CI not required (<n> files)` and the trunk sha CI
  was read at. A copy still carrying the #570 guard keeps working: its `docs-only-skip` `success`
  still reads green.

## Batch landing — one combined run, then a fast-forward (#373)

The rule: [CONVENTIONS.md, *Batch landing — one combined run, then a fast-forward (#373)*](../../CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373).

Why, with the measurement: [ADR 539](../../docs/adr/539-who-may-touch-and-batch-landing-rationale.md).

Every mature system that lands several changes per cycle (merge trains, merge queues,
rollups, speculative pipelines) **tests the combined state before it becomes trunk**. None
lands first and tests afterwards. So a repo that declares
[`ship-batch: <N>`](../../project.schema.md#ship-batch--optional) (1–8; absent or 1 is serial,
unchanged) may land through `colab ship --batch <b1,b2[,…]>`:

**A batch of one is a batch** (#562): a lone ready candidate lands through the same path,
never serially, so a repo running its full matrix only on `ship-batch/**` and trunk still
tests every setup before trunk moves — whether or not a sibling was ready. Under
[`integration-profile: gated`](ci-lanes.md#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610)
the heavy lane must also be green at the batch head; a heavy red re-runs or splits like a light one.

1. **Joining.** A member is `green` at its own head ([*Branch CI*](#branch-ci--the-candidates-own-run-read-as-a-class-314),
   unchanged — or a `none` that cannot arrive), passes every gate its own serial ship would,
   and is an ordinary squash into trunk through the `auto-trunk` grant. Anything special
   ships serially, where its path already is: the docs-only door (judged per branch), a
   migration, a ci-grant or cure, a core-path review, an adopted branch, a branch editing
   `.github/workflows/**` (it would change what grades the batch). File-disjoint members
   are preferred — only as a pre-filter that lowers eviction odds. **Disjointness is never
   the correctness gate**: semantic conflicts need no shared file. The combined run is.
2. **[Hard — gate: combined-head build fails on staged conflict markers]** **Building.** Trunk's current head — green exactly as the trunk gate requires — plus
   one squash commit per member, **each its own commit with its own `Closes #N`**, so
   per-issue evidence and revert stay one-to-one. A member that conflicts with those
   already in drops to the next batch — **unless every conflicting path is
   [`generated`](../../project.schema.md#generated--optional)** (#387): then the build does what
   B0 does for one branch, running `.colab/hooks/pre-ship` on the combined head to
   regenerate them, and the member stays in (the combined run is still the gate). With no
   hook to regenerate, or a hook that fails, it drops as before — and a hook that exits 0
   but leaves a `<<<<<<<`/`>>>>>>>` line staged in a path it was handed **has failed**: its
   exit code is a claim, the index is the proof, and serial B0 reads it the same way (#436).
   Sharing only generated
   paths does not count against disjointness in step 1's pre-filter either. The result is
   pushed to `ship-batch/<base-sha7>` — the base is trunk's tip, or a parent's head (step 11).
3. **One combined run** there must be `green`. It **replaces** each member's post-sync
   re-run — not a skip justified by disjointness, but one run instead of N; a workflow whose only run was cancelled blocks `green`, as on trunk (#629).
4. **Landing.** Trunk fast-forwards to the batch head **only if trunk's tip is still the
   batch's base** (for a chain, once the parent landed at that sha — step 11), by a plain
   non-forced push (a moved trunk fails it; the batch is then rebuilt on the new head). Each member's evidence names the combined run. While that run is in
   flight (or green, within a grace), the batch **holds the trunk lane**: serial ships pause (#581).
   **One batch per base**: a `--batch` naming other members waits (exit `3`) on a batch at its
   base by the same bound — pending, or green within that grace. A red one is declined (#391),
   and a green one still unlanded past the grace has lost its lander; either is deleted and the
   requested batch built in its place. Green with an unreadable settle time still waits: only a
   provably abandoned batch is deleted (#659).
5. **A green batch run stands in for trunk's own run at that same sha** — while trunk's
   run is still in flight — only when **the same workflows** ran there: the workflow files
   firing on a trunk push and on a `ship-batch/**` push must be the same set. Otherwise
   trunk waits for its own run, as always.
6. **Failure — split, then retry** (#557). A red run lands nothing. `red:infra` → re-run
   once. With two or more members, `red:finding` (`--split`) or red after that re-run splits
   it: the same ref is rebuilt on the same base with the **first half** of its members; the
   rest wait for the next batch, and a red half splits again. A red batch of **one** cannot
   split: that member ships serially and returns to its implementer as a class.
7. **Wiring.** If no workflow fires on a `ship-batch/**` push, the combined run can never
   arrive: `colab ship` says so and declines to serial — it never waits for it. Consumer
   CI opts in by adding `'ship-batch/**'` to a CI workflow's `push: branches:` — a copy of
   the current CI templates already fires there, since their `'**'` covers it (#384).
8. **[Hard — gate: colab ship --batch declines on red trunk]** **A red trunk still stops everything** except the cure/grant doors, and those apply
   **per member, never to a batch**: a red trunk declines the batch outright.
9. **Gathering, and the partner wait** (#555). A ship pass builds a batch from **every**
   candidate ready at that moment — re-read the set right before each `--batch` call, never
   reuse the list the pass started with. A lone ready candidate lands alone at once — as a
   batch of one — unless
   the repo declares [`ship-batch-wait: <duration>`](../../project.schema.md#ship-batch-wait--optional):
   then, with the lane otherwise idle (trunk's run finished, no batch in flight), it waits
   up to that window — counted from when it became ready, so it never restarts — for a
   partner, and lands alone after, still as a batch of one. The handbook gives no default and no ceiling: absent
   is no wait. A repo picks the value from its own history.
10. **Adaptive size** (#557): with [`ship-batch-steps`](../../project.schema.md#ship-batch-steps--optional),
   one step up after a green batch, one step down after a red one; no default steps.
11. **Speculative chain** (#605). `--onto ship-batch/<sha7>` builds the batch on an in-flight
   batch's head; the chain is kept only while it ends at a batch on trunk's tip, at most 3 deep.
   `--onto` is refused when the named batch has no combined run in flight or green, is not
   rooted at trunk's tip, or is already 3 deep. A child lands only once trunk's tip **is** its
   parent's head; a parent that is red, gone or rebuilt, or a trunk moved any other way,
   deletes the child (its run cancelled) and declines it. Every batch of a chain rooted at
   trunk's tip holds the lane, as one batch does. Why, and the edge rulings:
   [ADR 605](../../docs/adr/605-speculative-batch-chain-rationale.md).

`colab ship --batch` never waits: each call reads the remote, takes one step, and exits
`0` landed · `3` paused (wait on the printed run, bounded as any other CI wait, then run
the same command again) · `4` declined, nothing landed, ship the members one at a time (a
red of two or more: re-run or `--split`, step 6). Declining is never a silent fall-through to the serial path: that path's sync commit
still needs its own re-run, and landing it unseen is the thing this section exists to stop.

**Tuning — the repo's own history, read by `colab batch-stats`** (#554). No knob has a
handbook default, so a repo sets `ship-batch:`, `ship-batch-wait:` and `ship-batch-steps:` from
what `colab batch-stats [--since <window>] [--json]` reports for it — fill, first-attempt green,
reds, drops by class (each a `Ship-Batch-Dropped:` trailer on the batch head), **missed
partners** and queue wait; the metrics are defined in `tools/README.md`. On a `ship-batch` repo
`alone` (serial plus a batch of one, #580), not `serial`, tunes `ship-batch-wait`. It reads
git and CI only, so it answers the same on every machine.
