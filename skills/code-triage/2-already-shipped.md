# code-triage · §2 Already shipped

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**Already shipped** — the expensive pass, and the one that pays:

```sh
git log --oneline --all --grep="#<N>"                  # merged under this number?
grep -rl "<the thing the issue describes>" <paths>      # or present in the code?
```

Grep for what the Issue *describes* — the column, route, UI string, function — not
for its number. A commit mentioning `#88` proves someone typed `#88`.

- **Fully shipped** → close it with evidence (trunk sha + `file:line`) through
  `colab close <N> --comment "<evidence>"` — never a bare `gh issue close` (#381) — and take it
  off the list. That is real triage output, not a detour.
- **Partly shipped** → narrow it to what is actually missing before queueing, so
  nobody re-does the finished half.

**Memoize this pass against the trunk sha.** Both commands are pure functions of the tree:
with the tree unmoved, they return byte-identical results, and this is the pass that costs
~2 local invocations per issue on top of the network. So cache the verdict per issue in
`$CACHE` (§0) keyed by the **trunk sha it was computed at**, and reuse it while that sha
holds. A new trunk sha invalidates every entry at once — which is right, because a merge is
exactly the event that can ship an issue.

Two conditions on that, both of which have teeth:

- **Only when the working tree is clean.** `grep -rl` reads the *working tree*, not the
  commit; with uncommitted changes the result is not a function of the sha at all. Key on
  `git status --porcelain` being empty, or do not cache.
- **Only the verdict, never the evidence.** Re-quote `file:line` from the current tree
  before putting it in a report — §3 already warns that refs rot, and a cached line number
  is a ref that rots invisibly.
