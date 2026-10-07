# code-wrap · A5 Read the run the push started

Reference for [`code-wrap`](SKILL.md) A5. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**A3's green gate does not answer for this branch's CI, and nobody downstream asks.**
A3 runs the suite *locally*, on this machine; CI runs it on the runner.

So read it here, where the push just created it, and pass the answer forward as a
**class** rather than a pass/fail:

```sh
HEAD=$(git rev-parse HEAD)     # the pushed head — the only sha the class describes
gh run list --branch <branch> --limit 20 \
  --json headSha,status,conclusion,workflowName,databaseId \
  -q "[.[] | select(.headSha == \"$HEAD\")]"
```

**Still `none` because a run is in flight, and you are waiting for the verdict?** Wait with
`colab ci-wait --sha "$HEAD" --branch <branch> --timeout 15m`, then re-read — never a
hand-rolled `sleep N; gh run …` loop, never two waits on one run, never `gh` stderr sent to
`/dev/null`, never a wait left running in the background after your turn (#495; the
measurement and the exit-code table are in `code-ship` B1a, *The wait is bounded*). Exit `4`
(RATE_LIMITED) means the shared quota is gone: report the class as `none`, name the reset
time it printed, and stop — do not retry.

Why: [ADR 536](../../docs/adr/536-code-wrap-a5-read-the-run-rationale.md).
