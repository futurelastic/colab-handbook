# code-ship · B0 Is there still cargo? Then sync `<base>`

Reference for [`code-ship`](SKILL.md) B0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B0. Is there still cargo? Then sync `<base>` into the branch

**First, know what you are merging into.** `<base>` is the branch's base: `<trunk>`
in the ordinary case, or the declared `integration:` line the session was cut from
(`CONVENTIONS.md` [§2](../../CONVENTIONS.md#2-tiers), recorded by `colab worktree new --base`). Everything below —
the sync, the CI check, the squash, the push — targets `<base>`, not trunk-by-reflex.
Shipping a line-based branch into trunk would drag the whole line in behind it inside
one squash commit.

```sh
colab worktrees --json     # .worktrees["<name>"].base — trunk if it has none (shape: #67)
```

**Then ask whether it already shipped under another sha — before you grade anything
(#370).** A squash followed by `<base>` movement reads `unknown` below, so a ref kept
after an earlier ship looks exactly like unshipped work.
Why: [ADR 536](../../docs/adr/536-code-ship-b0-sync-rationale.md).
The
squash message carries what the tree cannot (`CONVENTIONS.md`
[§4](../../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong),
*Has it landed?*):

```sh
git fetch origin <base>
for N in <every issue the branch carries>; do
  git log origin/<base> -i -E --format="#$N %h %cI %s" \
    --grep="(close[sd]?|fix(e[sd])?|resolve[sd]?) #$N([^0-9]|$)"
done
git log -1 --format=%cI <branch>     # the branch's newest commit, to compare against
```

- **Every issue matched, every issue CLOSED, and no branch commit newer than its matching
  squash** → **shipped already.** Do not grade, sync or merge. Go to B2b (post evidence
  only where the issue has none), B3 and B4, and say in the report which squash sha it
  shipped in — a phantom candidate is a finding about whoever kept the ref, not a failure
  of this branch.
- **A match, but the issue is OPEN again, or the branch has commits after the squash** →
  a continuation. It is cargo; ship it normally, and grade only what came after the squash.
- **No match** → nothing learned; the landed question below decides. The grep only ever
  moves a candidate *out* of the queue — its absence never rounds a verdict toward
  `landed`.

**Then ask whether there is anything left to ship:**

```sh
colab landed --worktree <name>      # landed · cargo · unknown
```

- **cargo** → continue with the ship. This is the normal path.
- **landed** → the content is already on `<base>`. **Do not merge again.** Go
  straight to B2b (evidence), B3 (release claims) and B4 (teardown).
- **unknown** → treat as cargo and look by hand before merging.

**`landed` with ZERO commits of its own is a different thing, and it has its own
door (#90).** A session can finish with a real deliverable and no diff at all: a
decision recorded on its issue, an investigation concluding "no change needed", a
design artifact stored outside the repo. That is not an exotic shape, and the route
above does not close it — B2b wants "the `<base>` squash sha", which does not exist
here, and no step in this skill has ever run `gh issue close`.
Why: [ADR 536](../../docs/adr/536-code-ship-b0-sync-rationale.md).

```sh
colab ship --worktree <name> --dry     # → MODE: evidence-close, if that is this branch
colab ship --worktree <name>           # posts evidence, CLOSES each issue, tears down
```

It merges nothing, pushes nothing, and writes no empty marker commit. It is gated on
each issue **already carrying a comment colab did not write** — so record what you
delivered on the Issue first (`code-wrap` A1 is where that happens anyway), or ship will
report the issue and leave it open. The zero-diff fact is measured from git; you do not
declare it.

**A unit committed straight to trunk has no branch — its door is `--direct` (#302).**
#284 ruled that a trunk-direct unit still closes via evidence-close; the branch door above
cannot find one (no worktree, no branch, and `--branch <trunk>` is refused), so it has its
own:

```sh
colab ship --direct --session "$SESSION_ID" --dry   # → MODE: evidence-close (trunk-direct)
colab ship --direct --session "$SESSION_ID"         # posts evidence, CLOSES, releases claims + hold
```

It closes exactly the claims **this session** holds in the repo with no worktree and no
branch — identity is required, another session's claim is never touched — and only once
the work is **published** (trunk checked out, clean, not ahead of `origin`). Everything
else is the branch door's: autonomy gate, trunk CI, the checklist close gate, and the same
evidence gate (code-wrap A1's distill comment is the evidence). An issue left open keeps its
claim, so a re-run finds it. A solo session with no claim has nothing to close and does not
run this. All three of those gates (evidence, autonomy, trunk CI) are ⚖ ruled for a `direct`
unit — confirmed as built ([#342](https://github.com/futurelastic/colab-handbook/issues/342),
CONVENTIONS.md §2). The autonomy gate's docs-only exception (#345) applies here too: without
`auto-trunk`, the unit closes when every trunk commit since its earliest claim — by anyone —
touches documentation only. **The core-path rule (#350) refuses here instead of pausing (#351):**
a trunk-direct unit has no PR, so when the rule is active and that same window touched a core path,
`--direct` refuses with a human-gated `core-path review` row and closes nothing. Redo the change on
a branch and ship that. If the paths are another unit's reviewed landing, a human closes the issue
(`colab close <N> --comment "<evidence>"`). Never route around the refusal
(`CONVENTIONS.md` [§2, *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).

**Never decide this by counting commits.** A squash-merge mints a new sha, so a
shipped branch's own commits look permanently unmerged — a count-only check calls
*every branch we have ever shipped* unshipped and invites re-merging finished work.
Without `colab`, ask the content question directly: `git merge-tree --write-tree
origin/<base> <branch>` printing exactly `git rev-parse origin/<base>^{tree}` means
the branch adds nothing. (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong), "Has it landed?")

**This sync is the coordinator's own act, in the worktree it already holds — it makes no
contact with the branch's originating session.** `git fetch` and `git merge` need
nothing from that session: not a running process, not a reachable prompt, not an empty
composer. Being unable to deliver a message into it changes nothing about this step —
see *What a defer is for*, above, before treating anything about that session's state as
a reason to stop here. It is also the first of the three owner-ruled mechanics the
coordinator keeps under #409's "never codes" rule (`CONVENTIONS.md`
[§4, *Who may touch a branch*](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409)):
sync, regenerate a generated file, resolve a purely mechanical conflict. Nothing else in
this section writes to the branch.

**Now sync.** Merge conflicts here are almost always **generated files** (codegen
locks, duplicate-timestamp migrations, generated route/type files) — they happen when
a branch regenerated on an old base while `<base>` moved ahead. Cure it in the branch,
before touching `<base>`. Skip if `<base>` hasn't moved since you branched
(`git rev-list --count <branch>..origin/<base>` = 0):

```sh
git fetch origin <base>
git merge origin/<base>        # conflicts in generated files → the regen below overwrites them
```

**Check what the merge actually did before touching anything else — do not chain
straight into `add -A && commit` (#123).** `git merge` failing with **zero**
conflicted paths is not a conflict to resolve; it is the merge never having
applied (transient index-lock contention is the measured cause). Both that case
and a real, resolved conflict leave `MERGE_HEAD` set and look identical to every
cheap check afterwards — parent count, `merge-base --is-ancestor`, even a green
gate, since a tree that lost `<base>`'s newer work is still perfectly
self-consistent. Only the diff against `<base>` tells the two apart:

```sh
git diff --name-only --diff-filter=U        # unmerged paths right now
```

- **Non-empty** → real conflicts. Sort each conflicted path into exactly one of three
  (#409), reading the region, never resolving mechanically by side:
  - **Generated file** (`generated:` globs, built-in lockfiles) → take **trunk's side**
    (`git checkout --theirs -- <path>` during this merge of `origin/<base>`), then the regen
    below overwrites it. Trunk's copy is the one every other branch syncs against (#540).
  - **Purely mechanical** → the resolution keeps both sides' hunks unchanged, adds no
    line of its own and picks no winner (two appends to one list, two adjacent edits that
    do not touch each other's lines). Resolve it. Two hot-file shapes are this case, each
    with a fixed answer (#540):
    - **A retired shared file** — `<base>` deleted it, or renamed it away, and the branch
      still edits it → trunk's side (`git rm <path>`), **unless** the branch's edits to it
      are substantive and are not already carried to the file's replacement: that is a
      change of the author's that would be lost, so it needs judgement (below).
    - **An append-only ledger** → the **union** of both sides: `<base>`'s entries first,
      then the branch's, an identical line kept once. A file counts as append-only here
      only by measurement — neither side's diff against the merge base deletes a line in
      the conflicting region (`git diff $(git merge-base HEAD origin/<base>) <side> --
      <path>` shows no `-` line there). A side that edits or removes an entry is not an
      append: judgement.
  - **Anything that needs judgement** — a line both sides changed, a rule one side reversed
    that the other still carries as context (see the incident in this file's history) →
    `git merge --abort`, **send it back** to the branch's author (§0, *send-back*), and
    defer the candidate. Never pick a winner from here.

  Then `git add` the resolved paths and commit explicitly — never `add -A` blind,
  it will also stage unrelated working-tree cruft into the merge commit.
- **Empty, and `git merge` reported failure** → the merge never ran. **Do not
  commit.** Fix the transient cause (retry after the index lock clears, `git
  merge --abort` first if `MERGE_HEAD` is stuck) and re-run `git merge
  origin/<base>` from a clean state. Committing here manufactures a two-parent
  merge whose tree is the branch's pre-merge tree — a merge commit that reads as
  "synced with `<base>`" while silently reverting everything `<base>` had that
  the branch didn't.

Then re-run the repo's codegen on the merged base (e.g. `npm run build` /
codegen) if the repo has one, and commit:

```sh
git add -A && git commit -m "chore(sync): merge <base> + regen generated files"
```

**`<base>` is the only ref this step may merge — never a sibling member's branch.** If
this branch carries a `group:` label and a sibling still has unmerged work you want, the
answer is to sequence behind it or group onto it (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*),
never to pull it in here.
Why: [ADR 536](../../docs/adr/536-code-ship-b0-sync-rationale.md).

**Carrying a `group:` label with a sibling ref still live? You are landing one of N.**
Land yours against the current `<base>` and **re-derive the contention here** — `colab
holders` on the group's own paths — rather than trusting a triage snapshot. Triage names
a carrier and a rebase order at pass time
([`code-triage` §3](../code-triage/SKILL.md#3-group--this-is-a-correctness-constraint-not-tidiness),
[§6](../code-triage/SKILL.md#6-report--make-it-directly-actionable)); trunk has very likely
moved since, and a verdict stamped to an older trunk sha is exactly the perishable kind
that must not be treated as current at merge time.

**Before the gate, assert the merge actually incorporated `<base>` — a green
gate is not evidence of this, only of self-consistency:**

```sh
git diff --stat origin/<base> HEAD
```

This must show **only this branch's own files**. Deletions of files the branch
never touched — especially other issues' shipped code, or `CLAUDE.md` Status
entries — mean the sync commit above was the false-merge shape despite the
guard: stop, do not proceed to the gate or the ship, and re-derive the merge
from a fresh `git merge --abort` + retry rather than trying to patch the bad
commit.

**Gate the sync commit — the one gate the coordinator runs, because it is the one commit it
made (#409).** On a `gate: authoritative: ci` repo (#410): push the sync commit and let B1a's
bounded wait read the branch run at the new head — that run **is** the verdict; run nothing
locally. Everywhere else, re-run the gate (`code-wrap` A3, the hermetic second run included —
its verdict must be `green` or `skipped`, never `live-env`, #403) — a fresh-migrate test must
pass, proving both branches' migrations run clean together. Either way, a `red:finding` at the
post-sync head is a **send-back**, never a fix from here. **Where branch CI exists, prefer
push-then-read over a local repeat for the hermetic half (#408):** the sync moved the head, so the old `branch-ci`
verdict is stale, but pushing the sync commit starts a new branch run at the new head. B1a's
bounded wait then reads it, and a `green` class there, meeting `code-wrap` A3's three
conditions, is the hermetic verdict (`branch-ci <new sha7>`). Run `colab gate-hermetic`
locally only when that run cannot arrive (no trigger for the branch), comes back other than
`green`, or its workflow does not run the tests. Run the suite once and tee its output to a
file; grep the file afterwards rather than re-running the suite to read another slice. *(Machine-specific reconcile — e.g. deduping a
migration against one already on trunk — hooks in here; the universal rule is
"regen on the merged base, never hand-merge generated files".)*
