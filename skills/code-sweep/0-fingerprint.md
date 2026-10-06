# code-sweep · §0 Has anything changed?

Reference for [`code-sweep`](SKILL.md) §0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## 0. Has anything changed, and was a sweep left half-finished?

Same problem and same fingerprint as [`code-triage` §0](../code-triage/SKILL.md) — read it
there; only the differences are repeated here. A full sweep is a fixed floor of 3 network
calls plus a CI re-check and a full `code-ship` per candidate, so a ping
with nothing new is worth refusing to start.

**Measured, #244: median 27 calls (p90 59) over 372 runs in one adopting fleet's census —
9x the documented 3.** Two of the three causes are inherited from code-triage §0's own
narrowing (read there): input 2's drop of `updatedAt` propagates here for free.
**Input 5 does NOT propagate — deliberately.** `colab landed --all`'s inputs are the trunk
sha and the branch **tips**; a new commit on an already-`landed` branch is exactly the
event that un-lands it and creates a fresh sweep candidate, so a name-set-only digest here
would go blind to its own input. This skill keeps tip shas and pays the wider re-arm as the
honest cost of that dependency — it only inherits the branch **filter** (issue-carrying,
`<trunk>`/`HEAD`/`dependabot/*` excluded) and the `B5`-shaped receipt.

The third cause was found only by reading this checkout's own cache file directly: at 61 KB
it held **no `fingerprint`, no `ranAt`, no `version` key at all** — a flat, ever-growing map
of 24 ad-hoc `scope:*` keys accumulated since 2026-08-08, with key sets that drifted between
entries (`fingerprint_check` present in one, absent in the next). A shape §0 never specified
cannot be compared against, so this skill's short-circuit was structurally unable to fire in
this repo regardless of whether inputs 2/5 narrowed. §0.1 below fixes that with a required,
single, versioned record.

```sh
CACHE="$(git rev-parse --path-format=absolute --git-common-dir)/colab-sweep.json"
```

Separate file from triage's, because the two answer different questions off the same facts
and a shared file would make one skill's conclusion look like the other's.

**Fingerprint unchanged AND no interrupted sweep recorded** ⇒ report `nothing has changed
since <ts>`, name the candidates that were left standing last time and why, and stop.

**One exception, and it costs one call per entry: a `ci-wait` deferral (§4.0, #370).** A
CI run finishing moves no tip, so the fingerprint cannot see it — and a candidate deferred
because its run was still in flight would otherwise never be re-measured by a ping. For each
`conclusion.deferred` entry whose reason is `ci-wait`, read its run
(`gh run view <databaseId> --json status,conclusion` — one read, never a loop; waiting is
`colab ci-wait`'s job, #495). Any run now `completed` ⇒ print
`changed:deferred-ci` and take the full path; all still in flight ⇒ the short-circuit
stands, and the report names them as still waiting.

- **`colab landed --all` is part of the deterministic 90%,** and its inputs are the trunk
  sha and the branch tips. Cache the classification against both; a new trunk sha discards
  it. Do **not** cache `colab worktrees`, `colab claims` or `gh run list` — live state.
- **A matching fingerprint never authorises a merge.** §4's per-candidate CI re-check
  happens regardless: trunk CI can die mid-sweep, and the fingerprint does not watch it.

**Every run — short-circuited or not — opens with the same three required outcome lines
code-triage §0 defines**, printed before anything else: `unchanged` / `changed:<inputs>` /
`no usable cache`. The third is what separates a cold or malformed cache from a genuine
full-sweep-worthy change, exactly as it does for triage — see code-triage §0 for the three
literal line shapes; this skill emits the same three, substituting its own inputs (trunk
sha, branch tips, and whichever of code-triage's narrowed inputs it reuses) for the names.
