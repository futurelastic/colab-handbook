# code-ship · B3 Release the claim(s)

Reference for [`code-ship`](SKILL.md) B3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B3. Release the claim(s)

**`colab ship` already did this for every claim it carried (#319)** — worktree claims
through `colab worktree rm`, and claims with no worktree (`--branch`-keyed, or unattached)
through `colab release`. Check `colab claims` rather than re-running it. Release by hand
only what ship did not carry: a kept worktree (`--keep-worktree`), a claim ship reported
and left in place (same session, but the branch does not name it), an issue evidence-close
left open that you are abandoning, or a machine without `colab`:

```sh
colab release $N        # if colab is installed …
gh issue edit $N --remove-assignee <claimer> --remove-label in-progress    # … else raw, one per issue
```

Drop **both** halves. A release that removes only the label leaves an assignee-only
half-claim, which every reader must now treat as a broken claim (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), #323).
`<claimer>` is the account that applied `in-progress`, not necessarily you: `@me` only when
you took the claim yourself. `colab release` reads it from the issue (#363).

Release **every** issue in the group, even ones you didn't finish — a stale claim
silently blocks others (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this)).

**No exceptions — not "unless unfinished", not "unless the worktree stays".**
`code-start` adds the claim, this skill removes it: symmetric and unconditional.
Because:

- A conditional release rule is one agents skip. The unconditional one is the one
  that actually gets executed.
- A claim is scoped to a **session**. Once the session ends it names a holder who
  no longer exists.
- Nothing ages a claim out. A kept-but-forgotten worktree would hold its issues
  indefinitely and **no health check flags it** — the worktree is alive, so the
  claim looks healthy.
- Re-claiming next session is one command already in the `code-start` flow. The cost
  of releasing is near zero; the cost of a stale claim is someone else blocked.

*Tradeoff, chosen deliberately:* releasing gives up the lock that stopped a second
session starting a colliding branch on a kept worktree. That protection now rests
on the **session-start check** — before starting, verify whether the work already
exists (`git log --grep`, grep the code, and look for an existing branch or
worktree for that issue) rather than trusting the absence of a label. `code-start`
already says *open ≠ untouched*; this is why.

**A `reject` verdict from B1c never reaches this step** — the claim stays held either
way: until a human resolves a `decision`-class rejection, or until the one bounded
auto-retry an `escalate`-class rejection recorded lands (and reverts to the same
human-held state if that retry rejects too, B1c's *Reject classifies further*). Either
class is the whole point of stopping at B1c rather than merging past it.
