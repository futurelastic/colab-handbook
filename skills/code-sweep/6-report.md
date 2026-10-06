# code-sweep · §6 Report

Reference for [`code-sweep`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## 6. Report

```
swept 4, left 3

shipped         fix/import-115-114-113   → trunk a1b2c3d, #115 #114 closed, #113 split
teardown-only   feat/console-shell-28    → content already on trunk, worktree removed
claim-only      #26                      → shipped in e4f5g6h, claim released
deferred        fix/oauth-scope-31       → gate red on an unrelated lint rule; run continued
place-claim     . (trunk checkout)       → holder session unknown-liveness — reported, not released
unrecorded      .worktrees/orphan-1      → landed vs main, no claim — removed by hand
sent-back       feat/session-types-26    → 2 untracked files never committed — ↩️ Sent back posted on #26, implementer to commit + wrap
sent-back       fix/cache-key-44         → sent-back (pending since 2026-07-21T09:10Z), head unmoved — not re-posted
blocked         #58                      → no claimed issue in this repo, 3 commits local-only — needs a human
unlinked        fix/railquiet-fixture-trunk-red → 1 commit ahead of trunk, no issue claimed — not wrapped, not dropped
spent-remote    56 refs on origin        → every trailing issue CLOSED; listed below for a human to delete, none deleted
                  fix/ship-reject-recommended-route-328, feat/dropped-idea-12 (#12: NOT_PLANNED — look first), …
orphan-shippable docs/guide-refresh-81   → no worktree, wrapped 8h ago, dry run ok — shipped, trunk 7b3c2d1
orphan-shippable fix/cache-key-44        → wrapped, awaiting a human go (no auto-trunk; not docs-only)
orphan-shippable feat/importer-52        → orphan-shippable elsewhere — claimed from machine box-b; not adopted
unshaped ask    #508                     → needs-decision with neither a Mockup: line nor an options block — reported to its filer, untouched
ripened         fix/late-wrap-77         → became a candidate at 11:30Z, mid-run; shipped in the §5.1 pass, trunk 9f8e7d6
ripened         feat/late-thing-81       → became a candidate mid-run; not processed: merge loop stopped (trunk CI red)
end-of-run      §5.1 re-derived 2x       → second pass found nothing new; fingerprint + conclusion written from it
```

**The `end-of-run` line is required on every run that got past §0, even when it found
nothing new** (`§5.1 re-derived 1x → nothing moved but this run's own merges`). Leave it
out, and a reader cannot tell a run that checked from one that never looked. That
difference is the whole of #329. A `ripened` line always says which pass handled it, or
why no pass did.

Say what you left and why. A worktree kept for a stated reason is fine; a worktree
kept silently is the 8-of-9 statistic repeating.

**`deferred` and `blocked` are different outcomes — never collapse them into one line.**
`blocked` is a candidate §3 never sent into §4 at all (genuinely unfinished, no implementer to address; work that only needs its implementer to wrap is `send-back`); `deferred` is one §4 *tried*, failed on, and moved past. So a `deferred` line
owes the reader two things a `blocked` line does not: what failed, and what would clear it.
Those two facts are the whole record the old run-level stop used to provide, now carried
per candidate.

**A repo-wide trunk-CI failure is neither of them.** It stops the merge loop, so it appears
as the `stopped:` ending below — never as a per-candidate `blocked` line, which is how this
example used to write it and is exactly the conflation §4 now removes: one candidate's line
cannot carry a fact about the whole repo.

A **scoped** run says so on the first line and names its boundary — the M−N by name, not
just by count, because a count cannot be checked against what the human had in mind:

```
scoped to 2 of 7 candidates   (issues #95 #96)
not looked at   feat/console-shell-28, fix/import-115-114-113, #26, #58, chore/deps-31
§5 reconcile    restricted to #95 #96; doctor --prune skipped (machine-wide)
```

The other two endings are distinct sentences, and must not be collapsed into each other or
into the clean-sweep line above:

```
selector matched nothing   #99 — no claim, no worktree, no branch carrying that number
nothing has changed since 2026-07-21T14:02Z   (3 calls; 2 candidates still standing, see below)
still blocked: trunk CI dead (billing), since 2026-07-21T11:40Z
stopped: trunk CI red at a1b2c3d — merge loop halted after 2 of 6; §5 reconcile still ran
```

The last of those is the run-level stop of §4, and it says two things on purpose: how far
the merge loop got, and that the non-merging work was **not** abandoned with it.
