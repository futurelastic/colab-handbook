---
name: code-sweep
description: "Clear out everything finished in ONE repo: find every worktree whose work has landed, every issue whose code shipped but is still open, and every claim outliving its session — then ship the wrapped and send the unwrapped back to their implementer, one at a time. Run it at end of day, or ping it whenever a session goes idle — cheap to re-run only when §0 is honoured first, a convention the executing agent follows and not a gate anything enforces (its fingerprint stays sensitive to branch tips, so the cheap path is rarer here than in code-triage — see §0). Sorts candidates into ship / send-back / teardown-only / claim-only / place-claim / unrecorded / blocked / unlinked / spent-remote / orphan-shippable, because most need neither a wrap nor a ship, and the sweep never codes: unwrapped work goes back to its implementer with one Issue comment. Orphan-shippable is wrapped work with no worktree — a pushed branch still carrying an open, claimed issue — which is shipped when `colab ship --dry --json` reads READY and reported with its failing precondition when it does not, never passed over. Spent remote branches — refs left on origin by ships that kept the branch, whose issues are all closed — are listed for a human to delete, never deleted by the sweep. A candidate that fails mid-run is deferred and the run carries on to the next one; only a repo-wide blocker (trunk CI dead or red) or a destructive/unclassifiable failure stops the sweep. Before writing its cache record and reporting, it re-derives the candidate set once more, so a branch that finished its wrap while a long grade was running is processed or named, never left waiting on a notification that does not exist. Can be scoped to a set of issues or one session/worktree instead of the whole repo. Trigger phrases: 'sweep the repo', 'wrap everything finished', 'clean up the worktrees', 'close out the session work', 'tidy up finished work', 'wrap all the done branches', 'sweep the issues #95 #96', 'sweep the session <name>', 'ship these'; and — when this session's last act was a sweep — the re-ping forms 'again', 'anything new?', 'check again', 'anything to wrap yet?', or a bare 'go'. Orders the merge pass by readiness — candidates green at their head and merge-clean against trunk land first, a CI wait is capped at the repo's measured CI bound per candidate and then deferred with its run id so the pass ends and the trunk lock releases, same-file siblings land in a mechanical order (earlier wrap, tie → smaller diff) instead of waiting on a human, and a candidate whose issues already shipped under another sha is dropped before grading. Composes code-ship per candidate; never runs code-wrap (a coordinator never edits or commits implementer work, #409); batches merges only through `colab ship --batch`, and only where project.yml declares `ship-batch`."
---

# code-sweep — clear out everything finished, one at a time

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/code-sweep.md 2>/dev/null || echo "(no local policy for code-sweep in this repo)"`

If `.colab/skills/code-sweep.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

After a few parallel sessions, two things drift apart:

- **worktrees** — merged but never torn down (measured: **8 of 9**, 2.9 GB of orphans)
- **issues** — shipped but still open, or closed but still holding a claim
- **branches** — wrapped, pushed and green, but never shipped, because the session that
  wrapped them held no worktree (#352)

This sweeps one repo and reconciles both. It does not replace
[`code-wrap`](../code-wrap/SKILL.md) and [`code-ship`](../code-ship/SKILL.md) — it
finds the candidates, runs [`code-ship`](../code-ship/SKILL.md) on the wrapped ones in
sequence, and **sends the unwrapped ones back** to their implementer. It never runs
`code-wrap` itself: the coordinator never edits or commits implementer work
([CONVENTIONS](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409), #409).

**How this file is built (#524).** This is the core: the steps in order, each with its rule
and its stop condition, and the commands and tables a run executes. Each step's full text —
edge cases, the measurements behind them, worked examples — sits in a reference file next to
this one, moved there verbatim, and the step names it. **Read a step's reference file before
you act on that step**; the line here is an index to it, never a substitute. Where they seem
to differ, the reference file holds the full rule.

## Principle — sequential, and most candidates do not need a ship

**One at a time.** Every merge moves trunk, so the next candidate must sync against
the *new* trunk (code-ship B0). Batching merges "to save time" produces exactly the
generated-file conflicts B0 exists to prevent.
The one exception is a batch that is **tested before it becomes trunk**: where
`.github/project.yml` declares `ship-batch`, `colab ship --batch` lands up to N ready
candidates as one combined run followed by one fast-forward (code-ship B0, *Batch landing*,
#373). That is not batching "to save time" — trunk only ever receives a state that passed
CI as a whole. Anything else still goes one at a time.

**Sort before acting.** A worktree whose branch already landed needs teardown, not a
ship. Shipping it again re-does grading nobody needs and risks a second merge of the same
content.

**Run it as often as you like.** This used to be described as the end-of-day job after
several parallel sessions, which read as a prohibition on running it more often — and the
cost made that reading fair. §0 removes the cost: a ping with nothing new is three calls
and a sentence. So a long-lived shipping session may re-run this whenever it goes idle.
Frequency was never the hazard; *re-deriving everything* to discover nothing changed was.
Nothing below gets cheaper by being skipped — least of all the per-merge CI re-check.

## 0. Has anything changed, and was a sweep left half-finished?

**Rule:** same fingerprint as [`code-triage` §0](../code-triage/SKILL.md), keyed on trunk sha,
branch **tips** and the backlog, cached in `$CACHE` (`<git-common-dir>/colab-sweep.json`).
Print one of the three outcome lines first, every run: `unchanged` / `changed:<inputs>` /
`no usable cache`. A `ci-wait` deferral costs one `gh run view` per entry and re-arms the
full path once its run completed. A matching fingerprint never authorises a merge.
**Stop:** fingerprint unchanged and no interrupted sweep recorded ⇒ report `nothing has
changed since <ts>`, name the candidates still standing, stop.
Full text: [0-fingerprint.md](0-fingerprint.md).

### 0.1 Resume an interrupted sweep

**Rule:** only a run-level stop (trunk CI dead or red, or a destructive/unclassifiable
failure) writes `interrupted`; the next run re-tests that reason first and nothing else,
re-derives buckets once it clears, and confirms each recorded completion with `colab landed`.
A deferral is **not** an interruption — it lives in `conclusion.deferred`. `$CACHE` is one
versioned `code-sweep/2` record, overwritten each run.
**Stop:** the stop reason still holds ⇒ report `still blocked: <reason>, since <ts>`.
Full text, including the required `$CACHE` shape every run writes:
[0.1-resume-and-cache.md](0.1-resume-and-cache.md).

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

**Rule:** every `unrecorded` row `colab worktrees` prints is a candidate for §3, exactly like
a recorded worktree. A directory `git worktree list` never linked is outside this check.
Full text: [1.2-unrecorded-rows.md](1.2-unrecorded-rows.md).

### 1.3 Remote refs — the one input that is not a worktree, a claim or a place (#331)

**Rule:** list origin's branches once against one `gh issue list --state all` call; sort each
by its trailing issue numbers into `spent-remote` (every number CLOSED), `orphan-candidate`
(every number OPEN + `in-progress`, no worktree here), `open-issue`, `no-number` or
`has-worktree`. Only the first two go to §3. Trunk, `integration:` lines and `dependabot/*`
are dropped first.
Full text, with the one-call script: [1.3-remote-refs.md](1.3-remote-refs.md).

### 1.1 Scoped mode — sweep a subset, and say that you did

**Rule:** `sweep the issues #95 #96` / `sweep the session <name>` — enumerate everything
first, then narrow. A scoped run restricts §5 to the selection, never runs `doctor --prune`,
reports `scoped to N of M` and names the M−N, and keys its cache by its selector. On a repo
permitting trunk-direct, check `git log origin/<trunk> --grep="#$N"` before reporting
`selector matched nothing` (a match is `landed trunk-direct: <sha>`).
Read when the run is scoped, or a selector matched nothing:
[1.1-scoped-mode.md](1.1-scoped-mode.md).

## 2. Decide what "finished" means — one rule, not per-candidate judgement

**Rule:** `git fetch origin`, then `colab landed --all` — `landed` · `cargo` · `unknown`,
against each branch's **base**. Never count commits or trust the merge graph; `unknown`
means cargo. Git state and claim state are two signals — keep them apart.
Full text, with the raw-git fallback: [2-finished.md](2-finished.md).

## 3. Sort into ten buckets — each gets a different action

**These buckets are keyed off what §1 enumerated — worktrees, claims, places, and
(for `spent-remote` and `orphan-shippable` only) origin's branch refs (§1.3) — which is complete for a repo declaring the veto (`writes: isolated`, every
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
| **ship** | `cargo` (or `unknown`), at least one claimed issue, **and** the hand-off verifies: clean worktree, local head == origin head, head older than the newest non-bookkeeping comment on every carried issue (test 3 below) | [`code-ship`](../code-ship/SKILL.md) only (§4) |
| **send-back** | `cargo`/`unknown`/dirty with a claimed issue whose hand-off does **not** verify: uncommitted work, unpushed head, no distill comment newer than the head | post ONE `↩️ Sent back` comment to the implementer, report it as sent back, continue — see below. **Never run `code-wrap`** |
| **teardown-only** | `landed` — content already on its base, worktree lingering | remove worktree, release claims; close via `colab ship` when it has zero commits (evidence-close, #90), else `colab close <N> --comment "<evidence>"` |
| **claim-only** | no worktree; `in-progress` on work already shipped | `colab close <N> --comment "<evidence>"` — closes and releases the claim in one step (#381) |
| **place-claim** | `colab places` lists a hold whose session is not this sweep's — see below | **check liveness, report — never force-release a live holder** |
| **unrecorded** | on disk, `colab worktrees`'s `unrecorded` list — no claim, no ports | **report only** — see below, never `code-wrap`/`code-ship` |
| **blocked** | genuinely unfinished with no implementer to address (no claimed issue, nothing to comment on) | **report — never force** |
| **unlinked** | `cargo` (or `unknown`), **zero** claimed issues | **report — do not wrap** (#92) |
| **spent-remote** | on origin only — no worktree here, not trunk or an `integration:` line — and every trailing issue number CLOSED (§1.3) | **report only — never delete** (#331, keeps #17) |
| **orphan-shippable** | on origin only, no worktree here; every trailing issue OPEN + `in-progress` (§1.3); `cargo`/`unknown` against its base; head committed before the issue's last hand-off comment — see below | `colab ship --branch <br> --dry --json` → `ok` ⇒ [`code-ship`](../code-ship/SKILL.md) through §4; not `ok` ⇒ **report the failing rows — never silence** (#352) |


Each bucket with more than a table row of rules has its full text in a reference file —
read it before acting on a candidate in that bucket:

- `send-back` — [3-send-back.md](3-send-back.md): the coordinator never codes (#409); the
  hand-off test, the ONE `↩️ Sent back` comment, and its idempotency.
- `spent-remote` — [3-spent-remote.md](3-spent-remote.md): report only, never delete.
- `orphan-shippable` — [3-orphan-shippable.md](3-orphan-shippable.md): the three tests in
  order (including test 3's hand-off filter, #517), and the `colab ship --dry --json` reading.
- `place-claim`, `teardown-only`, `claim-only` — [3-place-claim-and-teardown.md](3-place-claim-and-teardown.md):
  liveness, never force-release; teardown first because it is cheapest; when a close is yours.
- `unrecorded`, `unlinked`, and the teardown commands —
  [3-unrecorded-and-unlinked.md](3-unrecorded-and-unlinked.md).

## 4. Ship the wrapped — one at a time, re-checking between

### 4.0 Order the pass by readiness — ready work first (#370)

**Rule:** before the first merge and after each one, drop candidates whose issues already
shipped, then land **ready** ones first (branch class `green` at its head and merge-clean
against trunk), then those waiting on CI (each one bounded wait, `colab ci-wait …` — its
default deadline is the repo's CI bound — then a `ci-wait` defer with the run id), then everything else. Same-file siblings land
earlier-wrap first, tie → smaller diff, tie → ref name — never a human gate. On a repo
declaring `ship-batch`, the first N ready candidates go through `colab ship --batch`. A landed
gate fix ⇒ `--dry` every parked candidate, same pass. `colab ci-wait` is the only way to wait for CI (#495).
**Stop:** exit 4 (`RATE_LIMITED`) from a wait ends the whole sweep. The pass ends once the
ready bucket is empty and every wait resolved or deferred — never re-enter a wait.
Full text: [4.0-order.md](4.0-order.md).

For each candidate, in the order 4.0 set:

1. **Re-check trunk CI.** Ask by commit, not by recency (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), #92):
   `colab trunk-ci` must print `GREEN` for `<trunk>`'s current head sha — the verdict
   `colab ship` gates on, every workflow's newest run there green, not merely one
   (#463). (`gh run list --branch <trunk> -L 1` reads whatever ran *last*, and a
   cancelled straggler can outrank a passing run on the same commit under
   `cancel-in-progress`.) Not
   once at the start — trunk CI can die mid-sweep (billing lockout, runner outage),
   and a failure that never started still means stop. A sweep can take an hour.
   This re-check is about the **branched** `ship` candidates below — the merge each
   is about to go through depends on it being alive, at whatever thoroughness its
   `exposure` demands ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)).
   A `place-claim` or `landed trunk-direct` candidate never merges through here at
   all, so this step has nothing to re-check for those.
2. Run **code-ship** for that candidate: B0 sync against the *current* trunk, harvest,
   grade, merge, evidence, release, teardown. **Never run code-wrap here** — a candidate
   reaches §4 only because §3 verified its hand-off, and one that does not verify was
   sent back instead (#409). An `orphan-shippable` candidate has no worktree; it goes
   straight to code-ship with `--branch <br>`, and code-ship's §0 is where a wrap that
   did not in fact happen gets caught. Re-run the dry run first if trunk moved since
   §3 sorted it.
3. **Then** move to the next — and re-sort (§4.0) first. Trunk has moved: the next B0
   must see that, a candidate that was merge-clean may not be any more, and one that was
   waiting on CI may have gone green in the meantime.

When the list runs out, the run is not over: [§5.1](#51-re-derive-once-more-before-you-stop-329)
re-derives it once more. The list you started with is not the list the repo has now.

### A failure defers that candidate — the run goes on (#308)

**Rule:** a candidate-scoped failure (a conflict needing judgment → send-back, its own gate,
a rejected grade, a capped CI wait) is **deferred** with its reason, and the run continues.
Trunk red ⇒ classify first (code-ship B1: one keyed re-run for a runner-side red). A
repo-wide one (trunk CI dead or red) stops the **merge loop** only — §5 and the
non-merging buckets still run — and routes to the cure rule; nothing here licenses a merge
onto a red trunk. Destructive or unclassifiable ⇒ stop, treat as repo-wide.
**Stop:** recorded as `interrupted` (§0.1) for a run-level stop; `conclusion.deferred` for a
deferral.
Full text: [4-failure-defers.md](4-failure-defers.md).

## 5. Reconcile the tracker

**Rule:** close open issues whose code shipped (evidence: trunk sha + `file:line`, verified in
the code), release claims on closed issues, `colab doctor --prune` claims whose worktree is
gone, report `colab deliver --dry` on a repo declaring `owner:`, fix hand-written epic
checklist lines that contradict reality, report unshaped `needs-decision` asks, close open
containers whose native sub-issues are all closed (`colab close`). Scoped run ⇒ restricted
to the selection, no prune.
Full text, with the container query: [5-reconcile.md](5-reconcile.md).

### 5.1 Re-derive once more before you stop (#329)

**Rule:** last step before the `$CACHE` write and the report: recompute §0's inputs against
this run's own §1 snapshot (minus what the run itself merged); anything else moved ⇒ re-run
§1 and §3, process what ripened through §4/§5, repeat. Store the fingerprint and conclusion
from that same final pass. Never end on a promise to wake up.
**Stop:** a re-derive finds nothing new; anything left unprocessed is listed with a reason.
Full text: [5.1-rederive.md](5.1-rederive.md).

## 6. Report

**Rule:** one line per candidate in its bucket's words; say what you left and why. The
`end-of-run` line is required on every run past §0. `deferred` (tried, failed, moved past —
what failed, what clears it) and `blocked` (never sent to §4) are never collapsed; a
repo-wide trunk-CI failure is the `stopped:` ending, not a candidate line. A scoped run names
its boundary on line one.
Full text, with the report samples and the distinct endings: [6-report.md](6-report.md).

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
- **§1.3's remote-ref list was read, and every `spent-remote` ref is named in the report**
  (or the report says there are none). A count with no names cannot be acted on. **No ref
  was deleted by this run** (#17, #331).
- **Every `orphan-candidate` row from §1.3 reached a line of its own**: shipped, sent to
  `claim-only`, `send-back` as not yet wrapped, or `orphan-shippable` with its failing check
  named. A candidate that failed a check is never absent from the report (#352).
- **No `code-wrap` ran and no implementer file was edited or committed by this run** (#409). Every candidate with an unverified hand-off got one `↩️ Sent back` comment (or a `sent-back (pending since <ts>)` line when one already stood at the same head), and `conclusion.sentBack` lists them.
- A selector that matched nothing said so — not "swept 0".
- **One of the three required §0 outcome lines was printed, first, before anything else** —
  `unchanged` / `changed:<inputs>` / `no usable cache`.
- A run that short-circuited named the timestamp it compared against; a run that stopped
  recorded enough for the next ping to resume rather than restart.
- `$CACHE` holds the **required** `code-sweep/2` shape — one record, not an accumulating
  map of `scope:*` keys — with `version`, `scope`, `ranAt`, all `fingerprint` keys, and
  `lastRun`. An `interrupted` block is present only while genuinely unresolved, and is
  removed (not left empty) once the sweep it describes finishes.
- **No candidate was skipped because a different candidate failed.** Every §4 failure is
  recorded either as a `deferred` line — candidate-scoped, and the run went on — or as a
  run-level stop naming a repo-wide or destructive cause. "Stopped at candidate 3", with 4
  through N never examined, is no longer a conforming outcome (#308).
- A run-level stop halted the **merge loop** only: §5's reconciliation and the
  non-merging buckets either ran, or are named as deliberately skipped with a reason.
- **§5.1 ran before the `$CACHE` write and the report**, and the report carries its
  `end-of-run` line. Every candidate that ripened during the run was either processed or
  listed as `ripened … not processed` with a reason. The stored fingerprint and conclusion
  come from the same final pass. No line in the report waits on a notification, callback or
  "once X finishes" (#329).
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
