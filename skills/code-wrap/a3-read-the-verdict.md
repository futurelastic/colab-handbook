# code-wrap · A3 Read the verdict, not the transcript

Reference for [`code-wrap`](SKILL.md) A3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Read the verdict, not the transcript

On a repo with a real suite, the gate's raw output is not a rounding error next to
`CLAUDE.md` — measured on one mature repo, 366,594 bytes (~104,700 tokens) of
combined stdout+stderr against a 113,989-byte `CLAUDE.md`, at 3,212/3,213 green.
The volume is structural, not a sign of trouble: a TAP-style runner emits a
`# Subtest:` line **and** an `ok N` line per assertion, so it scales with
assertion count — which every convention here encourages growing. And it does not
cost once: gate output joins the cached prompt prefix, so a run at turn 10 of a
40-turn session is re-read on every turn after, not paid for a single time.

A list of test names that passed is the least informative text a session can hold.
Filter before reading it back:

```sh
<gate command> 2>&1 | grep -E '^(not ok|# fail|# pass|Test Files| *Tests )'
```

Adjust the pattern to the runner's own vocabulary — Jest/Vitest, `phpunit`,
`pytest` each summarize differently; grep the one line format that carries
pass/fail counts and failing test names, not the runner's default default verbosity.

- **Quiet on green: pass counts only.** Detailed on red: the failure count and the
  name + `file:line` of each failing test, not just that some failed.
- **The exit code is the verdict — preserve it.** A naive pipe through `grep`
  returns the filter's exit status, not the gate's; `set -o pipefail` (or capture
  the gate's own exit code before piping) so a red gate cannot read as green. Get
  this wrong and it is worse than reading the raw transcript.
- **More than one runner (e.g. lint + tests) → filter each one.** A filter tuned
  to one runner's output silently drops the other's failures, which reads as a
  pass.
- Truncation is not a substitute for filtering: a long run can push the one
  failing line past a tool's read window while the summary sits further down
  still — the filtered command above avoids ever emitting the noise, rather than
  hoping the reader's truncation point lands somewhere safe.
