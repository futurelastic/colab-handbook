# code-triage · §2 Non-code delivery — route or design

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**Non-code delivery — route or design, not a code start:**

```sh
gh issue list --state open --search "label:delivery:content,delivery:ops,delivery:elsewhere" \
  --json number -q '.[].number'      # route
gh issue list --state open --label delivery:design --json number -q '.[].number'   # design
```

An issue carrying `delivery:content`, `delivery:ops` or `delivery:elsewhere` is real work
whose completion is not a code commit *in this repo* — a content push, an ops/production
check, or code that lands in a different repository (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#delivery-type--route-not-start-112), *Delivery type*).
Leave it off the ranked list the same way an epic is: not because someone holds it, but
because there is nothing to branch on in *this* pipeline. Report it in its own **route**
bucket, distinct from the epic bucket — see §6 — so a human sees where it actually needs to
go instead of it reading as silently dropped.

An issue carrying `delivery:design` (#359) is a new surface's design artifact — a design
session's start, never the code pipeline's. Leave it off the ranked list too, but report it
in its own **design** bucket (§6), not the route bucket: it is not going anywhere else, and
the build issues its `blocked_by` edges hold back are waiting on it.

**Off the ranked list does not mean off the readiness pass (#380).** A design lane gates on
`deps-checked` the same way the code lane does, so a design issue left unstamped stays held
with nothing wrong, and every build issue `blocked_by` it waits too. So run §5's
first gate on every unclaimed `delivery:design` issue that carries no hold, by the same bar
as a code issue. Read the edges (`gh issue view <N> --json blockedBy`), judge any open
blocker's state (§5.1), then write or clear the marker exactly as §6's *persist* step does
for a code group. Only that gate applies. The others ask whether a *code* branch can start,
and a design issue never gets one from triage. A design issue with no edge is free once you
have looked. That is the case the marker exists to record.

**No `delivery:*` label at all is NOT either bucket** — absence means *not asked*, not
non-code; an unlabelled issue proceeds through the rest of triage exactly as before this
label set existed. `delivery:code` and `delivery:docs-only` also proceed normally — both are
in-repo commits, the code lane (#358), not a routing signal. `docs-only` is not `colab
ship`'s docs-only exception either; ship measures that from the diff, never from the label.

Why: [ADR 536](../../docs/adr/536-code-triage-2-non-code-delivery-rationale.md).
