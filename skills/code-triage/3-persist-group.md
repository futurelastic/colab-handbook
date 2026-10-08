# code-triage · §3 Persist the group

Reference for [`code-triage`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


A group printed to a terminal dies with the terminal, and the next session claiming one
member never learns the other exists — the exact collision this section computes in order
to prevent. "Which files does this issue touch" is a judgement, so nothing downstream can
recover it; **triage is the only writer** (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*).

Two writes per group, and both are needed: the label makes it *queryable*, the comment
carries the *evidence*.

```sh
KEY=import-fixes            # the branch slug WITHOUT the trailing numbers (or any <login>/<machine>/ prefix)
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files" 2>/dev/null || true
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done

# then, once per member — the why, ending in the machine-readable pair
gh issue comment 115 --body 'Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch'
```

- **Re-running must not duplicate the comment.** §0.2 is binding here and the two writes
  are not equally safe: `--add-label` is idempotent by nature, `gh issue comment` is not —
  a skill pinged on a loop would otherwise stack an identical justification on the issue
  every idle cycle. Read first, and post only if no comment already carries this key:
  ```sh
  gh issue view 115 --json comments -q '.comments[].body' | grep -q "^Group: $KEY" || gh issue comment 115 --body "…"
  ```
  Re-post only when the membership or the evidence actually changed — and then say what
  changed, rather than repeating the original.
- **Remove what you contradicted.** If this pass concludes a previously grouped issue no
  longer belongs — its collision landed, or the group was wrong — take the label off that
  issue (`gh issue edit <N> --remove-label "group:$KEY"`). Nothing else removes it, and a
  stale group label reads exactly like a fresh one.
- **A one-member group is not a group.** After removals, a `group:` label left on a single
  open issue is spent: remove it too.
- **Quote the evidence from the current tree, not from `$CACHE`.** §2 caches verdicts and
  never evidence, for this reason: a cached line number is a ref that rots invisibly.
- **Record only collisions you actually checked.** A group inferred from titles is a guess;
  leave it unwritten and say so in the report. Writing it makes the guess look verified to
  every reader afterwards.
- **On a pass that proceeds under §0's fingerprint, this whole section may already be
  answered for some issues.** §0.3's per-issue verdict cache reuses a stored group verdict
  when the issue's own key, its group-mates' keys, and the surrounding backlog membership
  all still match — re-derive here only the issues §0.3 flagged dirty.
