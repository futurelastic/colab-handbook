---
name: code-sweep
description: "Clear out everything finished in ONE repo: find every worktree whose work has landed, every issue whose code shipped but is still open, and every claim outliving its session — then put each through code-wrap and code-ship in sequence, one at a time. Run it at end of day, or ping it whenever a session goes idle — cheap to re-run only when §0 is honoured first, a convention the executing agent follows and not a gate anything enforces (its fingerprint stays sensitive to branch tips, so the cheap path is rarer here than in code-triage — see §0). Sorts candidates into wrap / teardown-only / claim-only / place-claim / unrecorded / blocked / unlinked, because most do not need a full wrap+ship. Can be scoped to a set of issues or one session/worktree instead of the whole repo. Trigger phrases: 'sweep the repo', 'wrap everything finished', 'clean up the worktrees', 'close out the session work', 'tidy up finished work', 'wrap all the done branches', 'sweep the issues #95 #96', 'sweep the session <name>', 'ship these'; and — when this session's last act was a sweep — the re-ping forms 'again', 'anything new?', 'check again', 'anything to wrap yet?', or a bare 'go'. Composes code-wrap then code-ship per candidate; never batches merges."
---

# code-sweep — clear out everything finished, one at a time

After a few parallel sessions, two things drift apart:

- **worktrees** — merged but never torn down (measured: **8 of 9**, 2.9 GB of orphans)
- **issues** — shipped but still open, or closed but still holding a claim

This sweeps one repo and reconciles both. It does not replace
[`code-wrap`](../code-wrap/SKILL.md) and [`code-ship`](../code-ship/SKILL.md) — it
finds the candidates and runs them, in sequence, per candidate.

## Principle — sequential, and most candidates do not need a full wrap+ship

**One at a time.** Every merge moves trunk, so the next candidate must sync against
the *new* trunk (code-ship B0). Batching merges "to save time" produces exactly the
generated-file conflicts B0 exists to prevent.

**Sort before acting.** A worktree whose branch already landed needs teardown, not a
wrap. Running a full wrap on it re-does distillation nobody needs and risks a second
merge of the same content.

**Run it as often as you like.** This used to be described as the end-of-day job after
several parallel sessions, which read as a prohibition on running it more often — and the
cost made that reading fair. §0 removes the cost: a ping with nothing new is three calls
and a sentence. So a long-lived shipping session may re-run this whenever it goes idle.
Frequency was never the hazard; *re-deriving everything* to discover nothing changed was.
Nothing below gets cheaper by being skipped — least of all the per-merge CI re-check.

## 0. Has anything changed, and was a sweep left half-finished?

Same problem and same fingerprint as [`code-triage` §0](../code-triage/SKILL.md) — read it
there; only the differences are repeated here. A full sweep is a fixed floor of 3 network
calls plus a CI re-check and a full `code-wrap` + `code-ship` per candidate, so a ping
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

### 0.1 Resume an interrupted sweep

§4 stops the whole sweep on the first failure, and that stays — skipping ahead leaves a
half-swept repo. But under ping-when-idle a stopped sweep gets re-pinged within minutes,
and today the re-ping restarts from §1 carrying nothing: it re-derives every bucket, walks
back to the candidate that failed, and fails there again.

So when a sweep stops, record in `$CACHE`: the candidates **completed** (with the trunk sha
each merged at), the candidate it **stopped on**, and the **stop reason**. On the next run:

1. **Re-test the stop reason first, and nothing else.** Dead trunk CI ⇒ one `gh run list`.
   Still dead ⇒ report `still blocked: <reason>, since <ts>` and stop. That is a two-call
   ping for a repo that cannot be swept, instead of a full re-derivation ending in the same
   sentence.
2. **Cleared ⇒ re-derive the buckets, do not replay the old list.** The recorded completions
   are skipped; everything else is classified afresh. Trunk moved during the part that did
   succeed, and §4's invalidation is the whole reason this skill is sequential — a resume
   that trusted a stale bucket list would reintroduce exactly the batching the Principle
   rejects.
3. **A completion record is a shortcut, never evidence.** Before skipping a recorded
   candidate, confirm it: `colab landed` says its content is on its base. Cheap, and it
   keeps a truncated or stale cache from being read as "already shipped" — the single most
   expensive wrong belief in this family (`code-triage`'s opening principle measured it at
   4 of 9 sessions in one day).

**`$CACHE` is one required, versioned record — never a growing map, measured, #244.** The
61 KB / 24-key accumulation found in this checkout (above) had no lifecycle rule: each scope
got a new top-level key and nothing ever removed one. Fixed shape instead, mirroring
code-triage's own `/2` record plus the bounded `interrupted` block this section needs:

```json
{
  "version": "code-sweep/2",
  "scope": "whole-repo",
  "ranAt": "<ISO8601>",
  "fingerprint": {
    "trunkSha": "<40hex>",
    "branchTips": "<16hex>",
    "backlog": "<16hex>"
  },
  "lastRun": { "decision": "full", "moved": ["branchTips"], "calls": 27 },
  "interrupted": { "completed": ["…"], "stoppedOn": "…", "stopReason": "…" },
  "conclusion": { "wrapped": ["…"], "blocked": ["…"], "…": "…" }
}
```

- **One record per repo, overwritten each run — not appended.** A new scope replaces the
  `scope`/`fingerprint`/`conclusion` fields in place; it never adds a sibling key.
- **`interrupted` is present only while a sweep is genuinely stopped mid-way**, and is
  cleared (removed, not left empty) the run after it resolves — an `interrupted` block that
  outlives its sweep is exactly the kind of stale state 0.1's own resume logic exists to
  avoid re-trusting blindly (rule 3, just above).
- **An unrecognised `version`, or any missing key, is `no usable cache`** — the third
  required outcome line, same as code-triage's rule for its own record. Never a partial
  match on the keys that happen to be present.

## 1. Enumerate — scoped to THIS repo

```sh
colab worktrees            # scope to this repo — see below
colab claims               # same
gh issue list --state open
gh issue list --label in-progress
colab places                # repos that permit trunk-direct only — see §3's place-claim bucket
```

⚠️ **`colab worktrees` and `colab claims` list the whole machine.** Scope them, or
the sweep will start wrapping another project's work. Filter by repo — note the
JSON shape is `{"worktrees": {...}, "unrecorded": [...]}`, not a bare map (#67):

```sh
REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
colab worktrees --json | python3 -c 'import json,sys,os
r=os.path.realpath(sys.argv[1])
d=json.load(sys.stdin)
for w in d["worktrees"].values():
    if os.path.realpath(w["repo"])==r: print(w["name"], w["branch"], w.get("status",""))
for u in d["unrecorded"]:
    if os.path.realpath(u["repo"])==r: print("UNRECORDED", u["branch"], u["path"])' "$REPO"
```

⚠️ **The anchor is the main checkout, not `$PWD`.** `colab` records every worktree and
claim against the **main** repo path, so this filter run from inside a worktree matches
nothing — and the sweep reports a clean repo because it enumerated an empty list. That is
the worst possible failure here: "found nothing" wearing the face of "nothing to find"
(§1.1 rule 3 exists for the same confusion arriving by a different road). `dirname` of the
common git dir yields the main checkout from anywhere in the repo.

### 1.2 `unrecorded` rows are candidates too — never drop them for lack of a bucket

**Before #67, this enumeration was `colab worktrees`'s bare state.json read — so a husk
left by an interrupted `worktree rm` (#62), which `git worktree list` still reports, was
invisible here, and the §3 completeness check couldn't notice: it compares buckets derived
from the same list that omitted the row.** `colab worktrees` now reconciles against
`git worktree list` itself, so those `unrecorded` entries surface with the rest — treat
every one of them as a candidate to sort in §3, exactly like a recorded worktree, never as
noise to skip because it has no ISSUES column.

A row here has no claim, no ports, and — the case that motivated #67 — sometimes no
claimable issue *in this repo at all* (a branch whose issue numbers belong to a different
repo's tracker). That is a real, distinct shape, not a defect in the filter: see §3's
`unrecorded` bucket for what to do with it.

**What this does NOT cover: a hand-created directory `git worktree list` never linked at
all.** `unrecorded` is a reconciliation between two lists that both start from
`git worktree list` — colab's state.json against git's own — so a directory with no `.git`
entry is outside both sides of the comparison and cannot surface here, no matter how
worktree-shaped it looks (a `CLAUDE.md`, a `.github/project.yml`, a full copy of tracked
files). #97 found exactly this shape — `.claude/worktrees/<stale-name>/`, 1 MB, no `.git` —
by reading `git status --untracked-files=all` for an unrelated reason, not by any step this
skill prescribes. A detector for that shape is tracked separately (see #97's follow-up);
until it lands, this enumeration's coverage is real but narrower than "every worktree on
disk."

### 1.1 Scoped mode — sweep a subset, and say that you did

`code-triage` has single-issue mode; this had nothing between "the whole repo" and calling
`code-wrap`/`code-ship` by hand — and calling either directly skips the bucketing that
decides wrap vs teardown-only vs claim-only, which is the judgement this skill exists to
add. A shipping session handed three issue numbers deserves neither of those options.

    sweep the issues #95 #96          → candidates whose claims or branch name carry 95 or 96
    sweep the session <name>          → the worktree of that name, its claims, its issues

Both selectors are natural because §1 already enumerates claims (issue-keyed) and worktrees
(session-keyed) side by side; scoping picks rows out of lists that were built anyway.

**Enumerate everything first, then narrow.** Never filter at the source. The full list is
what makes the next three rules possible, and it costs nothing extra — §1's commands do not
take a selector anyway.

Everything downstream is unchanged: the four buckets, the sequential wraps, the per-merge
CI re-check, the refusal to batch. Scoping narrows *which* candidates are considered; it
must never weaken what happens to each one.

**Three things do not follow from filtering, and a scoped mode without them is worse than
none:**

1. **§5 reconcile is repo-wide by nature — so a scoped run does not do it silently.**
   Closing shipped-but-open issues and releasing stale claims are not scoped to the
   candidates, and `colab doctor --prune` is **machine-wide** — it would reach past the
   scope, past the repo, to other projects entirely. In a scoped run: restrict §5 to the
   selected issues, **never run `doctor --prune`**, and say both in the report. Someone who
   asked to ship three issues did not ask you to reconcile the machine.
2. **Report what you did not look at.** This is the real trap: *a scoped sweep that finds
   nothing looks identical to a full sweep that finds nothing.* The skill already holds the
   matching principle for kept worktrees — a worktree kept for a stated reason is fine, one
   kept silently is the 8-of-9 statistic repeating. A scoped run owes the same honesty about
   its own boundary: `scoped to N of M candidates`, and name the M−N.
3. **A selector that matches nothing is usually a wrong number — but on a repo that permits
   trunk-direct (⚖ #233: any repo not declaring `writes: isolated`), check trunk history
   before reporting it that way.** An issue with no worktree, no claim and no branch is not
   "swept"; ordinarily it was never there. But that exact triple — no worktree, no claim, no
   branch — is also the fingerprint of a **finished trunk-direct** unit: an attended solo-flow
   session (CONVENTIONS.md, *Solo flow*) commits straight to trunk and its exit
   (`colab solo --done`) never made a worktree or held a claim, so a landed solo commit is
   indistinguishable from a wrong number by these three signals alone. Before reporting
   `selector matched nothing` on a repo that does not declare the veto, check:
   ```sh
   git log --oneline origin/<trunk> --grep="#$N"
   ```
   A match → report `landed trunk-direct: <sha>`, a fourth, distinct outcome — not
   `selector matched nothing`, and not one of §3's buckets either, since there is
   no worktree to tear down and no claim to release. If the issue is still open, close it
   with that evidence per §5.

   **No match does NOT mean clear — say so, do not let the grep look conclusive.** Solo
   flow files an Issue **on demand**, not on entry (CONVENTIONS.md, *Solo flow*: "an Issue
   is filed on demand … recording a decision, or work spanning more than one sitting"),
   so its whole premise is that the commit **is** the memory — an ordinary solo commit
   carries no `#N` at all. A landed-trunk-direct unit that never cited the issue is
   therefore indistinguishable from a genuinely wrong number by this check: the grep
   returning nothing collapses back into `selector matched nothing`, which is the original
   defect in its most common shape. There is no reliable signal from git state alone that
   tells the two apart in that case. Report `selector matched nothing`, and say plainly
   that the grep found no citation rather than that the work was confirmed absent — a
   human who recognizes the issue may still know it shipped uncited.

**A scoped run's fingerprint is not the repo-wide one.** The §0 inputs are repo-wide facts,
so *detection* is shared — but the stored conclusion is per-scope, and `code-triage` §0.1's
coverage rule governs which stored run may answer a ping: a repo-wide conclusion can serve a
scoped re-ping by filtering, a scoped one can never serve a broader ping. Key the cache entry
by its normalised selector, and treat unscoped as its own key. Getting this backwards would
let "I swept #95, nothing to do" answer "sweep the repo" — a clean bill of health for
candidates nobody examined.

**Unscoped behaviour is exactly what it was.** No selector ⇒ every rule above is inert:
`M = N`, §5 runs in full, and no scope line appears in the report.

## 2. Decide what "finished" means — one rule, not per-candidate judgement

```sh
git fetch origin                    # the rule reads local refs; a stale base misjudges
colab landed --all                  # every worktree of this repo: landed · cargo · unknown
```

That is the whole decision, and it is the same rule `code-ship` uses
(`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), "Has it landed?"). It is asked against each branch's **base** —
trunk, or the declared `integration:` line it was cut from — because a line-based
branch measured against trunk reads as enormous unshipped cargo.

**Do not count commits, and do not trust the merge graph.** `git branch --merged`
lies here: sessions squash-merge, which leaves no merge relation (the same reason
deleting a wrapped branch needs `git branch -D`, not `-d`). Counting commits ahead is
worse than useless — a squash mints a new sha, so it calls *every branch ever shipped*
unfinished. Comparing diffs fails the mirror case, where the base moved on underneath.
Requiring both still misses a squash followed by base movement, which is common. The
rule above asks the content question instead: does merging this branch change the
base's tree at all?

Without `colab`, ask it directly per branch:

```sh
git merge-tree --write-tree origin/<base> <branch> | head -1   # equal to …
git rev-parse origin/<base>^{tree}                              # … this ⇒ landed
```

**`unknown` means cargo.** If the base rewrote the branch's work the merge conflicts
and no content answer exists — so it never gets torn down on a guess.

Do not trust `colab`'s `status` field alone either — the `doctor` merged-flip
heuristic ("running → merged once no live claims remain") became weaker when claims
began releasing unconditionally at wrap.

**Git state and claim state are two signals; keep them apart.** `colab landed` says
what state the work is *in*; `in-progress` says someone *believes they hold it*. They
disagree in both directions — claims outliving finished work, finished work never
claimed — and the label remains the veto before any teardown.

## 3. Sort into seven buckets — each gets a different action

**These buckets are keyed off what §1 enumerated — worktrees, claims, and
places — which is complete for a repo declaring the veto (`writes: isolated`, every
unit is a worktree) but only partial for a repo permitting trunk-direct (⚖ #233: any
repo without the veto).** A finished solo/trunk-direct unit that never
filed an Issue (CONVENTIONS.md, *Solo flow* — an Issue is filed on demand, not on
entry) leaves no worktree, no claim, and nothing here to sort, because there is
nothing left to reconcile: the commit already **is** the record. One that DID file
an Issue surfaces through §5's "open issues whose code shipped" regardless of
whether a branch ever existed. The `landed trunk-direct: <sha>` outcome (§1.1) is
the third case — a scoped selector that names such a unit by issue number.

| Bucket | What it looks like | Action |
|---|---|---|
| **wrap** | `cargo` (or `unknown`), **and** at least one claimed issue | full [`code-wrap`](../code-wrap/SKILL.md) then [`code-ship`](../code-ship/SKILL.md) |
| **teardown-only** | `landed` — content already on its base, worktree lingering | remove worktree, release claims; close via `colab ship` when it has zero commits (evidence-close, #90), else close by hand with evidence |
| **claim-only** | no worktree; `in-progress` on work already shipped | release the claim, close the issue with evidence |
| **place-claim** | `colab places` lists a hold whose session is not this sweep's — see below | **check liveness, report — never force-release a live holder** |
| **unrecorded** | on disk, `colab worktrees`'s `unrecorded` list — no claim, no ports | **report only** — see below, never `code-wrap`/`code-ship` |
| **blocked** | uncommitted work — tracked changes or untracked files — or genuinely unfinished | **report — never force** |
| **unlinked** | `cargo` (or `unknown`), **zero** claimed issues | **report — do not wrap** (#92) |

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

### `unrecorded` — a worktree colab never held a claim for

This bucket exists because #67 measured the alternative: an unrecorded worktree used to have
nowhere to go, so it went nowhere — invisible to enumeration, absent from every bucket, and the
completeness check agreed there was nothing to check. It is deliberately **not** folded into
`blocked`: `blocked` means "known work, human judgement needed"; this means "colab has no record
to act on at all" — a different reason to stop, worth naming as such.

**Never run `code-wrap` or `code-ship` on one.** Every phase of either assumes a claimed
issue and a recorded worktree — `code-ship`'s B1b harvest reads the claim registry, its B3
releases claims, its B4 tears down a worktree `colab` knows about. None of that exists
here, so a full wrap+ship does not degrade gracefully; it errors, or worse, silently does
nothing where you expected it to act.

Read the verdict `colab worktrees` already computed (§1.2) and act by hand:

- **`landed vs <trunk>`** → the content shipped by some other route (a prior session's
  interrupted wrap, or a #62-style husk). Confirm with `colab landed --repo <repo> --branch
  <branch>`, then `git worktree remove <path>` (`--force` if git objects, not tracked files,
  uncommitted) and `git branch -D <branch>`. This is *not* the same raw-fallback gap as
  `code-ship`'s B4: `unrecorded` means colab never held a `state.json` entry for this
  worktree at all, so there is no registry record for the raw command to strand — that is
  what "no claim to release, no ports to free" means here. It does **not** mean the
  branch's issue(s) are clean: a claim can have been set by hand (`gh issue edit … --add-label
  in-progress`) outside colab's tracking entirely. Check the branch's issue number(s) for
  a stale `in-progress` label and release it (`gh issue edit <N> --remove-label
  in-progress`) before you move on — nothing else here will.
- **`cargo` / `unknown vs <trunk>`** → genuine unmerged content with no claim behind it. Do
  **not** guess ownership from the branch name alone. Check whether the branch's issue numbers
  belong to *this* repo's tracker (`gh issue view <N>` — 404 or a title that makes no sense means
  they don't) or, per #67's own case, to a **different** repo's tracker entirely — that shape has
  no issue here to harvest, close, or post evidence on, so `code-ship`'s `Closes #N` step has
  nothing to close even if you ran it. Report it and leave it; claiming it into this repo would be
  inventing an issue number that was never this repo's to begin with.
- **`detached HEAD`** or **`IS <trunk> — should not be a linked worktree`** → structurally odd
  regardless of content; report, do not guess intent.

**What bucket "cargo with no claimable issue in this repo" belongs in past this first report is
still an open convention question (#67's point 3) — this section covers the mechanical minimum
(don't lose it, don't silently wrap it, don't misattribute it), not the eventual policy for
routing it. If you find yourself resolving the same shape repeatedly, that is a signal the
convention decision is overdue, not a cue to improvise one per sweep.**

### `unlinked` — cargo whose issue numbers are nobody's here

**`unlinked` is its own bucket, not a subset of `wrap` (#92).** `colab worktrees`
enumerates by worktree, not by issue, so a branch with real unlanded commits and no
issue attached still surfaces at §1 — it is not invisible. But wrapping it the normal
way is the wrong action even though `landed` reports `cargo`: `--issues` is empty,
so the squash carries no `Closes #N`, B2c's evidence-posting step has nothing to post
to, and the branch content can be *better* than whatever DID ship (a genuine measured
case: a one-line fix stranded this way outclassed the fix that landed through a
different door — the residue is not clutter). Do not silently fold this case into
`wrap` on the theory that "cargo → wrap" always holds; the theory holds only when a
`Closes #N` is possible. Do not silently drop it either — an un-named residue class is
how a better patch sits unreachable indefinitely while a worse one ships.

Report it and stop there. Two reasonable next steps exist and this skill does not
choose between them: file (or reopen) an issue for the branch so it becomes an
ordinary `wrap` candidate next sweep, or leave it named so a human decides. Never
open the issue automatically — that is a judgement call about what the branch is
*for*, which this skill has no way to make from git state alone.

```sh
colab worktree rm <name>       # releases its claims and frees its ports
git branch -D <branch>         # -D: squash left no merge relation
```

A sweep is exactly when a session's dev server is still running, so expect
`worktree rm` to refuse with a list of processes the worktree owns. Stop them and
re-run, or `--force` to have it terminate them — it kills only what the worktree
owns by cwd. Do **not** reclassify such a candidate as `blocked`: it is a live
process, not unfinished work.

## 4. Run the wraps — one at a time, re-checking between

For each **wrap** candidate, in order:

1. **Re-check trunk CI.** Ask by commit, not by recency (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), #92):
   does a completed, successful run exist for `<trunk>`'s current head sha? (`gh run
   list --branch <trunk> -L 1` reads whatever ran *last*, and a cancelled straggler
   can outrank a passing run on the same commit under `cancel-in-progress`.) Not
   once at the start — trunk CI can die mid-sweep (billing lockout, runner outage),
   and a failure that never started still means stop. A sweep can take an hour.
   This re-check is about the **branched** `wrap` candidates below — the merge each
   is about to go through depends on it being alive, at whatever thoroughness its
   `exposure` demands ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)).
   A `place-claim` or `landed trunk-direct` candidate never merges through here at
   all, so this step has nothing to re-check for those.
2. Run **code-wrap** for that candidate — distill/docs/gate/commit/push, if not
   already done for the cargo sitting on it — then **code-ship**: B0 sync against
   the *current* trunk, harvest, grade, merge, evidence, release, teardown.
3. **Then** move to the next. Trunk has moved; the next B0 must see that.

If any wrap stops (CI dead, conflict needing judgment, gate failing for unrelated
reasons), **stop the sweep there** and report. Skipping ahead leaves a half-swept repo
that is harder to reason about than an unswept one. **Record the stop** — completed
candidates, the one it stopped on, and why — so the next ping resumes instead of
re-deriving its way back to the same wall (§0.1).

## 5. Reconcile the tracker

⚠️ **Scoped run? Read §1.1 first.** This whole section is repo-wide, and the `doctor
--prune` below is machine-wide. Restrict it to the selected issues, skip the prune, and say
so — reconciliation nobody asked for is the one way scoping can do harm rather than less.

Worktrees are only half of it. Also:

- **Open issues whose code shipped** → close with evidence (trunk sha + `file:line`).
  Verify by grepping the code for what the issue describes, not by trusting a commit
  message that mentions its number.
- **Closed issues still holding a claim** → release. Closing and releasing are
  separate acts and only one is automatic.
- **Claims whose worktree is gone** → `colab doctor --prune` reports and removes them.
- **Epic checklist lines that contradict reality** → fix the line, and say why you did.
  This is the cheapest possible place to catch them: the sweep has already read every
  issue's true state, so this compares what is already in hand and scans nothing new.

  Only **hand-written** checklists — an epic using native sub-issues is maintained by
  GitHub and needs nothing (`gh issue view <epic> --json subIssuesSummary`). The three
  forms seen in the wild, all in one repo on one day:

  | line says | reality | fix |
  |---|---|---|
  | "in progress, branch `x`" | branch gone, issue closed, code on trunk | tick it, cite the trunk sha |
  | ticked, noted "held open for review" | issue already closed | drop the stale note |
  | unticked | issue closed with evidence | tick it, cite the sha |

  The first form is the expensive one: it is how a session gets spent rediscovering
  work that already shipped — the failure measured at 4 of 9 sessions in a day in
  `code-triage`'s opening principle. The epic is the source triage is *instructed* to trust, so a wrong line
  there does not merely annoy; it throws away a session.

  Same four limits as `code-ship` B2c: never close the epic on a full table, never
  rewrite its prose, never build a table that does not exist, never infer parentage
  from a title.

## 6. Report

```
swept 4, left 3

wrapped         fix/import-115-114-113   → trunk a1b2c3d, #115 #114 closed, #113 split
teardown-only   feat/console-shell-28    → content already on trunk, worktree removed
claim-only      #26                      → shipped in e4f5g6h, claim released
place-claim     . (trunk checkout)       → holder session unknown-liveness — reported, not released
unrecorded      .worktrees/orphan-1      → landed vs main, no claim — removed by hand
blocked         feat/session-types-26    → 2 untracked files never committed — needs a human
blocked         #58                      → trunk CI dead (billing), cannot merge
unlinked        fix/railquiet-fixture-trunk-red → 1 commit ahead of trunk, no issue claimed — not wrapped, not dropped
```

Say what you left and why. A worktree kept for a stated reason is fine; a worktree
kept silently is the 8-of-9 statistic repeating.

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
```

## Verify complete

- Every worktree **`git worktree list` knows about** is in exactly one bucket — none
  silently skipped, **including `unrecorded` rows** (§1.2): `colab worktrees`'s own
  git-vs-record reconciliation is what makes this checkable at all (#67 — before it, an
  unrecorded worktree was missing from both the enumeration and the buckets, so this line
  could never actually fail). In a scoped run, every worktree is either in a bucket or
  named as out of scope; "not selected" is a stated outcome, never an omission. **This does
  not cover a directory `git` never linked at all** (#97) — that shape needs its own
  detector, tracked separately.
- A scoped run reported `N of M`, restricted §5 to the selection, and did not run
  `doctor --prune`.
- A selector that matched nothing said so — not "swept 0".
- **One of the three required §0 outcome lines was printed, first, before anything else** —
  `unchanged` / `changed:<inputs>` / `no usable cache`.
- A run that short-circuited named the timestamp it compared against; a run that stopped
  recorded enough for the next ping to resume rather than restart.
- `$CACHE` holds the **required** `code-sweep/2` shape — one record, not an accumulating
  map of `scope:*` keys — with `version`, `scope`, `ranAt`, all `fingerprint` keys, and
  `lastRun`. An `interrupted` block is present only while genuinely unresolved, and is
  removed (not left empty) once the sweep it describes finishes.
- Every merge was preceded by its own CI check, not one check for the whole sweep.
- Every issue closed carries evidence; every claim released, including on issues you
  did not finish.
- `colab worktrees` (scoped) shows only worktrees you deliberately kept, each with a
  reason in the report.
- **The main checkout is on trunk** — `git branch --show-current`. A sweep that ends
  with the checkout parked on a feature branch has left the repo in the state it was
  meant to clear.
- Nothing was forced past uncommitted work.
- **On a repo permitting trunk-direct (not declaring `writes: isolated`):** `colab places` was checked, every stale hold reported
  (never force-released without the human-only `COLAB_HUMAN` override), and every selector that matched
  nothing was checked against trunk history for a `landed trunk-direct` unit before
  being reported as `selector matched nothing`.
