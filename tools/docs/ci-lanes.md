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
  fast tests — about 5 minutes at p50. It is the lane ship reads.
- **Heavy** (`ci-<stack>-heavy.yml` → `ci-heavy.yml`), never on a push: the whole suite,
  integration, browser/e2e, both configurations of a switched epic, load. It runs nightly on
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
  Use **disjoint** label sets: trunk → a trunk-only label, everything else → the
  general one, chosen in `runs-on` with an expression on `github.ref`. Until that lane
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
  starts. The main job must check out full history, which the scan needs. Split jobs
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
