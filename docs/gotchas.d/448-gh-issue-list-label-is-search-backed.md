# `gh issue list --label` is served by search, and search lags (#448)

**Symptom.** Right after a burst of issue closes or label writes, `gh issue list --label <L>
--state open` can return an empty list for a label still on an open issue. Measured: a ship's
spent-group-label teardown deleted `group:<key>` 29 s after its squash, while an unshipped
fourth member still carried the label open.

**Why.** `gh` does not read the issues table for this command — `GH_DEBUG=api` shows it sending
GraphQL `search(type: ISSUE, query: …)`. The search index is eventually consistent, so a
listing taken seconds after writes can miss issues. `ghIssueListByLabel` (`tools/lib/git.js`)
wraps exactly this command.

**What to do.** Treat a search-backed "none" as a hint, never as proof, before anything
destructive or irreversible. Confirm through the REST issues list
(`git.ghOpenIssueNumbersByLabel` — `GET repos/{owner}/{repo}/issues?labels=…&state=open`),
which reads the issues table. Both `group:` label delete paths (`colab ship` (i) and
`doctor --sync --prune`) do this via `group-labels.js` `teardownSpentGroupLabel`, and keep the
label on any disagreement or failed confirm.

The other `ghIssueListByLabel` callers (migration-grant, decision-recorded, ci-grant lookups)
are read-only and fail toward "not found", so lag there costs a stale answer, not data — but a
new caller that *acts* on an empty result must add the same second read.
