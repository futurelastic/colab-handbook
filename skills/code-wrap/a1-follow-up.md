# code-wrap · A1 Filing a follow-up — agent-filed

Reference for [`code-wrap`](SKILL.md) A1. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Filing a follow-up here? It is agent-filed, and it must say so

This step is where most agent-initiated issues in the fleet are born: you found
something real, it is out of scope, so you file it rather than lose it. Keep doing
that — but a follow-up you decided to file is **work no human has approved yet**,
and it must be labelled so a batch-start tool can leave it alone
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#provenance--who-decided-the-work-should-exist), *Provenance*):

```sh
gh label create agent-filed --color C5DEF5 --description "Filed by an agent on its own initiative — not human-approved" 2>/dev/null || true
gh issue create --title "<type>: <thing>" --label agent-filed --body-file <tmpfile>
```

Record the returned number and, if `colab` is installed, follow with
`colab issue-filed <N>` — a best-effort notify event (`issue.filed`, #102) so an
external observer learns the issue exists without waiting out its own poll
interval. No `colab` on this machine means skip it.

End the body with the origin, naming the issue you were wrapping when you found it —
that is the breadcrumb back to the context — and, on the next line, the ask class
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#ask--the-filer-declares-the-ask-class-89), *Ask*) so a decision surface never has to re-derive it from
prose:

```
Filed-by: agent (during code-wrap of #$N, session <name>)
Ask: backlog
```

Use `permission` for a request to touch machine/prod state, `ruling` for a question
that resolves to a human judgment and never to a diff, `deferred(<trigger>)` when
you have already decided no action is needed until something else happens, and
`backlog` — the default a missing line reads as anyway — for an ordinary work
proposal.

**Before you file: would one session finish this?** If not, it is an epic — file
the parent for the goal and each item as its own issue, linked as sub-issues, with
`blocked_by` for real ordering (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate), *Epics*).

The distinction is intent, not keyboard. **If the human asked for the follow-up
during this session, it is theirs** — `Filed-by: boss (via session <name>)`, no
label. Only what you decided to raise on your own is `agent-filed`.
