# code-triage · §2 Taken, half-claims, and parked `deferred:*` claims

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


Two passes, in this order — the cheap one first.

**Taken** — `in-progress`, or a live claim, is someone else's:

```sh
colab claims                                 # includes host + session + name
```

**Half-claim — neither free nor taken (#323, `CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), *Who holds this*).**
A claim is the assignee *and* `in-progress`. An open issue with an assignee but no label,
or the label but no assignee, is a **broken claim**: discard it from the start list
exactly as if it were taken, and report it under its own heading with the repair — the
assignee completes it (adds the label) or drops the assignee. Never read an assignee
alone as "free", and never as a live claim to wait on indefinitely: it is a finding with
a bounded fix. A group containing one is `blocked` on that repair, named.

```sh
gh issue list --state open --limit 1000 --json number,assignees,labels \
  -q '.[] | select((.assignees|length>0) != ([.labels[].name]|index("in-progress")!=null))
          | "#\(.number) assignees=\([.assignees[].login]|join(",")) label=\([.labels[].name]|index("in-progress")!=null)"'
```
A claim carries who holds it. If it looks stale, that is a **finding to raise**, not
permission to take the work.

**Exception — a `deferred:*` claim whose wake condition has resolved is re-surfaced, not
silently discarded (#290, #382).** `deferred:date` / `deferred:measurement` /
`deferred:external-party` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#disposition--a-park-must-name-its-wake-condition-279), *Disposition*) mark a claim genuinely
parked on something outside this repo — a human-gated permission it is still waiting on,
not abandoned. A bare `in-progress` can't tell "actively worked" apart from "parked,
waiting"; a claim carrying no `deferred:*` label is read exactly as before — this only
adds a check before the ordinary Taken rule fires on one that does:

```sh
gh issue list --label in-progress --search "label:deferred:date,deferred:measurement,deferred:external-party" \
  --json number,labels -q '.[] | {number, labels: [.labels[].name]}'
```

Evaluate the wake on **every** pass, not only once a `review-by:` date is reached (#382).
Read it from the newest `Hold:` line for the `deferred:*` label (*Held*, below, has the
command); fall back to the `review-by:<date>` label when there is no `Hold:` line. A later
ruling may have tightened the condition, so the newest line is the one that counts.

- **The wake is met** — every condition on the line, measured the way *Held* below
  measures it, or a `review-by:<date>` that is reached. Do not discard it under Taken, and
  do not silently restart the work either — the claim's holder may still be the right
  owner. Flag it in the report as *parked, wake met* (§6), naming the condition and the
  evidence, so a human or the holder checks whether the gate actually cleared and lifts
  the park; never fold it into the ranked start list as if it were unclaimed.
- **The wake names an issue or ref that does not resolve** — the park waits on nothing
  (`CONVENTIONS.md` *Holds*, rule 3). Flag it as *parked, wake unresolvable*, naming the
  reference, and list it first in the bucket.
- **No wake at all** — no `Hold:` line with a parseable `wake:`, and no `review-by:<date>`.
  A wait with no checkable form must carry a date (*Holds*, rule 2), so this is an unbounded
  park. It discards under the ordinary Taken rule same as before — but note it in the
  report, so a park with no clearing signal is at least visible rather than silently
  re-discarded forever.
- **The wake is not met yet** — ordinary Taken rule.
- **No `deferred:*` label at all** — ordinary Taken rule, unchanged.

This never re-runs the discarded issue's own work; it only stops a claim from staying
invisible once the thing it was waiting on has cleared.
