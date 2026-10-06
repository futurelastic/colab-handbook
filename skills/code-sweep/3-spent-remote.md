# code-sweep · §3 bucket `spent-remote`

Reference for [`code-sweep`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### `spent-remote` — a shipped branch nobody deleted

**Report only. Never delete it, not even with every issue closed and `colab landed`
reading `landed`.** #17 ruled that removing refs from a shared remote is the wrong default
for an agent, however well verified: reporting can be undone, deleting cannot. #331 kept
that ruling and added this bucket instead, so the pile shows up where sessions actually
look. `colab doctor` was the only mitigation before, and nobody schedules a doctor run.

- **The key is issue state, not `colab landed`.** A squash followed by trunk movement reads
  as `unknown`. Of the 54 refs measured in #331, 32 read that way while every one of their
  issues was closed. An `unknown` spent ref is not unshipped work, and a `landed` verdict
  is not permission to delete. Neither verdict belongs in this decision.
- **Every issue a branch carries must be CLOSED.** One open number makes the branch live.
  That includes a reopened issue: its old branch may be exactly what the next session
  continues from (`code-start` step 3).
- **Say when an issue closed as something other than COMPLETED.** §1.3 prints the
  `stateReason` (for example `NOT_PLANNED`). An issue closed without shipping can leave a
  branch holding the only copy of its work, the `unlinked` lesson in a different shape. It
  is still `spent-remote`, but give the reason on its line so the human deleting it knows
  to look first.
- **Does not stop the merge loop and needs no CI.** It merges nothing, so a dead trunk CI
  does not touch it (§4).
- **Deleting is the human's act.** Name the refs in §6. If you print the command, label it as
  the human's: `git push origin --delete <branch> …`. Do not run it. If the pile keeps
  growing after this bucket exists, the fix is to bring #331's option A (delete by default at
  ship) back to a human with the count. Quietly pruning from a sweep is not the fix.
