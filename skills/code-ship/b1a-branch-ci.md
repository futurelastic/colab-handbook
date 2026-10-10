# code-ship · B1a The branch's own CI

Reference for [`code-ship`](SKILL.md) B1a. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### B1a. Now read the BRANCH's CI too — beside `<base>`'s, not instead of it

The check above answers *"is the thing I am merging into healthy?"*. It says nothing
about the thing being merged. Both have to be true, and until now nothing in this chain
asked the second question: `code-wrap` asserted a **local** gate, this section read
`<base>`, and `colab ship`'s cure rule touched the branch's run only as a side
condition.
Why: [ADR 536](../../docs/adr/536-code-ship-b1a-branch-ci-rationale.md).

`code-wrap` A5 reports the class for the sha it pushed. **Re-derive it here — do not
take the report's word for it.** The head may have moved (B0's sync commit moves it by
design), and §0's rule is that this skill verifies the contract from git and GitHub
rather than trusting the session:

```sh
BHEAD=$(git rev-parse <branch>)
gh run list --branch <branch> --limit 20 \
  --json headSha,status,conclusion,workflowName,databaseId \
  -q "[.[] | select(.headSha == \"$BHEAD\")]"
```

Same four classes as A5 — `green` · `none` · `red:infra` · `red:finding` — defined,
with their quantifiers and next steps, in `CONVENTIONS.md`
[§4](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314),
*Branch CI*. Each has a named next step, so none of them is a park; here is what that
step is in this skill:

| class | what this skill does |
|---|---|
| `green` | proceed to B1b |
| `none` | **Depends which `none` — check before you wait.** A run *queued or in flight* (including a slow sibling behind a green fast one, #307): wait, **bounded — the repo's CI wait bound for this candidate, then defer it** (below, *The wait is bounded*, #370). A run that **cannot arrive for this ref** — no workflows, or workflows triggering only on `pull_request` / `push` to trunk — is not pending: proceed, exactly as the no-runs line above already allows for `<base>` — and **B2a then reads the trunk run at your squash before any evidence is posted**, because that run is this change's first. A5 reports which; re-read the triggers if it did not. **At a red `<base>`, "proceed" reaches B1's stop** — only the branch carrying the fix may open a PR to get a run (*Red trunk*, above; `colab ship` closes that PR once the branch lands, #584); a bystander waits |
| `red:infra` | **re-run it once** (`gh run rerun <databaseId> --failed`), then re-read. Identical failure twice ⇒ it is the runner, not the branch: hand it to the **ops lane** and stop. Do not merge, and do not send it back to the implementer — there is nothing in the diff for them to fix |
| `red:finding` | **send back to the implementer, as a class** (§0, *send-back*, #409) — the branch's own suite found something. Never a merge, never a re-run, never a fix from here |

**How this lands against *What a defer is for* (#257) — it does not loosen it.** A twice-
identical `red:infra` is precisely that section's first legitimate case: *a red or dead
precondition the coordinator cannot itself clear*. So record it as a defer with the clock
that section requires — precondition: the runner, not the diff; what clears it: a green
run on `<base>`; re-measure trigger: that run. What is still never a defer is unchanged:
`red:finding` is a hand-back to an implementer, not a park, and nothing about the
originating session's composer, silence or parked state enters this decision at all —
every step here runs in the coordinator's own worktree.

- **The wait is bounded — the repo's CI wait bound per candidate, then a defer (#370).**
  The bound is measured from the repo's own CI history, never a handbook number (#559):
  `colab ci-profile` prints it — 2 min + `ci-wait-factor` × the p95 of its branch runs, 15
  minutes while it has no history — and `colab ci-wait` uses it when no `--timeout` is given.
  Why: [ADR 536](../../docs/adr/536-code-ship-b1a-branch-ci-rationale.md).
  Wait with `colab ci-wait`, with a wall-clock cap:

  ```sh
  colab ci-wait --sha "$BHEAD" --branch <branch>   # every run at the head sha; deadline = the bound
  ```

  **`colab ci-wait` is the only way to wait for CI (#495)** — here, in `code-sweep`, in
  `code-wrap`, everywhere. Never hand-roll a `sleep N; gh run view|list` loop, never wrap
  `gh run watch` (it polls every 3 s), never run two waits for the same run (a second
  `ci-wait` on the same run in this checkout is refused, exit 6), never send `gh`'s stderr
  to `/dev/null` inside a wait, and never leave a wait running in the background after
  your turn ends.
  Why: [ADR 536](../../docs/adr/536-code-ship-b1a-branch-ci-rationale.md).
  `ci-wait` backs off 30 s → 60 s → 120 s, sends conditional requests (a 304 is
  free), and costs about 10 calls for a 15-minute run. It exits with the outcome:

  | exit | outcome | what this skill does |
  |---|---|---|
  | `0` | GREEN | re-read the class — `green` only if **every** run at the head sha is |
  | `1` | RED | classify the red as below |
  | `3` | TIMEOUT | the cap expired — the defer below |
  | `4` | RATE_LIMITED | **stop the pass**, not just this candidate: the quota is gone for every agent until the reset time it prints. Record the defer with that time as the re-measure trigger; do not retry |
  | `5` | UNKNOWN | the read failed or returned an unknown state — defer, quoting its output |
  | `6` | ALREADY_WAITING | another session is waiting on this run — defer on its run id; do not start a second wait |

  **The cap expired** → record a
  defer with the clock *What a defer is for* requires — precondition: branch CI in flight
  at `<sha>`; clears on: that run completing `green`; re-measure trigger: run
  `<databaseId>` completing — and **end this candidate's turn**. That is the legitimate
  kind of defer, a precondition the coordinator cannot itself clear; it is never a reason
  to hold the pass open. Under `code-sweep`, the pass moves on to the next candidate and
  the deferred one is re-measured by its run id on the next ping (`code-sweep` §0,
  §4.0), not by waiting here. Fifteen minutes covers one ordinary CI run plus queueing;
  a repo whose normal run is longer than the cap should expect its candidates to defer
  once per push — say so, rather than raising the cap silently.
- **Re-running is mechanical, and it is the only CI action permitted here** — same
  boundary as §0's push rule. One re-run per red episode, not per attempt: a second
  identical failure is evidence, and spending re-runs on it just moves the wall further
  out.
- **B0's sync commit invalidates an earlier class.** If you merged `<base>` in, the sha
  A5 measured is not the sha you are about to merge. Push the sync commit and read the
  class again for the new head — a green class inherited from a pre-sync sha is exactly
  the "green run on a different commit" this whole section exists to refuse.
- **A green class on a head that lacks the current `<base>` tip is `stale-base`, not
  `green` (#395).** `colab ship`'s own B0 merges `<base>` in *locally* and squashes without
  that synced head ever running, so a textually clean merge used to land on a verdict that
  never saw what `<base>` gained since. Measured:
  two branches, each green alone — one changed a shared test base class the other's new
  tests also relied on, and trunk went red on the combination. `colab ship` (dry and real)
  now refuses with a `branch run contains current base (#395)` row, class `self-clearing`,
  whenever a branch run exists at the pushed head and that head does not contain
  `<base>`'s tip. The fix is mechanical and yours: B0 (merge `<base>` in), push, wait on the
  new run under the same bound, re-run ship. A head with **no** run (workflows
  that cannot fire for a branch ref) is not stale — B2a covers it. A batch member is exempt:
  the combined run is its re-read. Skipping the re-run because "the new `<base>` commits
  touch nothing this branch's tests import" is **not** allowed — that cannot be measured
  generically, and a guess is exactly what produced the incident.
- **In a batch (#373), the combined run is that re-read — once, for every member.** Its head
  is trunk plus each member's squash, so it grades each member's synced state; do not also
  re-run each member. Read it through `colab ship --batch` (it applies the same all-runs rule
  and counts the one re-run), wait on it with the same bound, and classify its red
  exactly as a branch red — only the one re-run belongs to the batch; after that, serial.
- **Never wait out a bound on a repo whose workflows cannot fire for a branch ref.**
  That shape is a workflow that triggers only on `push: branches: [<trunk>]` and
  `pull_request`: `code-wrap` A5 does not open a PR by design, so branch CI genuinely
  does not exist there before the merge, and `<base>`'s own gate at B1 is the whole CI
  story.
  That is a normal state, not a degraded one; say so in the report rather than treating
  it as a missing measurement. The story does not end at the merge, though: the trunk
  run at the squash sha is this change's first run, and B2a reads it before B2b.
- **Telling infra from finding — run the test, do not judge by feel** (§4, *Branch CI*,
  #354; the exit code answers first where the repo separates 1 from 2). In order:
  1. **Any named failing assertion ⇒ `red:finding`**, whatever else the run shows. Never
     re-run it — a green second run hides the defect.
  2. **Else `red:infra` if the tests never ran:** duration far below this repo's norm for
     the workflow (`gh run list --workflow <w> --status success -L 10 --json startedAt,updatedAt`),
     `gh run view <databaseId> --log-failed` empty, or environment text — `EADDRINUSE`,
     `signal: killed`, a lost runner, queued for hours then failed with no log.
  3. **Neither ⇒ `red:finding`.**

  A **timeout** counts as infra only with evidence the host was loaded (load, swap, I/O
  pressure) — on an idle host it is a slow-test bug. An **`EADDRINUSE`** red is re-run to
  unblock and, if the collision is the code's own (a random port with no retry), filed as
  a defect too; the re-run and the filing are not exclusive.
- **Cannot separate `red:infra` from `red:finding` even so?** Read it as `red:finding` and
  hand back (§4, *Branch CI*: a wrong hand-back costs one look, a wrong `red:infra` burns
  the re-run and parks the work in a lane nobody is watching).
