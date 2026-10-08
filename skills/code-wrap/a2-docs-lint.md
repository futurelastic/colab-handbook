# code-wrap · A2 `docs-lint`

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### `docs-lint`, if this repo has adopted it — structure, not truth

A2 above is about whether docs are still **true**; a separate, optional check
handles whether the doc graph is still **structurally sound** — router links that
resolve, `docs/` files nobody points to, drafts left where current truth lives,
§-citations that resolve. If this repo has copied in `docs-lint.mjs`
(`templates/docs-lint.mjs` — colab-handbook #249), this is the moment to run it:
docs were just touched, so this is when a broken reference is cheapest to catch.

```sh
node <path-to>/docs-lint.mjs --repo .
```

**Advisory only — never a reason to block A4.** Fold any finding into this
session's report the same way you would any other advisory (CI gone red for an
unrelated reason, a stale claim); fix it now if it is trivial and yours, otherwise
say so and move on. No `docs-lint.mjs` in this repo → skip this step silently,
same as any other optional tool this skill checks for.
