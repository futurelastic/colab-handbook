# code-ship · B2d Tear down a spent `group:<key>` label (#82)

Reference for [`code-ship`](SKILL.md) B2d. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B2d. Tear down a spent `group:<key>` label (#82)

**`colab ship` does this for you** — its B4 unions the `group:` labels the branch's
issues carried and, per label, checks whether any issue anywhere still carries it
**open**. None left → the label OBJECT is deleted (`gh label delete`); one still open
→ left exactly as it was, because it still binds the remainder. Nothing here to do on
that path — it runs automatically, after the evidence comments in B2b.

**"None left" takes two reads that agree (#448).** `gh issue list --label` is served by
the search index, which can lag a burst of closes and answer 0 for a label still on an
open issue — measured: a ship deleted a `group:` label 29 s after its squash while a
deliberately-unshipped fourth member still carried it. So a 0 from that listing is
confirmed through the REST issues list (the issues table, not the index) before the
delete; if the two disagree, or the confirming read fails, the label stays and ship
warns naming the open member. `colab doctor --sync --prune` applies the same check.

**Only if `colab` isn't available in this repo** (no `tools/colab` to run `colab
ship` with — a repo lacking `autonomy: auto-trunk` still has the tool, a human just
triggers it instead of the tool running unattended), do the equivalent yourself,
once B2 has pushed:

```sh
for GL in $(gh issue view $N --json labels -q '.labels[].name' | grep '^group:'); do
  # REST issues list, not `gh issue list` (search-backed, can lag — #448). A failed read
  # skips the label (`|| continue`): fail toward keeping, never read failure as "0 open".
  OPEN=$(gh api --method GET --paginate repos/{owner}/{repo}/issues \
      -f labels="$GL" -f state=open -f per_page=100 \
      --jq '.[] | select(.pull_request == null) | .number') || continue
  [ -z "$OPEN" ] && gh label delete "$GL" --yes
done
```

Only `group:*` labels are ever in scope — never `in-progress`, `deps-checked`,
`agent-filed`, `needs-plan`, or `epic`. Deleting the label does not erase the record:
the closed issues' timelines still show it was applied, and each member's `Because:`
comment (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*) is the durable evidence of *why*, independent
of whether the label object survives.
