# code-wrap · Hand off — a partial wrap is a checkpoint

Reference for [`code-wrap`](SKILL.md) Hand off. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### A partial wrap is a checkpoint, not the end of your turn (#486)

The stop at the top of this section means **stop before `code-ship`** — it does not mean
the session's work is over. A wrap whose distill (A1) lists remaining work on an issue
this branch **still claims** — "issue X done, Y half done, Z design only" — is an
**interim checkpoint**: it saves progress to the Issue and the remote, then the session
**continues with the remaining items**, in the same turn.

It may end its turn on a partial wrap only when it names a **concrete blocker** for every
unfinished item, **on the Issue**, as its own line:

```
Blocked: <what is missing> — <who or what clears it> (<link: issue, decision, run id>)
```

"Needs a design ruling from <role>, filed as #M", "waits on #M to land first", "trunk CI
red since <sha>, not this branch's" — each is a blocker: something outside this session
must happen first. "Ran out of steam", "the rest is follow-up", "left for the next
session" are not blockers, they are the work. With the line posted, the blocker **is** the
hand-off: report it first, above the checklist, so whoever reads the report sees why the
session stopped, not just that it did.

The third exit is giving the remainder away explicitly: move the unfinished item to its
own issue (agent-filed, A1), drop it from this branch's claim, and say so — then the wrap
is no longer partial. Silently ending the turn with claimed work outstanding is not one of
the exits.

Why: [ADR 536](../../docs/adr/536-code-wrap-handoff-partial-wrap-rationale.md).
