# code-wrap · A3 The hermetic run — what it does, its verdicts, the branch-CI stand-in

Reference for [`code-wrap`](SKILL.md) A3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

It runs the test step once as-is, then again with a fresh empty `HOME`, every variable
whose name marks a service address, credential, socket, proxy or agent/dashboard/daemon
runtime unset (`*_URL`, `*_TOKEN`, `*_KEY`, `COLAB_*` and the rest are listed in
`colab gate-hermetic --help`), and the network off where the platform allows it. It
always prints which network mode it used. Lint and type checks are not rerun — only the
test step reads the environment in the way this catches. A toolchain manager's home
(`RUSTUP_HOME`, `CARGO_HOME`, `PYENV_ROOT`, `GOPATH`, … — the list is in `--help`) is
pinned to its real directory before `HOME` moves, when you have not set it and the
directory exists, and each pin is printed (#447).
`--no-pin` gives the strict run back.

| verdict | means | A3 is |
|---|---|---|
| `green` | both runs passed | green |
| `skipped` | trunk's `project.yml` declares `live-env: none`; the skip is printed | green if the normal run is |
| `red` | the normal run fails — an ordinary red gate | red — fix it as above |
| `live-env` | normal green, hermetic red: the named tests depend on **this machine** | **red** — they will fail on every runner |

- **`live-env` is a red gate, not an advisory.** Fix the test so it builds its own
  fixture: a temp `HOME` it creates, a server it starts itself, an env var it sets for
  its own child process. Do not add `--keep` to make it pass. `--keep` exists for a
  variable the suite genuinely needs and the name rules strip. Each kept variable is
  printed, so name it and say why in the distill comment. A `live-env` that prints the
  toolchain `hint:` is a manager whose install is not at its default home: export its
  home variable and re-run. That is not a reason to `--keep` something else.
- **Record the verdict word in A1's distill and in the hand-off**, not only "gate green".
  `code-ship` §0 reads it.
- **Not a substitute for A5's branch-CI read.** Runners differ in more than environment
  (OS, toolchain, a browser to boot). This closes one cause before the push. A5 still
  reads the rest after it.
- **The reverse does hold: a green branch-CI run can stand in for the local hermetic run
  (#408).** Where the repo's CI runs on this branch, A5's read can supply the verdict
  instead, and you record it as **`branch-ci <sha7>`**. All three conditions must hold,
  and you check each one, not assume it:
  1. A5 reads **`green`** at the branch's current head sha. The sha you record is that head.
  2. That run's workflow **runs the same test command** as this gate. Read the workflow
     file's `run:` steps; a job that only lints or builds does not count.
  3. Its runner **does not share a developer's machine**: a hosted runner or an ephemeral
     container runner. A self-hosted runner running in someone's login session inherits
     their `HOME` and daemons, so it proves nothing about `live-env`.

  In any other case, run `colab gate-hermetic` locally as above: no CI trigger for this
  branch (for example a workflow that runs only on `pull_request` with no PR open), a class
  other than `green`, or a workflow that does not run the tests. Taking this path means the
  normal local run in A3 still happens, but the hermetic half waits for A5; if A5 then reads
  anything but `green`, run `colab gate-hermetic` before you hand off.
- **Run a long suite once, with its output teed to a file; grep the file for each question
  after that** (`<test command> 2>&1 | tee "$TMPDIR/gate.log"`, with `set -o pipefail` so the
  pipe keeps the suite's exit code). Never re-run the suite to read a different slice of its
  output.
- No `colab` on this machine → do the same by hand and say so: `env -i HOME="$(mktemp -d)"
  PATH="$PATH" <test command>`, network left on (say that too).

Why: [ADR 536](../../docs/adr/536-code-wrap-a3-hermetic-rules-rationale.md).
