# code-wrap · A3 Notify the dashboard

Reference for [`code-wrap`](SKILL.md) A3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Notify the dashboard, best-effort

Once the verdict is known, report it to a session dashboard's hand-off checklist, when
one is configured — its mark "does this branch have a recorded quality-gate result?".
Read-side and persistence already live there; this is the only write call site (#116):

```sh
colab gate-recorded             # gate came back green
colab gate-recorded --fail      # gate is red, for a reason unrelated to this branch's own change
```

Same posture as every other `colab` notify call: silent when `notifyUrl` is unset
(the default — nothing above breaks without it), fire-and-forget, never fails or
slows this step. It resolves the worktree from cwd against `colab worktrees` and
`HEAD`'s own sha automatically — pass `--worktree <name>` / `--sha <sha>` only when
running it from somewhere other than the worktree whose gate just ran. No `colab`
installed → skip this call; A3's own verdict (above) is still what governs A4/A5.
