---
name: code-ship
description: "Close the COORDINATOR half of a coding session, authorized: verify code-wrap's hand-off contract, grade the diff against the session's plan (or the Issue's stated ask), verify trunk CI is alive and green, harvest every issue the branch carried, squash-merge with Closes #N, post evidence on each issue (including the grade verdict), release every claim, tear the worktree down — and, if a plan file existed, journal one line about its usage and delete it. The release ritual — promotion plus tag on exposure: released, or the promotion itself on exposure: live — is a separate thing, never bundled in, and never authorized by anything below regardless of autonomy. Trigger phrases: 'ship it', 'merge to trunk', 'merge it', 'update the issue and merge'. Runs after code-wrap: on a repo without `autonomy: auto-trunk`, only once a human says go — a dashboard Merge click counts, an agent's own say-so never does; on a repo declaring that grant, the grant itself is the standing go-ahead for the trunk-merge step, re-verified against this skill's own mechanical gates every run."
---

# code-ship — merge a wrapped session: verify hand-off → grade → CI → squash → evidence → release → teardown

This is the **coordinator's** half of closing a session — [`code-wrap`](../code-wrap/SKILL.md)
is the implementer's. Where that skill asserts a checklist and stops, this one verifies
the checklist independently and then performs the merge once authorized — see *Principle*
and *What counts as "a human said go"*, below, since what counts as authorization takes
one of two shapes depending on the repo's `autonomy:` field. It runs in a coordinator
session, typically a different one from the implementer's, sometimes at a different model
tier.

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions merge into
— the value of `trunk:` in `.github/project.yml` ([§2](../../CONVENTIONS.md#2-tiers):
`main` on Tier B (fixed); on Tier C a branch distinct from `main` — `dev` by default,
any other name equally conforming, never a fixed spelling; `dev` on the ordinary Tier A,
or `main` on a tag-gated Tier A) — the tier letter is only ever a **legacy** correlate
of the value, it never decided it · `<base>` = **the branch this session ships into**
— `<trunk>`, unless the worktree was cut from a declared `integration:` line, in which
case it is that line.

**`ceremony: light`? B2b's evidence comment is skipped entirely** (the squash's
`Closes #N` suffices) — project.schema.md#ceremony--optional. Every other step here —
claim discipline, worktree teardown, squash + `Closes #N`, the CI gate — runs exactly
the same regardless of `ceremony`.

## Principle

**Agents prepare releases; humans perform them** — either directly, per run, or once,
standing, through a grant the repo's own `project.yml` declares. A trunk merge here is
always authorized, never inferred — see *What counts as "a human said go"*, below, for
the two shapes that authorization takes depending on whether the repo carries
`autonomy: auto-trunk`. Do not open a PR, push trunk, promote to `main`, or tag on your
own initiative; **no authorization of either shape ever covers those** — both are scoped
to the trunk-merge step (B2) alone, on every repo, on every tier, with no field able to
say otherwise.

## 0. Verify the hand-off contract — don't trust the report, re-derive it

`code-wrap` **asserts** seven things when it stops. Re-check each from git and GitHub
directly — a session's own report of its state is exactly the kind of self-grading #94
exists to add a second check on top of:

**Resolve `$MAIN_REPO` first, from wherever this coordinator session happens to be
running** — it may itself be inside a worktree, and every plan-file path below is
meaningless unless it is anchored to the main checkout rather than `$PWD` (#113):

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

git ls-remote origin <branch>                              # branch actually pushed?
gh issue view $N --comments | tail -5                       # distill comment present?
colab claims                                                 # claim(s) still held?
ls "$MAIN_REPO/.claude/plans/issue-$N.md" 2>/dev/null        # plan file, if one was written
git -C "$MAIN_REPO" status --porcelain -uall                 # trunk checkout still clean?
```

- **Branch not on the remote** → `code-wrap` did not finish A5. Stop; do not improvise a
  push from here.
- **No recent distill comment** → A1 did not happen, or happened somewhere this can't
  see. Ask, don't assume it was verbal.
- **Claim released already** → someone (or something) other than this skill let it go.
  That is a finding — B3 below is supposed to be the only unconditional release — chase
  it before merging over a claim that may no longer mean what it used to.
- **Gate result** has no independent artifact to re-derive from outside the report itself
  on most repos — trust the report here, but if anything else on this list is off, treat
  the gate claim as unverified too and re-run it (`code-wrap` A3) before proceeding.
- **Trunk checkout dirty here too** → `code-wrap` A2b's own re-derivation (its *Verify
  complete* step) either missed this or ran before whatever caused it. Don't re-run the
  same ownership ladder blind: `git ls-remote` above already told you this branch's
  remote sha, so diff it directly — `git -C "$MAIN_REPO" diff --name-only <path>` against
  the branch's own commits for **branch overlap**, then the dirty path's content, same as
  `code-wrap` A2b — before deciding whether this is the wrapped session's own stray write
  (send it back, don't merge over it) or a genuinely different live session's work
  (`colab worktrees` for a name to route the finding to). **Never merge past an
  unattributed dirty trunk** — `colab ship`'s own precondition already refuses on a
  dirty trunk checkout; this is what turns that refusal into something someone can act
  on, not a reason to bypass it.

A contract that fails to verify is not a reason to skip the merge — it is a reason to
fix the gap (re-push, re-comment, re-claim) before continuing, or to hand back to an
implementer session rather than papering over it here.

## What counts as "a human said go"

**Check the repo's `autonomy:` field first — it decides which of the two doors below
applies.** They are not layered (one is never required on top of the other); they are
alternatives, selected by that one field.

### Repo declares `autonomy: auto-trunk` — the grant IS the go-ahead, re-verified every run

`CONVENTIONS.md` is explicit about what this grant means for a caller that is not a
person: a scheduler "may complete a trunk merge only where the repo has granted
`autonomy: auto-trunk`, and only through `colab ship`," subject to the identical gates
as any other caller, and "without … the grant, `ship` refuses and a human runs Phase B"
(`CONVENTIONS.md` [§*Scheduled drivers*](../../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person)).
`tools/README.md` says the same thing about the tool itself: `auto-trunk` is the *only*
value that enables `ship`, "the caller here need not be a human-opened session," and a
scheduled driver is "a legitimate caller of `ship`, subject to this identical gate and
no other." Neither description asks for a fresh per-run click on top of the grant — the
grant **is** the decision, made once by whoever set the field, and this skill's job on
a repo carrying it is to re-verify that decision still holds mechanically, not to go
looking for a second, human one that was never meant to exist per run.

So on a repo declaring `autonomy: auto-trunk`, this skill may complete B2 (the
trunk-merge step, and only that step) once every precondition elsewhere in this skill
has independently passed on its own terms: the hand-off contract (§0), CI green for the
exact sha (B1), the checklist/remainder check (B1b), no unresolved new migration
(`CONVENTIONS.md` [§*Migration exemption*](../../CONVENTIONS.md#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98)),
no unresolved hand-merge conflict (B0), no `--force`. No additional per-run human
instruction is required, and waiting for one that was never going to arrive is not
caution — it is the exact failure this issue was filed over: a fully green, fully
graded branch sitting unshipped because the coordinator held out for evidence the repo
already gave, once, in `project.yml`.

**This carve-out is scoped exactly to the trunk-merge step (B2) and nothing past it.**
It never authorises a promotion, a tag, or anything that deploys, on any repo, on any
tier — those stay human-only regardless of `autonomy`, with no field able to say
otherwise (`CONVENTIONS.md`, same section: "Never promotes and never tags, on any repo,
on any tier"). And it widens *who* may act once the gates are clear — it does not
loosen the gates themselves: a red trunk with no proven cure and no valid CI grant, an
unresolved new migration, an open checklist item with no declared remainder, or any
other precondition below failing is still a stop, exactly as it is for a human-triggered
ship.

### Repo does NOT declare `autonomy: auto-trunk` — a fresh, auditable go-ahead is required

Typing it into the session is the ordinary form, not the only one. A click in an
operator dashboard is a human decision too — provided the prompt that spawned you
carries evidence of *when* and *which* click, so the authorisation can be audited
afterwards instead of being asserted by the agent that benefits from it. The shape:

> `<operator>` triggered the merge via the dashboard Merge button at `<ts>`
> (intent `<id>`) — this click IS the human go-ahead for this skill.

Match on the **timestamp and the intent id**, not on the wording: those are the two
things a dashboard can write and an agent cannot invent, and they are what makes the
click auditable after the fact. Missing either, you hold a claim of authorisation
with nothing behind it — treat it as no go-ahead and ask. **Never compose that
sentence yourself**; a go-ahead you wrote is not a go-ahead you received.

This grants no latitude beyond the trunk-merge step either: no click of any kind
authorises a promotion, a tag, or anything that deploys.

## What a defer is for — and what it is never for (#257)

A coordinator once deferred a sound branch because the branch's originating session was
sitting at an interactive prompt with unsent text in its composer and the coordinator
could not deliver a message into it. Nothing about the diff was wrong; the deferral was
written up carefully and was still the wrong outcome, because **every step this skill
performs runs in the coordinator's own worktree** — B0's sync, B1's CI check, B2's
squash — and none of them contact the originating session at all. Declining a step this
skill assigns to you, on grounds that step never involves, is not caution; it is
inventing a stop condition.

- **Unsent or stranded text in the originating session's composer is an operational
  nuisance about a UI, never a fact about the work.** Neither is "the session did not
  answer", "the session is parked", or "I could not deliver a message into it." None of
  these produce a defer, ever.
- **A defer is reserved for a genuine blocker on the work**: a red or dead precondition
  the coordinator cannot itself clear (B1's CI gate), a real conflict needing the
  author's judgement (B0's non-generated-file conflict path), or a missing human gate
  (the go-ahead itself, `autonomy`, a `needs-decision` answer). If you cannot name which
  of these three a deferral is, it is not a deferral — go do the step.
- **The blast radius is never just this one branch.** A finish-before-start gate reads a
  session holding an unfinished worktree as a reason to refuse *new* starts across the
  whole repo — one wrongly deferred branch can make a large share of a ready backlog
  unstartable, and a comment on one issue is not a place a human looking at the backlog
  will ever see it. Clearing one such session by deferring it just moves the block to the
  next session in the same state; it resolves nothing.
- **A recorded deferral carries a clock, or it is indistinguishable from a defer nobody
  noticed.** Name the specific precondition, what would clear it, and an expiry or
  re-measure trigger — the event or time after which the branch is measured again rather
  than waiting for someone to ask. A blocker no agent may clear belongs on the
  handbook's existing human-watched surface, the `needs-decision` label
  (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), *Decision gate*) —
  triage already re-measures it every run and clears it on a recorded decision — plus
  your own report to whoever is operating you. An issue comment alone is a record, not a
  notification; reuse this existing machinery rather than inventing a second one.

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
here, and no step in this skill has ever run `gh issue close`. Measured: the claim was
released, the worktree torn down, and the issue stayed open until a human said in
prose that finishing with no commit was acceptable.

```sh
colab ship --worktree <name> --dry     # → MODE: evidence-close, if that is this branch
colab ship --worktree <name>           # posts evidence, CLOSES each issue, tears down
```

It merges nothing, pushes nothing, and writes no empty marker commit. It is gated on
each issue **already carrying a comment colab did not write** — so record what you
delivered on the Issue first (`code-wrap` A1 is where that happens anyway), or ship will
report the issue and leave it open. The zero-diff fact is measured from git; you do not
declare it.

⚠️ **This door needs a branch, so a `writes: direct` unit cannot walk through it.** #284
ruled that a trunk-direct unit still closes via evidence-close; measured during #285, it
cannot reach it — `ship` refuses with `ship needs --worktree or --branch` when given
neither (a direct unit has neither), and refuses `--branch <trunk>` with `--branch is the
trunk itself`, both before evidence-close is consulted. `colab solo --done` posts no
evidence and closes nothing. So a `direct` unit has **no close path today**; do not plan a
session around one. Tracked, together with whether the "comment colab did not write" gate
is even the right gate when a human's session-start instruction is the authorization, as
[#302](https://github.com/futurelastic/colab-handbook/issues/302).

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
a reason to stop here.

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

- **Non-empty** → real conflicts. Resolve them (generated files: regen below;
  anything else: read the region, see the incident in this file's history),
  `git add` the resolved paths, then commit explicitly — never `add -A` blind,
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

Re-run the gate (`code-wrap` A3) — a fresh-migrate test must pass, proving both branches'
migrations run clean together. *(Machine-specific reconcile — e.g. deduping a
migration against one already on trunk — hooks in here; the universal rule is
"regen on the merged base, never hand-merge generated files".)*

## B1. Verify CI on `<base>` is alive AND green — for the sha you are about to merge

**Ask by commit, not by recency** (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), #92). `gh run list --branch
<base> -L 1` reads whatever ran *last*, and under `cancel-in-progress` a cancelled
straggler can outrank a passing run on the *same* commit — deadlocking a ship that a
by-commit check would clear. Ask instead whether a completed, successful run exists
for `<base>`'s current head sha:

```sh
HEAD=$(git rev-parse origin/<base>)
gh run list --branch <base> --limit 20 --json headSha,conclusion \
  -q "[.[] | select(.headSha == \"$HEAD\" and .conclusion == \"success\")] | length"
```

Non-zero → a green run exists for the exact sha you are about to merge, which is the
only question that matters. `colab ship` asks it this same way.

A "failure" that never started (billing lockout, runner outage) still means
**stop** — we once merged for 12 hours into repos whose CI was silently dead
(`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)). Branch protection can't check this for us; this command must.

**What CI *is* follows whether the unit has a branch, how much it must catch follows
`exposure`** ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
— ⚖ #233 retired the `writes`-keyed reading this used to carry). With a branch — the
ordinary case, or an attended trunk-direct session falling back to full ceremony under
one of [§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s
two mandatory-branch conditions — CI here **is** the gate this merge depends on — a red
or missing run for the head sha stops the ship, full stop. `none`/`self` exposure
answers only to the room; `live`/`released` answers to a consumer with no way to ask a
clarifying question, so more has to be caught before it reaches them.

If `<base>` is a declared line with **no runs at all**, it is not yet CI-gated: check
`<trunk>` instead and say so in the report. That is a normal early state for a line,
not a green light — a line that *has* runs and is red still stops the ship.

## B1b. Harvest every issue the branch carried

B2 needs the **complete** set of issue numbers at the moment it writes the squash
message. Build the set here — after the merge is pushed you can no longer add a
missing `Closes` line without amending a commit that is already on trunk.

**Primary source — git. Always works, no CLI required:**

```sh
{ git log --format=%B origin/<trunk>..<branch> | grep -oE '#[0-9]+' | tr -d '#'
  printf '%s\n' "<branch>" | grep -oE '(-[0-9]+)+$' | tr -- '-' '\n'
} | grep -E '^[0-9]+$' | sort -un
```

Commit bodies carry `#N`; branch names carry **bare** trailing digits
(`fix/import-fixes-115-114-113`) — hence the two different extractions. Anchoring
the branch half to the trailing group is deliberate: a plain `[0-9]+` sweep turns
`feat/oauth2-login-88` into issues 2 and 88.

**On a trunk-direct unit with no branch — an attended solo-flow session, legal on any
repo without the veto (⚖ #233) — the branch-name half of this extraction is empty by
construction, not a finding.** There is no `<branch>` to read a trailing number from;
the commit-body `#N` on `<trunk>` is the only source harvest has, and it is enough
(`CONVENTIONS.md`, *Solo flow*). This is the same shape `code-sweep`'s `landed
trunk-direct: <sha>` outcome names from the sweep side.

**Optional cross-check — the claims registry, if `colab` is installed:**

```sh
colab claims --json    # filter .worktree == "<name>", or .repo for a trunk session
```

Claims live in `colab claims`, **not** on the worktree record — `colab worktrees
--json` has no `issues` field (verified 2026-07-20; the table's ISSUES column is
derived by filtering claims, so don't go looking for it in the JSON).

The two sources fail in **opposite** directions, which is the point of running
both: git catches an issue worked on but never claimed; the registry catches one
claimed but never mentioned in a commit. A number in one set and not the other is
a **finding** — chase it down, don't average it away.

**Verify by code, not by commit message.** A commit saying `#88` proves only that
someone typed `#88`. Grep trunk for the thing the issue actually describes — the
column, route, UI string, function:

```sh
git log --oneline --all --grep="#88"
grep -rn "<thing the issue describes>" <paths>
```

**Sort every number into one of three buckets — none may stay unsorted:**

| Bucket | Action |
|---|---|
| **Done** | `Closes #N` in B2; confirm it actually closed; evidence in B2b. |
| **Partial** | Close it **and** open a new linked issue for the remainder. |
| **Untouched** | Leave open, with the next step written into it. |

Never close a partial issue bare — that buries the open question where nobody
will find it again. Never leave it whole either — the next session reads an
untouched issue as untouched work and redoes what you already shipped. This is
the same failure mode as `(#N)`: issues sitting open with their code long since
merged (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).

**This sort is now MECHANICALLY checked, not honour-system (#74), and the check
now refuses the MERGE, not just the close (#263).** The incident that motivated
#74: an issue was closed by squash-merge with a third of its three-section
scope unimplemented — the sections were prose, so nothing could catch it.
#74's own fix — downgrading `Closes #N` to a silent `Refs #N` and shipping
anyway — turned out to still fail, just quietly: measured on one repo over
~8 weeks, 125 such downgrades against only 10 commits that ever declared a
remainder, so the redirect was reported but essentially never read. If the
issue's `## Plan` is a real GitHub checklist (`- [ ]` one line per
deliverable — CONVENTIONS.md [§4](../../CONVENTIONS.md#4-branches-and-commits), *Merging*),
`colab ship` parses it before composing the squash body and **refuses to
ship at all** for any claimed issue with an unticked box and no declared
remainder — a precondition row (`remainder declared for unticked issues`),
exactly like a red CI run, not a redirect that lets the ship proceed. Doing
B2 **by hand** (no `colab ship`, or a repo without `autonomy: auto-trunk`):
run the same check yourself before you write the commit message, and treat a
hit as a stop, not a note —

```sh
gh issue view $N --json body,comments -q '.body, (.comments[].body)' | grep -E '^\s*- \[[ ]\]|^Remainder: #'
```

any `- [ ]` line with no `Remainder: #M` anywhere in that output means **Partial**,
not **Done** — file the remainder issue and tick what shipped (B2b's evidence
template below) *before* you write `Closes #N`; do not squash-merge this issue
until you have. Ticking the remaining boxes, or an explicit, deliberate
`colab ship --refs $N`, both clear it too. A `## Plan` with no checkboxes at
all — written as prose — cannot be checked this way; that shape is itself a
finding, worth a line in the Issue, but it does not block the close (nothing
here can predate this convention and be held to it retroactively).

**Before filing the remainder issue, ask whether this half should ship at
all** (CONVENTIONS.md [§4](../../CONVENTIONS.md#4-branches-and-commits), *Is a shipped half actually
shippable?*) — **does the shipped half have its own oracle**, independent of
the unshipped remainder? If the only way to know it works is to finish the
other half first, declaring a remainder and shipping anyway is the wrong
move regardless of what the gate allows; leave the branch and finish it next
session instead.

## B1c. Grade the diff against the plan (#94)

Read the plan file, if one exists, from the **main checkout** — `$MAIN_REPO/.claude/plans/issue-<N>.md`
(`$MAIN_REPO` as resolved in §0, not `$PWD` — #113) per issue in the harvested set (B1b),
not the worktree, which may be mid-teardown by the time anything reads this:

```sh
cat "$MAIN_REPO/.claude/plans/issue-<N>.md" 2>/dev/null   # per issue that carried one
```

- **Plan file present** → grade the diff against its *Acceptance oracle* and *Files*
  sections.
- **No plan file** (rung 0, or a session that predates #94) → grade against the Issue's
  own stated ask — its `## Plan` checklist if it has one (B1b's per-item verdict already
  covers this shape), else its prose Goal.

Verdict is one of two, and it is a **judgement**, not a line-count — the same posture
B1b's per-item verdict already takes toward the checklist, applied here to the plan (or
ask) as a whole:

- **pass** — the diff satisfies the stated oracle, or the plan's own deviation note
  (`code-start`/`code-plan`, *Deviating from what you wrote*) explains why it does
  something different and that reason holds up. Proceed to B2; the verdict rides on
  B2b's evidence comment.
- **reject** — the diff does not satisfy the oracle, or drifts from the plan's Files
  list with no written reason anywhere in the plan file. **Do not merge, and do not
  proceed to B2 on this pass, whichever reject class below applies.** Post a comment on
  the issue naming specifically what falls short — not "does not match the plan," the
  actual gap, and carry a `<!-- colab:grade verdict=reject-decision round=<n> -->` or
  `verdict=reject-escalate round=<n>` marker per the classification below — same
  grammar and reading rule as B2b's `pass` marker (*The grade verdict is a marker, not
  a sentence to parse*). Every claim in the harvested set stays held; this is never an
  automatic revert of the branch and never a silent merge-anyway.

#### UI-affecting issues — also grade against the design artifact, when one exists (§5)

When the harvested set touches a UI surface and `docs/design/` carries an artifact
for it (`<slug>-<N>-mockup.html` / `<slug>-<N>-spec.md` — `CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
conclusions are three units, not two*), grade the diff against that artifact too,
alongside the plan's own oracle — not instead of it: a diff can satisfy the plan's
stated Files/oracle and still miss what the approved design actually specified.
The result folds into the **same** pass/reject verdict above — there is no separate
design-verdict token — and a mismatch classifies exactly like any other B1c gap:
`decision` by default, `escalate` only when the three conditions below all still
hold. Name the artifact file in the reject comment so the gap is findable, not
just "doesn't match the design."

No artifact under `docs/design/` for this surface, or the harvested set is not
UI-affecting → nothing new to check here; the plan/ask oracle above is still the
whole grade, exactly as before this clause.

### Reject classifies further — `decision` is the default, `escalate` is the narrow exception (#262)

A stop-for-a-human on *every* reject was measured to be the wrong default for the
common case: one fleet's cheap-tier lane spent 47 attempts — 35 of them rejects, all at
the *same* worker tier — on a single issue, because nothing forced a tier change once
that tier had been shown insufficient. A human wasn't blocking any of it; nothing was
routing around a tier that had already failed repeatedly. Waiting for a person bought
nothing there. So a reject is graded into exactly one of two classes, decided **at
grading time**, never guessed from a label alone:

- **`decision`** — the default, and everything not explicitly `escalate` below. The
  oracle itself looks wrong, the ask was ambiguous, the diff drifted from scope with no
  reason recorded in the plan file, or the change touches migration, promotion,
  security, money, or anything non-undoable. **A human resolves this — no exception,
  whatever any label says.** Behaviour is exactly what "reject" already meant above:
  comment, hold every claim, stop.
- **`escalate`** — narrow, and every condition below must hold, not just one:
  1. **The issue set carries the `mechanical-lane` label** (`code-triage`,
     *mechanical-lane*, #93). That label is the one in-repo signal that this work was
     dispatched below the fleet's default engine in the first place — which is what
     makes "a rung above exists" a fact this skill can read, not a guess it is making.
     No label on the harvested set → no `escalate` class, ever, regardless of 2 and 3.
  2. **The gap is a plain oracle-unmet**, not an oracle-is-wrong or scope-is-wrong
     finding — the diff genuinely attempted the stated task and the oracle genuinely
     still says no. Anything that reads as the oracle itself being the problem is
     `decision`, not this.
  3. **`reject-escalate` may only ever be emitted at `round=1`.** Read the issue's
     comments for a prior spend of the bound — **either** a `<!-- colab:grade
     verdict=reject-escalate ... -->` marker **or** the legacy
     `<!-- colab:reject escalate=1 -->` marker (#260 minted the former; every marker
     from before that change is the latter, and issue comments are immutable, so both
     forms exist in history permanently — read the union of the two, always, not just
     the current one). If either is already present, this reject is `decision`, full
     stop, regardless of 1 and 2 — one automatic escalation per issue set, ever. A
     second reject after that spent escalation is exactly the case a human is for.

  On `escalate`: post the same specific-gap comment `reject` always requires, with the
  `<!-- colab:grade verdict=reject-escalate round=1 -->` marker — this marker *is* the
  one-time bound now; nothing else needs to be written to record it, and condition 3
  above is how a later pass reads whether it was spent. Leave the claim held and the
  worktree in place, same as `decision` — do not tear down, do not release, do not
  merge. **This skill does not itself pick or dispatch the next rung** — which engine
  backs it, and how it is invoked, is per-fleet and deliberately out of this skill's
  scope, the same posture `mechanical-lane` itself already takes (`code-triage`).
  Report the escalation instead of a hard stop; whatever routes this fleet's mechanical
  lane (or a human, absent one) picks up the still-held claim and re-attempts, carrying
  this reject comment as that attempt's context. Re-attempting at the *same* tier with
  nobody having checked for the marker first is precisely the failure this section
  exists to close off — checking condition 3 above is not optional bookkeeping, it is
  the cap.

A rejected grade — either class — ends this skill's run for that issue set: nothing
past B1c executes on this pass. What differs is what happens next: `decision` waits on
a human who has seen the comment and said what happens next, same as before this
section existed; `escalate` waits on the one bounded automatic retry the marker
records, and falls back to waiting on a human the moment that retry rejects too.

## B2. Squash-merge with `Closes #N`

```sh
git checkout <base> && git pull
git merge --squash <branch>
git commit    # subject: type(scope): …  · body: Closes #N   (one line per issue in the group)
git push origin <base>
```

**`<base>`, every line of it.** If `<base>` is a declared line rather than trunk, the
main checkout must not be parked on it to do this — use `colab ship`, which merges in
an ephemeral worktree, or make one yourself. The at-rest invariant does not pause for
a merge. And merging that **line into trunk** afterwards is never part of a ship: it
is a human integration event of a promotion's weight.

- **`Closes #N`, not a bare `(#N)`** — GitHub only auto-closes on the keyword. We
  measured 26/30 issues left open with their code long merged because commits
  said `(#N)` (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).
- One `Closes #N` per issue the branch carried — the set you harvested in B1b, not
  just the "main" one.
- **This step never runs against the will of B1b's close gate.** If any harvested
  issue has an unticked `## Plan` box with no declared remainder, `colab ship` has
  already refused before reaching this step (#263, B1b above) — do not hand-write
  `Closes #N` around that refusal; resolve it the way B1b describes, then re-run.
- **A long-lived tracking/memory issue is `Refs #N`, not `Closes #N`.** If the branch
  claimed an issue used as external memory for a whole domain — a checklist of still-open
  items you touched but did not complete — reference it, don't close it, or you bury its
  knowledge behind a closed-issue lookup (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#tracking-issues--claimed-but-referenced-not-closed), *Tracking issues*). Through
  the blessed door this is automatic for an issue carrying the `tracking` label, or opt in
  per-ship with `colab ship --refs <N>`; the claim is still released either way.
- *(Machine-specific automation — migrate the trunk DB, restart the trunk dev
  server — hooks in here: `.colab/hooks/`. It is the one moment trunk may go down;
  keep the window short.)*

## B2b. Post evidence on EVERY issue — including the auto-closed ones

**`ceremony: light` repo? Skip this whole step.** The squash's `Closes #N` is the
record; there is no evidence comment to post (project.schema.md#ceremony--optional).
Everything below applies only on `standard` (the default — absent `ceremony:` key).

`Closes #N` closes the issue the instant trunk is pushed: silently, with nothing
attached. So the best-evidenced rule in the handbook is exactly the one that skips
the evidence step — the issue goes green and no one ever records *what* shipped.

**Comment evidence on every issue the branch carried, whether it auto-closed or you
closed it by hand.** This runs **after** the merge, because the sha you cite must be
the **trunk squash sha** — the branch sha is gone once the branch is deleted (a
squash leaves no merge relation, which is why deleting the branch needs
`git branch -D`, not `-d`).

Evidence is three parts: **the `<base>` squash sha · `file:line` · what you checked and
what came back.** When `<base>` is a declared line, say so in the comment: that code is
**not in trunk yet**, and an evidence comment that implies otherwise will be read as
"this is in the next release".

**An issue with a real `## Plan` checklist gets a per-item verdict, not one prose
paragraph (#74).** One line per box: shipped-with-evidence (the `file:line` that proves
it), or moved to `#M` (the remainder issue). A single paragraph summarising "did the
whole thing" is exactly the shape that let a partially-done issue close silently in the
first place — a reader auditing later cannot tell which box a general paragraph actually
covers.

**Carry B1c's grade verdict here too — one line of prose, plus the machine-readable
marker (#260).** `Grade: pass — <what confirmed it>` for a plan/ask that was satisfied.
A `reject` never reaches this step at all (B1c stopped before B2); if you are here, the
verdict is `pass` by construction, but say what confirmed it so the record does not read
as a bare rubber stamp. Add a `<!-- colab:grade verdict=pass round=<n> -->` line
immediately after the `colab:evidence` marker — see *The grade verdict is a marker, not
a sentence to parse* below for the full contract.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
Grade: pass — diff matches the plan's Files list and the payroll fixture in the oracle
confirms the double-count is gone.
- [x] add the overtime_rate column — \`app/Models/Payroll.php:142\`; ran the payroll
      fixture for a 25%-overtime employee, the premium now applies once, not twice.
- [x] backfill existing rows — \`database/migrations/2026_08_01_backfill.php\`; ran
      against a copy of prod data, 0 rows left at the old rate.
- [ ] moved to #91 — the reporting-UI column was out of scope for this branch."
```

**UI-affecting issues additionally require a screenshot of the BUILT app**, not a DOM
assertion and not a static mockup with tokens redefined to match the design system —
both are blind to the real rendering cascade (measured 2026-08-01: a component passed
every token-level assertion and still rendered wrong once actually built, because the
mockup never went through the app's real CSS cascade). Run the app (`/run` skill),
screenshot the changed surface, attach it to the evidence comment.

**Prepend one invisible marker line** — a stable, machine-readable first line, exactly
the pattern the claim comments already use (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#rules) *Rules*: a stable first
line as wire format, everything after it human). It names the trunk sha the comment
attests, so an external consumer (a closure-review view on a fleet dashboard, say) can
find and verify the evidence comment without heuristics — "first comment after merge
by the closing actor" is brittle; a stable marker is not.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
\`app/Models/Payroll.php:142\` — added the \`overtime_rate\` column.
Checked: ran the payroll fixture for a 25%-overtime employee; the premium is now
applied once, not twice — the double-count this issue reported is gone."
```

**Degrade, never gate.** The marker is an upgrade to an already-required comment, never
a new requirement of its own: a comment missing it (an older ship, a hand-written one)
still counts as evidence and must never be treated as absent by anything reading these
comments. Everything after the marker line stays free prose — **not** a structured
evidence format. A schema with fields invites padding (a 3-line honest comment becomes
a 15-line template of restated obviousness); the marker's whole job is being findable,
not being complete. A comment may carry both markers; a reader matches each by its own
name, never by line position, so their order in the body is never load-bearing.

### The grade verdict is a marker, not a sentence to parse (#260)

Free prose was measured to fail two ways at once, on two independently written adopter
parsers: a decorative emoji before a prose heading blanked one consumer's match
entirely, while the other's `PASS\b`-shaped tail pattern read a held, qualified verdict
(`PASS-WITH-NOTES`) as cleared. Opposite failures from the same root cause — there was no
fixed shape to parse in the first place. So the verdict is a **closed vocabulary in a
fixed marker**, and the prose next to it is decoration a consumer never has to touch:

```
<!-- colab:grade verdict=<token> round=<n> -->
```

- **Exactly three tokens are ever emitted here**: `pass` (B2b, this section) ·
  `reject-decision` · `reject-escalate` (both B1c, on the reject comment — see B1c
  below). No token is a prefix of another and none is a decorated variant of another —
  a qualified outcome is a different whole token, never `pass` with a suffix. Free prose
  around the marker (a heading, an emoji, "held one round") is exactly that: prose. It
  can say anything; it changes what no consumer reads.
- **`round=<n>`** is the 1-based grading attempt for the harvested issue set — count
  prior `colab:grade` markers on these issues and add one.
- **Reading rule, so two adopters written independently agree:** match the marker
  anywhere in the comment body, never by heading text or line position. Compare the
  `verdict` token by **equality**, never by prefix or substring. Four states follow:
  **cleared** (token is exactly `pass`) · **held** (a recognised non-`pass` token) ·
  **unrecognised** (marker present, token not in the reader's set) · **absent** (no
  marker at all). Unrecognised and absent both mean "do not treat this as cleared" —
  never a silent default to the safe-looking value. Absent is not a failure either
  (*Degrade, never gate*, above): an older ship, a hand-written comment, or a
  `ceremony: light` repo carries no marker and that is not evidence of anything wrong.
- **An adopter needing an outcome this skill doesn't emit mints its own whole token**
  (e.g. `hold`) rather than qualifying an existing one — because *unrecognised* is
  defined as never-cleared, a new token is safe by construction at every consumer that
  hasn't been taught it yet. The handbook constrains its own emission and the reading
  rule; it does not police what an adopter's own tooling chooses to add.

**Not evidence:** quoting your own commit message · restating the ticked checklist ·
"done in `feat/x-23`". All three assert the work happened; none show it did.

**Made a significant design decision mid-work, without a pre-approved spec?** Add
`design-not-preapproved` as plain text in the same comment, after the marker line
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), *Design ruling*). Not a second marker — the marker's job is being
findable, not enumerating every condition a comment might report — just a word a human
reviewer greps for:

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
design-not-preapproved — the spec did not cover the empty-state illustration; chose one
consistent with the existing icon set. Flagging for review.
\`app/Views/EmptyState.tsx:12\` — added the illustration and copy."
```

This is the human-review path for a design decision the `needs-decision` gate did not
catch because nobody could have: the surface did not look significant until someone was
already building it. The session does not stop to request a ruling first — it continues
on the designer's spec and lets the evidence comment carry the flag instead.

## B2c. Update the parent epic — if, and only if, it is hand-maintained

`code-triage` instructs its readers to **trust the epic's checklist table over its
title**, on the grounds that only the table is maintained. Nothing in this family
maintained it. Measured across one repo in one day: one epic stayed correct purely
because the operator happened to remember it existed through four consecutive merges,
while a second — that nobody remembered — held two lines wrong in *opposite*
directions: one claiming a branch that no longer existed, one ticked but annotated
"held open for review" on an issue already closed. A document that says "trust X"
while nothing updates X does not fail neutrally; it produces confidently wrong plans.

**First ask which kind of parent it is**, because #34's mechanism removed most of
this work rather than adding to it:

```sh
gh issue view $N --json parent -q '.parent.number // "none"'
```

- **A native parent (sub-issue link)** → **do nothing.** GitHub maintains
  `subIssuesSummary` itself; the child closing *is* the update. Ticking a checklist
  line here would be inventing a second, hand-run source of truth beside a correct
  automatic one.
- **No native parent** → look for a hand-written checklist that references this issue:

```sh
gh issue list --state open --search "#$N in:body" --json number,title
```

For each open parent whose body has a **checklist line** containing `#$N`, tick that
one line and record the trunk sha beside it. Prefer converting the epic to native
sub-issues if the owner wants it — then this step stops applying forever.

**Four things not to do** — each is a way this step turns destructive:

1. **Never close the epic**, even when the last box ticks. Boxes running out does not
   mean work running out: an epic can have two phases complete and two whose issues
   are not written yet. Closing it buries the unwritten part.
2. **Never rewrite the epic's prose.** Edit the one checklist line for the issue that
   just closed. The body is where the owner records decisions; a skill has no business
   editing there.
3. **No checklist, no action.** Do not create a table the repo did not choose.
4. **Never infer parentage from a title.** Accept it only from a native `parent` link,
   or from a literal `#$N` on a checklist line. Prose that merely mentions `#$N`
   ("related to #$N", "unlike #$N") is **not** a checklist line and must not be edited.

   A checklist line is `- [ ]` or `- [x]` — **a bullet is not a checklist**:

   ```sh
   grep -nE '^\s*-\s*\[[ x]\].*#'"$N"      # a hit here may be ticked; anything else may not
   ```

   This is not hypothetical. The issue that asked for this step lists its own related
   work as `- **#28** (…)` — a bullet, matching any loose "list line mentioning #N"
   rule, and editing it would tick a line that tracks nothing. Verified against that
   body: the anchored pattern rejects it, a `-.*#N` pattern accepts it.

## B2d. Tear down a spent `group:<key>` label (#82)

**`colab ship` does this for you** — its B4 unions the `group:` labels the branch's
issues carried and, per label, checks whether any issue anywhere still carries it
**open**. None left → the label OBJECT is deleted (`gh label delete`); one still open
→ left exactly as it was, because it still binds the remainder. Nothing here to do on
that path — it runs automatically, after the evidence comments in B2b.

**Only if `colab` isn't available in this repo** (no `tools/colab` to run `colab
ship` with — a repo lacking `autonomy: auto-trunk` still has the tool, a human just
triggers it instead of the tool running unattended), do the equivalent yourself,
once B2 has pushed:

```sh
for GL in $(gh issue view $N --json labels -q '.labels[].name' | grep '^group:'); do
  gh issue list --label "$GL" --state open --json number -q length \
    | grep -qx 0 && gh label delete "$GL" --yes
done
```

Only `group:*` labels are ever in scope — never `in-progress`, `deps-checked`,
`agent-filed`, `needs-plan`, or `epic`. Deleting the label does not erase the record:
the closed issues' timelines still show it was applied, and each member's `Because:`
comment (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*) is the durable evidence of *why*, independent
of whether the label object survives.

## B3. Release the claim(s)

```sh
colab release $N        # if colab is installed …
gh issue edit $N --remove-label in-progress    # … else raw, one per issue
```

Release **every** issue in the group, even ones you didn't finish — a stale claim
silently blocks others (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this)).

**No exceptions — not "unless unfinished", not "unless the worktree stays".**
`code-start` adds the claim, this skill removes it: symmetric and unconditional.
Because:

- A conditional release rule is one agents skip. The unconditional one is the one
  that actually gets executed.
- A claim is scoped to a **session**. Once the session ends it names a holder who
  no longer exists.
- Nothing ages a claim out. A kept-but-forgotten worktree would hold its issues
  indefinitely and **no health check flags it** — the worktree is alive, so the
  claim looks healthy.
- Re-claiming next session is one command already in the `code-start` flow. The cost
  of releasing is near zero; the cost of a stale claim is someone else blocked.

*Tradeoff, chosen deliberately:* releasing gives up the lock that stopped a second
session starting a colliding branch on a kept worktree. That protection now rests
on the **session-start check** — before starting, verify whether the work already
exists (`git log --grep`, grep the code, and look for an existing branch or
worktree for that issue) rather than trusting the absence of a label. `code-start`
already says *open ≠ untouched*; this is why.

**A `reject` verdict from B1c never reaches this step** — the claim stays held either
way: until a human resolves a `decision`-class rejection, or until the one bounded
auto-retry an `escalate`-class rejection recorded lands (and reverts to the same
human-held state if that retry rejects too, B1c's *Reject classifies further*). Either
class is the whole point of stopping at B1c rather than merging past it.

## B4. Tear down the worktree — remove by DEFAULT

Made a worktree? **Remove it.** Finished-but-not-removed worktrees are the single
most-skipped step we measured (8 of 9 sessions, 2.9 GB) — and the permissive
"(optional)" this step used to open with is what produced that miss rate. Removal
is the default path; keeping one is the exception you must justify.

```sh
colab worktree rm <name>    # if colab is installed (releases its claims, frees its ports) …
git worktree remove <path>  # … else raw git
```

**The raw fallback is not equivalent — it only deletes the directory.** `colab
worktree rm` does four things: removes the directory, drops the worktree record from
`state.json`, frees the ports the record owned, and releases the issue claim(s) it
carried. Raw `git worktree remove` does the first and nothing else — the record
survives with `status: "running"`, still holding its ports, and any tool reading
`colab worktrees` reports it as live work in progress long after the checkout is
gone. Taking this path (no `colab` on this machine) means finishing the other three
by hand, on the machine that holds `state.json`: release each claim
(`gh issue edit <N> --remove-label in-progress`) and have that machine prune the
stale record — `colab` has no unattended flag for this, so say so in your report
rather than leaving it silently wrong.

`colab worktree rm` runs the repo's `.colab/hooks/pre-remove` (e.g. dropping a
cloned DB) and refuses if there's uncommitted work — tracked changes **or**
untracked, non-ignored files. Untracked counts because it is the only category
with no copy anywhere else: not in the index, not in a commit, not on the remote.
Ignored files (build output, a copied `.env`) never block.

**It also refuses when the worktree still owns running processes** — anything
whose cwd is inside it, typically the dev server you started. That is not an
obstacle to route around: remove the tree underneath a live server and it keeps
listening on a port the registry now calls free, serving a checkout that no
longer exists. Stop the server and re-run, or pass `--force` to have `colab`
terminate what it owns. Ownership is decided by cwd, never by port, so `--force`
cannot reach an unrelated process that merely holds the same port.

**Keep it only for a named reason,** and write the reason in your report — never
leave one standing silently:

- the group branch still has unfinished issues,
- a human just told you to keep working in it,
- teardown is blocked by uncommitted work (tracked or untracked).

> **If you keep it, release its claims by hand.** `colab worktree rm` is *what*
> releases claims — skip the removal and that automatic path never runs, so B3
> did not happen for you. Do it explicitly:
> ```sh
> colab release <N>                              # … or, without colab:
> gh issue edit <N> --remove-label in-progress
> ```
> B3 is unconditional: a kept worktree changes **who runs** the release, never
> **whether** it runs.

### Delete the plan file and journal its usage, in the same breath (#94)

**`colab ship` does this for you** — per issue in the harvested set (B1b), it appends
one line to `~/.colab/plan-journal.jsonl` (rung/cause read from the plan file's own
front matter, verdict always `pass` — a `reject` never reaches this far) and only then
deletes the plan file, chained so a failed journal write leaves it in place. This used
to be a step only this shell snippet performed (#115: verified zero matches for
`plan-journal`/`plans/issue-` in `tools/colab` before that fix), so a ship driven
through the tool alone left the plan file on disk with no journal line — that gap is
closed; nothing here to do on that path.

**Only if `colab` isn't available in this repo** (no `tools/colab` to run `colab
ship` with — a repo lacking `autonomy: auto-trunk` still has the tool, a human just
triggers it instead of the tool running unattended), do the equivalent yourself —
resolved by **file, tested against the
harvested set**, never by reconstructing `issue-$N.md` from one number at a time
(#201's fix in `tools/colab`'s `shipJournalPlanFiles`, mirrored here rather than
re-derived: a group session's plan file is named for the whole set,
`issue-<A>-<B>-<C>.md`, so guessing the name from a single member number misses on
every one of them — the loop completes silently, indistinguishable from the
legitimate rung-0 "never had a plan" case). Check the main checkout, not the
worktree, which this step may already be removing. `$MAIN_REPO` is `§0`'s resolved
absolute path; re-derive it here if this step runs in a fresh shell that no longer
has it (#113):

```sh
MAIN_REPO="${MAIN_REPO:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"
ISSUES="<harvested issue numbers, space-separated>"
GRADE_VERDICT=pass   # only a `pass` reaches B4 by construction (B1c stops a reject before
                      # this step); use the same token B2b's marker emits, never a bare word
for PLAN in "$MAIN_REPO"/.claude/plans/issue-*.md; do
  [ -f "$PLAN" ] || continue
  NUMS=$(basename "$PLAN" .md); NUMS=${NUMS#issue-}   # e.g. "12-14-15"
  SUBSET=1
  for N in $(echo "$NUMS" | tr '-' ' '); do
    case " $ISSUES " in *" $N "*) ;; *) SUBSET=0; break;; esac
  done
  [ "$SUBSET" = 1 ] || continue   # not a subset — leave it untouched (#201): a partial
                                  # overlap may be another session's live plan, or a
                                  # wider group's file this ship only carries part of
  RUNG=$(sed -n 's/^rung: *//p' "$PLAN" | head -1)
  CAUSE=$(sed -n 's/^cause: *//p' "$PLAN" | head -1)
  mkdir -p "$(dirname ~/.colab/plan-journal.jsonl)"
  python3 -c '
import json, sys, datetime
nums, rung, cause, verdict, out = sys.argv[1:6]
ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
with open(out, "a") as f:
    for n in nums.split("-"):
        f.write(json.dumps({
            "ts": ts, "issue": int(n), "rung": rung, "cause": cause, "verdict": verdict,
        }) + "\n")
' "$NUMS" "${RUNG:-1}" "${CAUSE:-none}" "$GRADE_VERDICT" ~/.colab/plan-journal.jsonl \
    && rm -f "$PLAN"
done
```

- **Machine-local, never the tracker.** `~/.colab/plan-journal.jsonl` never leaves this
  machine and is never committed — it is not a second source of truth about the feature,
  only a record of how the planning mechanism itself is being used.
- **One line per issue in the file's own number set**, not one per branch and not one
  per file — a group branch can carry several issues behind one shared plan file, and
  rung/cause are read from that file once and reused for every line it contributes,
  since a shared plan file has one front matter, not one per issue.
- **A file matches only when its whole number set is a subset of the harvested
  issues.** No overlap means it belongs to unrelated work; a *partial* overlap still
  means leave it alone — it may be another session's live plan, or a wider group's
  file of which this ship only carries part. Acting on a partial match would journal
  and delete a plan another session is still using.
- **This is the one moment everything about the plan's life is known**: rung, cause
  (flagged vs self-escalated), and B1c's grade verdict. Weeks of this file answer rung
  frequencies, flag precision (flagged but the diff graded clean with no friction?), and
  flag recall (unflagged but a mid-session escalation caught it?) — the evidence to tune
  or retire the `needs-plan` mechanism. Nothing reads it automatically; a human greps it.
- **Delete only after the journal line(s) land, and chain it — never split across
  statements.** The append and the `rm` are one `&&`-joined command, not two lines, because
  a compose that fails silently (wrong interpreter, a bad argument) must not let control
  reach the delete. This is `python3`, not `jq`, on purpose (#96): `jq` was pulled in for
  this one line and appears nowhere else this skill family actually depends on, while
  `python3` is already an assumed interpreter elsewhere (`code-sweep` §1's worktree-filter
  snippets) — so this removes an undeclared dependency rather than adding one more thing
  every machine running this skill must have installed. Measured failure mode this
  replaces: `jq` missing → the old `$(jq …)` command substitution failed, `printf` still
  wrote a bare newline (exit 0) into the journal, and the un-chained `rm -f "$PLAN"` on the
  next line still ran — the plan file was gone with no journal line to show for it.
- **Chained per FILE, not per issue** — every line a file contributes is written in the
  one append, and the delete follows only on success, so a failed write for one plan
  file leaves that file in place without touching siblings already journalled.
- **Delete only after the journal line lands**, and a harvested set with no matching
  file at all is a silent no-op here — a rung-0 session never had one, and this loop
  skips it correctly.

## B5. The release ritual — a SEPARATE act, and not yours

Merging to trunk is **not** a release. What comes next follows
[`exposure`](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here) — read the
legacy `tier` value the same way when that is all a repo declares (`A → released`,
`C → live`, `B → null`):

- **`released`** — the tag is what ships it, human-only, per `CONVENTIONS.md` [§6](../../CONVENTIONS.md#6-releases).
  Two shapes, decided by `<trunk>`, never by the legacy tier letter: `<trunk>: dev` (the
  ordinary two-branch case) is promotion `dev` → `main` (`--no-ff`, never squash)
  plus a `v*.*.*` tag; `<trunk>: main` (single-trunk, tag-gated — this repo's own
  shape) has no promotion at all — the release is just the tag on `main`.
- **`live`** — the promotion `dev` → `main` **is** the deploy, and is therefore the
  most consequential act in this file that an agent must never do unattended, not
  the least (`CLAUDE.md`).
- **`none` / `self`** — there is no release ritual to be separate from; B2's squash
  to `<base>` is the whole act.

If you believe a release is overdue (a production fix is merged but unreleased), say
so explicitly in your report; do not perform it.

---

## Verify complete

- The hand-off contract was **verified**, not assumed — each item re-derived from git
  or GitHub, any gap fixed or escalated before continuing.
- B1c's grade verdict is recorded — `pass`, carried into B2b's evidence comment as a
  `<!-- colab:grade verdict=pass round=<n> -->` marker, or `reject-decision`/
  `reject-escalate`, marked the same way on the reject comment, with nothing past it
  executed for that issue set on this pass.
- `gh issue view $N`: checklist ticked (inherited from `code-wrap`), and now closed
  with evidence, or left open with the next step written into it.
- Every issue the branch carried (B1b's harvested set) is either closed with evidence,
  split into a new issue for the leftover, or left open with a written reason. No number
  left dangling.
- Every one of those issues has an evidence comment — **including the ones `Closes #N`
  auto-closed**, which attach nothing on their own.
- `git log --oneline -5 <base>` shows the squash-merge; **every** claim released
  (unconditionally, finished or not) — unless B1c rejected, in which case every claim in
  that set is still, correctly, held.
- Worktree removed — or kept with the reason written in your report and its claims
  released by hand.
- Every plan file in the harvested set is gone, and the journal line for it landed first.
- **Your report names the branch you merged into.** Not "merged" — merged *into what*.
  It is the difference between shipped-to-trunk and parked-on-a-line, and only one of
  those is on its way to users.
