# code-triage · §4 Order by blast radius

Reference for [`code-triage`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


Rank the surviving groups:

1. **Blocks other work** — a bug in a shared engine, a broken trunk, a stale claim
   nobody can get past. These unblock people, so they pay twice.
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

**Then push every `low-priority` group to the back, after all four ranks above are
applied — never sorted in among them.** It is a throttle on position, not an input to
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
