# code-sweep · §3 buckets `place-claim` and `teardown-only`

Reference for [`code-sweep`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### `place-claim` — the one hold nothing else here sweeps

Only relevant on a repo permitting trunk-direct (⚖ #233: any repo not declaring `writes:
isolated` — CONVENTIONS.md, *Place-claims*). A place-claim can outlive its session
exactly as an issue claim or a worktree can — a crashed `colab solo` session, a
coordinator-spawned implementer that never reached its own exit — and it is not a
worktree (a trunk-direct session does not need one) and not an issue claim (it locks a
**checkout path**, not an issue), so neither of the other buckets' machinery touches it.

**`§5`'s `colab doctor --prune` DOES reach a place-claim — but only the provable half,
by design.** `tools/colab`'s prune loop (the comment directly above
`place.stalePlaces(st)`) deletes a hold whose recorded pid is confirmed dead. It
deliberately never touches `unknown` liveness (no pid recorded, or the check itself
couldn't run), because a record the check cannot disprove is held must not read as
"safe to prune" — the same courtesy-release-only posture CONVENTIONS.md's
*Place-claims* section states for a human override. So the confirmed-dead half is
`--prune`'s job, automatic; the unknown-liveness half is what survives every automatic
pass and is exactly what this bucket exists to surface to a human instead of leaving
silent. That split is also why this bucket's own action is report-never-force: whatever
a machine could safely clear, `--prune` already clears; nothing weaker is left for this
bucket to automate.

```sh
colab places --json
```

Each row names a `path` and a holder. For each:

- **Path resolves to a live session** (this sweep's own session, or another one you can
  confirm is running) → not stale, leave it, do not list it as a finding.
- **Holder's liveness is unknown, or the session is confirmed gone** → this is exactly
  the case CONVENTIONS.md's *Place-claims* section reserves for a human:
  `colab place release <path>` on your own hold needs nothing extra, but releasing
  someone else's requires the human-only `COLAB_HUMAN` override — the same bar as a
  migration grant or a promotion. **Report it; do not set that variable yourself.**
- **No `colab`, or repo declares `writes: isolated`** → nothing to check; this bucket is
  empty by construction, say so rather than silently omitting the row.

A repo permitting trunk-direct also means solo-flow trunk-direct commits are a normal
shape here — see §1.1's `landed trunk-direct` outcome for the case where a finished solo
unit has no worktree, no claim and no branch to sort into any of the buckets above.

`teardown-only` is the common case and the most skipped. It is also the cheapest, so
do these first — they shrink the list before you start the expensive ones.

**That row used to promise a close it could not perform (#90).** It said "close issues
with evidence", and nothing in either skill implemented a close: the only close
mechanism in the whole system was `Closes #N` inside a squash commit, and a landed
branch is not being merged again. So the claim was released, the worktree removed, and
the issue stayed open — the documented step existed in prose only. For the specific
shape where the branch has **zero commits of its own**, `colab ship` now performs it
(evidence-close: it posts evidence, closes each issue, and tears down, gated on the
issue already carrying a comment colab did not write). For a landed branch that DID
have commits, the close is still yours to do by hand — that content reached the base
through some earlier merge whose `Closes #N` either fired or did not, so check before
you close.
