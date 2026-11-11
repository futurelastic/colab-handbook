# CI lanes, integration profiles and runners

What `colab ship`, `colab release` and `colab promote` read from a repo's CI, the two lanes the
templates ship, the integration profiles, the artifact store and runner guidance. The contract these
serve is [CONVENTIONS.md §7](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607); what CI
runs and where is the repo's business. Moved verbatim from CONVENTIONS.md §7 by #635; each section
keeps its heading there as a stub. What lives in this directory, and why: [README](README.md).

## What ship reads — the CI contract (#607)

The rule: [CONVENTIONS.md, *What ship reads — the CI contract (#607)*](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607).

**The CI templates are guidance; the handbook enforces only what `colab ship` reads.** A copy may
differ from its template in any way: the audit prints that drift as a `▸` suggestion, never a fail
or warn, and `colab update` never exits 1 on it. The contract the audit does check: a run on
every push to trunk (above), on a branch push where `gate: authoritative: ci`, on `ship-batch/**`
where `ship-batch` is above 1, and a `Migration round-trip…` job where `migration-grant: reviewer`.
Ship counts push and pull-request runs only (or what `ship-gate-workflows` names); scheduled and
dispatched runs are set aside (`tools/lib/verify-runs.js`). Why: [ADR 607](../../docs/adr/607-ci-templates-guidance-two-lanes.md).

## Two lanes — light on every merge, heavy on official builds and nightly (#607)

The rule: [CONVENTIONS.md, *Two lanes — light on every merge, heavy on official builds and nightly (#607)*](../../CONVENTIONS.md#two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607).

- **Light** (`ci-<stack>.yml` → `ci.yml`), on every push: secret scan, build, typecheck/lint, the
  fast tests — about 5 minutes at p50. It is the lane ship reads. Its secret scan reads only the
  commits the run brings — a branch's commits not yet on trunk, or a trunk push's pushed range —
  never every fetched branch, so one branch's finding cannot red another branch's run (#716).
- **Heavy** (`ci-<stack>-heavy.yml` → `ci-heavy.yml`), never on a push: the whole suite,
  integration, browser/e2e, both configurations of a switched epic, load, and the secret scan of
  every commit trunk's tip reaches (job `secrets`, #716). It runs nightly on
  trunk's tip, and is skipped when trunk has not moved since the last green nightly. It runs at
  every official build: `release-tag.yml` publishes only on its green, and `release-auto.yml`
  finalizes a candidate only on its green run at that exact sha.
- **A red nightly is a trunk finding, not a merge block.** It opens one `trunk-red` issue per
  lane, naming the commits since the last green nightly.
- **The adopter marks heavy tests; an unmarked test is light**: a `test:heavy` script (Node), the
  pytest marker `heavy`, or the Pest/PHPUnit group `heavy`.
- **The trade-off:** a defect the light lane misses can sit on trunk for up to a day. A repo that
  cannot accept that declares another [integration profile](#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610).

## Integration profiles — where the heavy lane runs, and what a green trunk promises (#610)

The rule: [CONVENTIONS.md, *Integration profiles — where the heavy lane runs, and what a green trunk promises (#610)*](../../CONVENTIONS.md#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610).

`integration-profile:` in `project.yml` ([schema](../../project.schema.md#integration-profile-heavy-workflow--optional))
picks one shape. Every profile keeps the light lane on session branches; ship, release and promote read it.

| | `gated` | `qualify` | `release-heavy` (default) | `promote` |
|---|---|---|---|---|
| A landing (serial or batch) | waits on a **green heavy run at its sha** | light only | light only | light only, into `dev` |
| Heavy lane | every landing + release gate | trunk on a clock (the heavy cron, every few hours) + nightly + release gate | nightly (required) + release gate | at the `dev → main` promotion |
| Trunk promise | always heavy-green | heavy-red for at most one clock window | light-green; heavy-red until the next nightly | `dev` always heavy-green |
| A heavy red | blocks landing; a red wave splits toward the culprit | revert first, landings continue | a trunk finding naming the sha range; blocks the final | blocks the promotion |
| Meant for | trunk deploys or must always be shippable | tooling with many small landings a day | low-volume repos on a release train | repos already running `dev → main` for an approval gate |

- **Absent ⇒ `release-heavy`**, #607's shape: a repo that never declares changes nothing.
- **A final release needs the heavy lane green at its exact sha under every profile**, wherever the
  repo has one; still running (or not yet run) keeps the candidate testing.
- **`exposure: live` without `deploy: tag` may only declare `gated` or `promote`**: `qualify` and
  `release-heavy` allow a heavy-red trunk, and there the promotion deploys it. The audit fails it.
- **`release-heavy` is the higher-risk choice**: a red found late implicates the whole range, its
  authors usually gone — which is why its nightly is never optional.
- **`promote` is not for new repos.** For an approval gate prefer a merge queue on trunk, or a
  `release/x.y` branch cut from trunk.
- **Test tiers**, the vocabulary every profile uses: `smoke` (the dev machine) · `affected` (branch
  CI) · `integration` (a wave's cross-feature subset) · `full` (the whole suite) · `heavy` (e2e,
  multi-configuration, load). An adopter maps its tests with the [marker](#two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607); unmarked is light.
- **Revert first** (`qualify`, and `gated` when a red reaches trunk): bisect the red window with
  isolated re-runs of only the failing tests; retry a failure once before calling it red; revert
  automatically only a culprit an isolated re-run proved, otherwise a human or coordinator decides.
  The fixer gets a brief: failing tests, log excerpt and run link, culprit with the bisect proof,
  the original issue, a reproduction command, the flaky-or-real verdict, and the revert to re-land with a regression test.
- **Batch size:** start at 4–6; tune from the per-branch wave failure rate and the flake rate.

Why each shape, and why only `gated` changes ship: [ADR 610](../../docs/adr/610-integration-profiles.md).

## One verdict per tree — quick on branches, full once (#719)

The rule: [CONVENTIONS.md, *One verdict per tree — quick on branches, full once (#719)*](../../CONVENTIONS.md#one-verdict-per-tree--quick-on-branches-full-once-719).

Where each of the four rules is kept today:

| Rule | Kept by | Reads as |
|---|---|---|
| 1. A tree's green run is reused where the tree lands | the reusable `.github/workflows/ci-light.yml` (#721, called through `templates/ci-call.yml`) and the light templates' `dedupe` guard: sha mode on a ref's first push (#418); tree mode on a trunk push (#493) and on a `ship-batch/**` ref's first push (#717) — sha first (#552), newest reusable first (#592) | `tree-already-green` notice naming the run relied on ([ci-gate](ci-gate.md)) |
| 2. Light on branches; full/heavy once per sha, where the profile says | the two lanes and [`integration-profile:`](#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610) | the table above |
| 3. A schedule skips a passed sha; one dispatch per sha | the heavy templates' `plan` job: the nightly skips when its tip is the last green nightly's sha, or a green dispatched run of the same workflow tested it (#719); `colab ship` / `colab release` dispatch the heavy lane only when no run exists at that sha | `heavy-skipped` notice |
| 4. A trunk-only job never blocks reuse | a separate workflow, or `TRUNK_ONLY_JOBS` in the guard (#717) | — |

- **Called, the guard reads the same runs a copy did** (#721): a called workflow's `github` context is the
  caller's, so the run id and the workflow id are the caller's. Its jobs are listed as `<caller job> / <job>`,
  so #511's skip rule matches the guard and every `trunk-only-jobs` name exactly or as that ` / <name>`
  suffix. The audit reports a copied gate, and a gate that never skipped in its last 10 trunk runs, as
  drift ([handbook-sync §7](../../skills/handbook-sync/7-convention-drift.md#a-copied-ci-gate-or-one-that-never-skips-721)).
- **Rule 1 does not reach a branch's later pushes.** The guard is skipped at scheduling on a non-creating
  branch push, so a session's first real commit always gets a run of its own at its own sha (#418).
- **Under `gated`, a landing's light run may still be a reuse** — the landing's verdict is its heavy run
  at that sha; the light lane's skip only avoids testing the same tree twice.
- **`TRUNK_ONLY_JOBS` names jobs outside the gate only.** A cited branch run that skipped one of them is
  still reused, because that job's `if:` never reads the guard's `tested` output and so runs on trunk
  anyway. A suite job, or any job behind the gate, must never be listed: trunk would then skip it a second
  time — exactly what #511 refuses. Empty (as copied) keeps #511 unchanged. A workflow of its own is
  simpler and needs no list.

## CI artifacts — your own store, not the allowance (#601)

The rule: [CONVENTIONS.md, *CI artifacts — your own store, not the allowance (#601)*](../../CONVENTIONS.md#ci-artifacts--your-own-store-not-the-allowance-601).

**Files passed between jobs go through a store the organisation owns, not GitHub's capped
artifact allowance** — `.github/actions/artifact-store/`, one for one with the official actions
(`mode: publish` for release files): [`docs/artifact-store.md`](../../docs/artifact-store.md).

## Self-hosted runners — capacity is the agent count, not the machine (#355)

The rule: [CONVENTIONS.md, *Self-hosted runners — capacity is the agent count, not the machine (#355)*](../../CONVENTIONS.md#self-hosted-runners--capacity-is-the-agent-count-not-the-machine-355).

The templates assume GitHub-hosted capacity: every job gets a fresh machine the moment
it is queued. **A self-hosted runner breaks that assumption, and a flow copied unchanged
spends most of its wall time waiting rather than working.** Why, with the measurement: [ADR 539](../../docs/adr/539-ci-toolchain-rationale.md).

- **A repo's capacity is how many agents it has, not how big the host is.** One agent
  runs one job at a time for that repo, whatever the host has spare.
- **Measure queue and work separately, at job and step level.** Run duration
  (`created → updated`) adds the two together, so a slow suite and a starved runner read
  identically. Compare each job's `startedAt` with the run's creation time, and each
  step's duration with the job's, before you optimise either.
- **Where the merge gate waits for a completed trunk run, give trunk its own agent.**
  Branch runs that are informative only must not delay the one run a merge waits for.
  Use **disjoint** label sets: trunk → the `trunk` class, everything else → `quick` or
  `full`, chosen in `runs-on` with an expression on `github.ref`
  ([*Runner classes*](#runner-classes--moving-a-pool-from-host-labels-720)). Until that lane
  exists, a single shared agent is also why a copied template's every-branch trigger
  goes back to trunk-only, with `pull_request` restored ([*Branch CI*](ci-gate.md#branch-ci--the-candidates-own-run-read-as-a-class-314), #384, #512). Two traps:
  - **A label no online agent carries leaves the job queued forever, with no error.**
    Register the agent before merging the routing, and change the routing in the same
    change that retires the agent.
  - **Route every job of a trunk run, including non-blocking ones.** A run is not
    *completed* until its last job is, and `continue-on-error` does not change that.
- **With few agents, every job is a queue slot.** A 13-second job (a secret scan) that
  sits in its own job costs one more wait per run. Fold it into the main job as its
  first steps; it still runs on every run and still fails the job before any test
  starts. The main job must check out full history: the scan computes its range against
  trunk, and both ends of it must be in the clone (#716). Split jobs
  out again only when there are enough agents to run them side by side.
- **Never run the same check twice in one job.** Drop the copy whose removal breaks
  nothing; a test that pins the test script's shape decides which one that is.
- **Test parallelism follows the cores the runner *exposes*, but more cores only help a
  CPU-bound suite.** Runners that size their concurrency from `os.availableParallelism()`
  (node:test does) are capped by the container's core limit, not by the host's. Raising
  that limit is cheap on a memory-bound host, and it is not a speed-up you can assume. Before you count on a gain, compare the batch's wall time with the CPU it
  actually used.
- **Cap test-runner workers in CI with a fixed number. Size it to the slot's memory,
  not to the CPUs the job can see (#478).** The bullet above assumes the slot limits
  cores. Many slots limit only memory: they run as a memory-capped cgroup, and the
  job's tmpfs work dir (`node_modules` included) counts against that cap. The job
  still sees every CPU on the host. A runner that sizes its pool from
  `os.availableParallelism()` (vitest, jest, node:test, playwright; pytest-xdist
  `-n auto` and parallel PHPUnit do the same) then starts one worker per *host*
  core, so the worker count changes when someone upgrades the host.
  - The fix is a cap in the test config, read from CI so that local runs keep
    their full parallelism: vitest `maxWorkers: process.env.CI ? 4 : undefined`,
    jest `--maxWorkers=4`, node:test `--test-concurrency=4`, playwright
    `workers: process.env.CI ? 4 : undefined`. Pick the number from the slot's
    memory divided by one worker's peak, with room left for the work dir. Do not
    use the core count.
  - If a suite that used to be green starts timing out on a self-hosted pool with
    no code change, check the slot's memory pressure (`memory.events` `high`) and
    the worker count before you widen any timeout.
- **Before adding an agent, check the runner's disk as well as its memory.** Each agent
  brings its own runner install and workspace (GBs for a Node repo). On a
  memory-bound host, a second agent inside an existing runner container buys the same
  concurrency as a new container, without a second OS's overhead.
- **A persistent runner never resets, so tests must clean up after themselves.** A test
  that makes a temp dir and never removes it leaks on every run. The same persistence
  makes a hosted cache action redundant: the package cache is already on disk.

## Runner classes — moving a pool from host labels (#720)

The rule: [CONVENTIONS.md, *Runner classes — `runs-on` names a job class, never a host (#720)*](../../CONVENTIONS.md#runner-classes--runs-on-names-a-job-class-never-a-host-720).

**Which class each template job takes**, once a private repo goes self-hosted (every template
ships `ubuntu-latest`, and each `runs-on` line's `EDIT:` names its class):

| Job | Class |
|---|---|
| `dedupe`, `gitleaks`, the light-lane `build` (ci-node/python/laravel) | `quick` or `full` on a branch — `quick` only when the whole job keeps quick's promise; `trunk` on trunk |
| a service-container job (the Laravel database, the migration round-trip) | `e2e`, on every ref |
| the heavy lane's suite (`*-heavy.yml`) | `e2e` with service containers, `browser` when browser-driven, else `trunk` |
| the heavy lane's `plan`, `secrets`, `report`, and the release jobs (`release-tag.yml`, `release-auto.yml`) | `trunk` — they run only on trunk or a tag |
| deploy, publish/signing, `deploy-xserver.yml`, Windows/macOS builds | their own restricted label, outside the classes |

The ref expression, for a job that takes `trunk` on trunk and `full` elsewhere:

```yaml
runs-on: ${{ fromJSON(github.ref == 'refs/heads/main' && '["self-hosted","trunk"]' || '["self-hosted","full"]') }}
```

On a repo with its own capped lane, every list gains the lane label: `["self-hosted","<repo-lane>","trunk"]`.

**Moving a pool off host labels is additive, in four steps.** A runner reads its labels only when
it starts, so each label change needs an idle restart of each slot.

1. **The class names are fixed** — the table in CONVENTIONS §7.
2. **The pool adds the class labels beside the host labels** it carries today, restarts each slot
   while it is idle, and confirms each class is online.
3. **Workflows switch to class labels**, one repo at a time, and only to a class the pool has
   confirmed. A job asking for a label no online runner carries stays queued forever and never
   fails.
4. **The pool drops the host labels last**, once no adopter's workflow names one. A host label is
   kept only until every adopter has moved.

**Memory decides between classes.** A slot's memory cap counts the job's in-RAM work directory.
Put a job that peaks above about 8 GB on `browser` (or a heavier class the pool defines), never on
`quick` or `full`.
