# code-triage · §4 Write the dependencies down as `blocked_by` edges

Reference for [`code-triage`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


Triage is not only a *reader* of the dependency graph; it is the main thing that
**writes** it. A sequence you worked out and left in a report is lost the moment the
report scrolls away, and the next triage re-derives it from scratch — or doesn't.

So when this pass concludes that one issue **depends on** another, record it where a
machine can read it back.

**Only a dependency becomes an edge, never a queue position (#361, `CONVENTIONS.md`
[§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), *Readiness*).**
A dependency means B needs something A produces. A queue position means someone wants A
before B, including a ruling like "start all of these, in this order". An order-only edge
makes B inherit every wait later parked on A, and nothing re-threads the chain when that
happens. Queue order stays a **ranking**: this section's ordering and its report, plus the
ordered list in the ruling itself. When you cannot say what B needs from A, there is no
edge to write:

```sh
colab blocked <blocked> --by <blocker>                                    # add the edge
colab blocked <blocked> --by <blocker> --clear --reason "<why>" [--force] # remove it
```

Prefer `colab blocked`: it takes issue **numbers**, never a database id, and resolves the
id itself, reads before writing, writes, and reads back to confirm the edge names the
blocker you meant — every step below, done once, in one place, instead of re-implemented
from scratch every triage pass (#251). The raw `gh` form is the documented portable
fallback and does the exact same three steps by hand:

```sh
DB=$(gh api repos/{owner}/{repo}/issues/<blocker> -q .id)   # database id, not the number
gh api -X POST repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by -F issue_id=$DB
gh issue view <blocked> --json blockedBy      # ← and confirm it names the blocker you meant
```

The report still explains the reasoning — that is what prose is good for. The
relationship is the part the readiness gate above (and any other tool) reads.

- **Read before you write — `colab blocked` does this for you.** The edge may already
  exist — this triage may be the second one to reach the same conclusion (§0.2). Running
  it twice on an already-present edge is a no-op; on the raw form, check `blockedBy` first
  and do not file a duplicate.
- **Read it back after you write it, too — `colab blocked` does this for you as well,
  and refuses to print success if the read-back disagrees.** A wrong `$DB` — an empty
  variable, a failed subshell, the issue *number* pasted where the database id goes —
  does not error. The POST returns 200 and attaches whichever issue holds that id
  anywhere on GitHub, in repos neither you nor this org has heard of (`CONVENTIONS.md`
  [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), *Readiness*).
  The check is not about the API being flaky: at the moment of the write, a wrong id is
  **indistinguishable from success**, and the only later symptom is a blocker nobody
  recognises. On the raw form this read-back is a manual step you must not skip.
- **Record only what you actually determined.** A sequence you inferred from titles is
  a guess; leave it unwritten and say so in the report.
- **Never write an edge for file contention, and flag one you find (#371, `CONVENTIONS.md`
  [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), *File
  contention is never an edge*).** Two issues that edit the same file do not need each
  other's output. A real collision is a §3 group: one branch, one review cycle. A
  `blocked_by` chain gives one review cycle per member. When an existing edge's only
  justification is a shared file (the edge's comment or the ruling says "to avoid
  conflicts on `<file>`", or the two issues share nothing but a path), report it:
  `finding: #B blocked_by #A only for shared file <path> — contention is a group, not an edge`.
  When the file is one that every issue in a set must edit (an index, a registry, a
  README with one row per item), also report that the file itself is the defect: make it
  a pointer, then the items run in parallel. Do not clear the edge yourself. The
  guarded `--clear` is for an edge you judged false on this pass, and a human may have
  wanted that sequence for a reason the record does not show.
- **Split at the external-wait line — report it, do not block the whole issue (#371).**
  When an issue's scope is only **partly** behind an outside party (another team's API, a
  vendor, a ruling from outside the repo), a `blocked_by` edge or a
  `deferred:external-party` park on the whole issue holds back the part the repo could
  build today, and every issue built on that part. Report it as a structural finding in
  the blocked bucket, naming the two halves:
  `finding: #N split at the external-wait line — <buildable part> can start now; <part> waits on <party>`.
  Triage does not split it. Filing issues is not one of its writes. A human or the
  issue's filer files the buildable half and moves the edge or park onto the waiting half.
- **Remove an edge only when the edge is false — not because the blocker moved.**
  `colab blocked <blocked> --by <blocker> --clear --reason "<why>"` requires the reason
  (colab cannot verify intent, so it records yours instead) and refuses by default when
  the blocker is **closed** — the detectable signature of the exact mistake this rule
  exists to prevent — unless you pass `--force`. Use `--clear` when the dependency never
  existed, or stopped existing because the work was descoped or redesigned. **Do not clear
  it because the blocker's code landed**: the two issues really are related, the readiness
  gate reads the blocker's state for itself (§5.1), and an edge cleared for a display's
  convenience does not come back if the blocker is reverted. Editing a fact to change what
  a report prints is how the graph stops being trustworthy. The raw form
  (`gh api -X DELETE …/dependencies/blocked_by/<db-id>`) carries none of these guards —
  the same reasoning as `readiness`'s two-tier shape below.
- **Cross-repo edges are refused by `colab blocked`**, structurally — the blocker is
  always resolved in the current repo. A genuine cross-repo need falls back to the raw
  `gh api` form above.
- **Triage still never claims and never touches trunk.** Its writes are exactly the five
  §0.2 lists, all of them recordings of its own judgement about issues. The `blocked_by`
  edge is one of them, and only for a dependency.
