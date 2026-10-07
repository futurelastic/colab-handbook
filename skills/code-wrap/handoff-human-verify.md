# code-wrap · Hand off — a person-only check is a Human-verify row, not a hold

Reference for [`code-wrap`](SKILL.md) Hand off. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurement
behind them (#524).

### A person-only check is a Human-verify row, not a hold (#541)

This is the implementer's half of `CONVENTIONS.md`
[§5 *Human verify*](../../CONVENTIONS.md#human-verify--a-person-only-check-closes-the-issue-and-becomes-one-row-491)
(#491). `code-ship` already closes an issue whose only leftover is a check a person must
run and moves that check onto one row of the repo's `Human verify:` issue. This step covers the
wrap that comes before it, so the issue reaches ship as a finished branch and does not stop
the queue first.

**When it applies.** All the code is on this branch, the gate is green (or red for an unrelated
reason, reported in A3), and the only acceptance item left is a check that **only a person** can
run. For example:

- a look or a click-through on a **real device** (a phone, a laptop lid closing, a printer);
- a run against a **real account, credential or third-party service** that a test cannot reach,
  such as staging with live data, a real payment sandbox, or a real mailbox;
- a **visual check** by eye that no screenshot assertion stands in for.

Tests against a fake server or a stub do not change this. They are the code's oracle, and they
passed. The leftover is what a fake cannot prove.

**What the wrap does — all in this step:**

1. **No hold, no human-wait label.** Do not add `blocked:needs-boss`, the repo's `holds:` label,
   or any `deferred:*` label to the source issue. Do not post a `Hold:`/`Blocked:` line for this
   check. The issue stays claimed and goes to `code-ship` like any other finished branch.
2. **Append one row to the repo's single open `Human verify:` issue**, and file that issue if
   none is open. Use the same command `code-ship` B1b uses, so both halves write the same shape:
   ```sh
   HV=$(gh issue list --state open --search 'in:title "Human verify:"' --json number -q '.[0].number')
   [ -n "$HV" ] || HV=$(gh issue create --title "Human verify: checks waiting on a person" \
     --label delivery:ops --body $'Each row is a check only a person can run. Tick it when it passes; a failed row becomes a new bug issue.\n' \
     | sed 's#.*/##')        # also add this repo's human-wait label from `holds:`, if it declares one
   gh issue comment "$HV" --body $'- [ ] #'"$N"$' — <exact steps to run>\n  Evidence wanted: <what the person posts back>'
   ```
   The row must stand alone: the source issue, the **exact** steps (which build, which device or
   account, what to do, what should happen), and the evidence wanted back. "Verify on a real
   device" is not a row. Someone must be able to run it without opening the source issue's thread.
   A run of the command found an existing row for `#$N`? Do not add a second one; edit that row.
3. **Tick the plan item and point at the row.** If the check is a `## Plan` box on the source
   issue, tick it with the row's location, for example
   `- [x] real-device check → Human verify #<HV>`. An unticked box with no `Remainder: #M` makes
   `colab ship` refuse the merge. `Remainder:` is for **code** that is left, so do not use it for
   this check.
4. **Say it in the distill (A1) and the hand-off report:** `person-only check → Human verify
   #<HV> row; ships as Closes #$N`. Ship then sees the row already exists and does not add it a
   second time (`code-ship` B1b).

**When a hold is still right.** A hold on the source issue is legitimate only for a real
**decision** that blocks the code itself, and the `Blocked:`/`Hold:` line must name it:

- a ruling on behaviour or scope (comment the options and add `needs-decision`);
- money;
- credentials or security, such as a secret that has to be issued or rotated before the code can
  run at all;
- design approval for a surface that has no ruling yet.

"Someone has to try it on the real thing" is none of these. If the person-only check **fails**
later, the failed row becomes a new bug issue linked to the source, per §5. The source issue stays
closed, so nothing waits on a check that may well pass.

**Measured (one adopted repo, 2026-10-06).** One day after #491 shipped, an implementer finished
a feature: tests against a fake server were green, the branch was pushed and the wrap was posted.
It then parked its own issue with `blocked:needs-boss` and the line "Blocked: real-device
measurement — needs staging server + a lid close". The host froze start, ship and heal on that
issue. Four issues with a `blocked_by` edge to it waited about 15 hours, and the branch became
conflicted in the meantime. #491 had given the rule to `code-ship` only, and the wrap's
partial-wrap exit (a `Blocked:` line ends the turn) read the device check as a blocker.
