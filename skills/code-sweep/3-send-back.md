# code-sweep · §3 bucket `send-back`

Reference for [`code-sweep`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### `send-back` — the coordinator never codes (#409)

Owner ruling: *"Ship session should never code. Should ask the code session to rework."* The
sweep is a coordinator. It never edits, commits or wraps implementer work; the rule is stated
once in [CONVENTIONS, *Who may touch a branch*](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409). A candidate whose hand-off does not
verify is therefore not wrapped here, it is **sent back**.

**Hand-off verifies** (⇒ `ship`) only if all three hold: the worktree is clean (no tracked
changes, no untracked files), the local head equals the origin head, and the head is older
than the newest non-bookkeeping comment on every carried issue (§3's test 3). Fail any one
and the candidate is `send-back`, provided it carries a claimed issue.

**The action is ONE Issue comment**, body starting with the fixed marker `↩️ Sent back`
(colab treats it as bookkeeping: it does not count as evidence and is not a hand-off comment).
It is addressed to the branch's implementer and says: commit the deliverable paths, run
[`code-wrap`](../code-wrap/SKILL.md), stop; plus the **specific gap found** (which files are
uncommitted, which commits are unpushed, or that no distill comment postdates the head).
Then report the candidate as sent back and continue with the next one.

- **Idempotent.** If a `↩️ Sent back` comment already exists on the issue and the branch head
  has not moved since it, post nothing; report `sent-back (pending since <ts>)`. A new commit
  on the branch re-arms it. While that comment stands at an unmoved head the candidate stays
  `send-back` whatever follows it, until a comment appears that is neither bookkeeping nor a
  bare signature line (test 3's filter, #517) — the `↩️` itself never reads as a hand-off.
- **A conflict needing judgment is a send-back too** (§4): the author rebases and resolves,
  the sweep does not.
- **`blocked` keeps what no implementer can be addressed about:** no claimed issue, or an
  issue that is not this repo's (see `unlinked`, `unrecorded`).
