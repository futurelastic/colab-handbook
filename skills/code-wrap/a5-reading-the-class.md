# code-wrap · A5 Reading the branch-CI class

Reference for [`code-wrap`](SKILL.md) A5. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

- **A red class is data, not a failed wrap.** Do not go back and start fixing on a
  `red:infra` — you would be debugging the runner, in a session whose oracle is already
  green. Record the class and stop; §4's table says who acts next. `red:finding`
  is the one that names *you*, and even then only if the finding is this branch's —
  say so and let `code-ship` route it, rather than silently reopening the work.
- **Where the repo does not separate exit 1 from exit 2, you cannot infer the class
  from the conclusion alone** — `failure` is all GitHub reports. Read the failing job's
  log far enough to say which side of the line it fell on — §4, *Branch CI*, gives the
  ordered test (#354): a named failing assertion ⇒ `red:finding`; else a duration far
  below the repo's norm, an empty `--log-failed`, or environment text (`EADDRINUSE`,
  `signal: killed`, a timeout on a loaded host) ⇒ `red:infra`. If it genuinely cannot be
  told, it is `red:finding` (§4 gives the reason).
- **`none` splits two ways, and only one of them is worth waiting for.** Before
  reporting it, ask whether a run *can* arrive for this ref at all — read the triggers,
  do not assume:

  ```sh
  gh workflow list --all                       # what exists
  sed -n '/^on:/,/^jobs:/p' .github/workflows/*.yml   # what each one triggers on
  ```

  A workflow that fires on `push: branches: [<trunk>]` and `pull_request` produces **no
  run for a feature-branch push**, ever. Since A5 pushes a backup branch and explicitly
  does **not** open a PR, `none` on a repo of that shape is permanent, not pending. Say which
  one you measured:
  - `none (no workflow triggers on a branch push here — CI runs on PR/trunk)` → nothing
    to wait for; `code-ship` proceeds on it.
  - `none (run queued/in flight)` → `code-ship` does the bounded wait.
  - `none (no workflows on this repo)` → nothing configured at all.

- **`local` mode:** do not block the wrap waiting for a run to finish. Report `none`,
  say the run was in flight, and let `code-ship` do the bounded wait — it is the step that
  actually needs the answer.
- **`ci` mode (#410): this read IS the gate, so wait for it — bounded, 15 minutes, the same
  bound as `code-ship` B1a.** `green` → the gate is green; record
  `branch-ci <sha7> run <databaseId>`. `red:finding` → the gate is red: fix, commit, re-push,
  re-read (a new head needs a new run). `red:infra`, or still in flight at the cap → hand off
  with the run id and the class; `code-ship` B1a re-runs an infra red once and does the rest
  of the wait. Never fall back to running the full suite locally to "save" the wait — that
  is the double run #410 removed.

Why: [ADR 536](../../docs/adr/536-code-wrap-a5-reading-the-class-rationale.md).
