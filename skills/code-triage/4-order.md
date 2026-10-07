# code-triage · §4 Order by blast radius

Reference for [`code-triage`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**Rank by owner priority first, before blast radius (#537).** Read the lead issue's labels:
`priority:now` groups first, then `priority:high`, then everything unlabelled, then
`low-priority` last. Blast radius (the four ranks below) orders groups *within* each band,
never across one. The rank orders; it never admits — a `priority:now` group that §5 holds
(an open blocker, a held file, a claim) stays out of READY, and its held file drains rather
than being overridden: the holder ships first. When the issue itself shows a `priority:*` label was
applied by an agent on its own initiative — not by the owner or a coordinator (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#priority--a-throttle-not-a-veto-268), *Priority*) — that is a finding to report; rank by it
anyway, never strip it yourself. You may *propose* a band on leverage alone (unblocks many,
splits a held file, fixes CI on a throttled repo) — `high` at most, never `now` — in the
group's `why:` line; proposing is not applying the label.

```sh
gh issue view <lead-issue> --json labels -q '.labels[].name' | grep -xE 'priority:(now|high)|low-priority'
```

Then, within each band, rank the surviving groups:

1. **Blocks other work** — a bug in a shared engine, a broken trunk, a stale claim
   nobody can get past. These unblock people, so they pay twice. Leverage counts here
   (#540), and any one of three measurements earns rank 1:
   - **≥ `dependents-count` open issues are `blocked_by` it** (3 unless the repo declares
     `thresholds.dependents-count`; `colab thresholds dependents-count`, #560) — counted from §0's `BY` lines, zero added
     calls;
   - **a CI or tooling fix** — its diff, or its ask, is the repo's workflows, gate scripts or
     vendored tooling; every later merge passes through it;
   - **a hot-file split** — a `HOT FILE:` issue (§3, [3-hot-file.md](3-hot-file.md)), or any
     issue restructuring a path that holds ≥ `hot-file-count` waiting issues.
   Leverage ranks only inside a band (#537) and never crosses one; the most it does across
   bands is the `why:` line's proposal of `high`, above.
2. **Reaches users** — a defect in a repo with a live production target
   (`project.yml` `production:` non-null). Key the urgency off
   [`exposure`](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here): `live` means
   the next promotion ships it; `released` means it waits for a deliberate artifact and,
   once out, [cannot be recalled](../../CONVENTIONS.md#recovery--what-must-exist-to-undo-a-merge)
   — the strictest cell, not the mildest, so weigh it accordingly. No `exposure`
   declared? Read the legacy `tier` value the same way the code does
   (`tools/lib/axis-authority.js`): `C → live`, `A → released` — and a bare `tier: B`
   yields **no** urgency signal at all (`B → null`); rank it on the other three
   criteria instead of guessing, which is the one thing the module exists to stop a
   caller doing.
3. **Cheap and unblocking** — small work that lets something bigger start.
4. **Everything else** — by whatever the humans care about.

**`low-priority` is the last band — every `low-priority` group goes to the back, after all
four ranks above are applied — never sorted in among them.** It is a throttle on position, not an input to
blast radius; see *Then rank low-priority groups last*, below §5, for the full check
and what the report says about it.

**A recorded queue order from a human outranks your own ordering among the groups it
names (#361).** If a ruling on the issues, or on their epic, lists them in order ("start
all of these, in this order"), keep those groups in that order relative to each other.
Where they sit among the other groups, and every group the ruling does not name, is
ranked as usual. Quote the ruling as the reason. Never turn the order into `blocked_by`
edges (next section).

State the reason next to each rank. "Ordered by priority" with no reasoning is not
triage; it is a re-sorted list.
