# code-triage · §5 Every label that affects a start

Reference for [`code-triage`](SKILL.md) §5. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


This READY list has to match what a conforming scheduler would start. So here is every
label that keeps an issue off that list, or off an unattended start, in one place. A label
not in this table and not declared under `holds:` does not block a start, whatever its
name suggests.

| Label | Blocks | Set by | Cleared by |
|---|---|---|---|
| `in-progress` (+ assignee) | everyone but the holder | the claiming session (`colab claim` / `colab worktree new`) | that session's wrap or ship, unconditionally |
| `needs-decision` | every start | whoever finds the question: a designer producing a spec, a filer, or `colab decision --reopen` for a second question | the human who rules, recorded with `colab decision --record` (never removed by hand) |
| `epic` | every start, permanently: a container | the filer | nobody; the epic closes once its children finish |
| a non-code `delivery:*` value (`content` / `ops` / `elsewhere` / `design`) | the code pipeline (route or design bucket, §2) | the filer or triage | whoever reclassifies it; it is never cleared just to start it |
| `deferred:date` / `deferred:measurement` / `deferred:external-party` | every start | whoever parks it, with a `Hold:` line | the `Hold:` line's owner, once the wake fires |
| each label under `holds:` in `project.yml` | every start | whoever parks it, with a `Hold:` line | the `Hold:` line's owner, once the wake fires |
| `agent-filed` | **unattended** starts only; stays on the READY list | the filing agent | never cleared. A human's start is the approval |
| `low-priority` | nothing; it ranks last (§6) | the filer or a human | a human, to release it to unattended starts |

`agent-filed` gets one line of its own in a ready group's report, because an unattended
reader must not start it:

```
       provenance: agent-filed — a human starts it; excluded from unattended starts
```

An open `blocked_by` edge and a half-claim also block. They are relationships and
claim state, not labels, and the checklist above covers them.
