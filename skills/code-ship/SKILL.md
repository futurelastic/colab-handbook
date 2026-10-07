---
name: code-ship
description: "Close the COORDINATOR half of a coding session, authorized: verify code-wrap's hand-off contract, grade the diff against the session's plan (or the Issue's stated ask), verify trunk CI is alive and green, harvest every issue the branch carried, squash-merge with Closes #N, post evidence on each issue (including the grade verdict), release every claim, tear the worktree down — and, if a plan file existed, journal one line about its usage and delete it. The release ritual — promotion plus tag on exposure: released, or the promotion itself on exposure: live — is a separate thing, never bundled in, and never authorized by anything below regardless of autonomy. Trigger phrases: 'ship it', 'merge to trunk', 'merge it', 'update the issue and merge'. Runs after code-wrap: on a repo without `autonomy: auto-trunk`, only once a human says go (or once `colab ship` itself measures the change docs-only, #345) — a dashboard Merge click counts, an agent's own say-so never does; on a repo declaring that grant, the grant itself is the standing go-ahead for the trunk-merge step, re-verified against this skill's own mechanical gates every run."
---

# code-ship — merge a wrapped session: verify hand-off → grade → CI → squash → evidence → release → teardown

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/code-ship.md 2>/dev/null || echo "(no local policy for code-ship in this repo)"`

If `.colab/skills/code-ship.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

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


**How this file is built (#524).** This is the core: the steps in order, each with its rule
and its stop condition, and the commands and tables a run executes. Each step's full text —
edge cases, the measurements behind them, worked examples — sits in a reference file next to
this one, moved there verbatim, and the step names it. **Read a step's reference file before
you act on that step**; the line here is an index to it, never a substitute. Where they seem
to differ, the reference file holds the full rule.

## Principle

**A trunk merge is authorized, never inferred; a release is never this skill's act.**
Authorization comes from a human — either directly, per run, or once, standing, through a
grant the repo's own `project.yml` declares; see *What counts as "a human said go"*,
below, for the two shapes it takes depending on whether the repo carries
`autonomy: auto-trunk`. Do not open a PR, push trunk, promote to `main`, or tag on your
own initiative; **no authorization of either shape ever covers those** — both are scoped
to the trunk-merge step (B2) alone, on every tier, with no field able to say otherwise.
One PR is not initiative but the price of a proof: at a red trunk, the branch **carrying
the fix** may need one to obtain the branch CI the cure rule measures — that branch only,
never a bystander (B1, *Red trunk*).
Tagging is not this skill's under any rule: whether a tag may be cut without a human at
all is [`CONVENTIONS.md` §6's release rung](../../CONVENTIONS.md#6-releases) (automatic
candidates; a final tag automatic only where nothing deploys from it) — a separate act by
a release skill in a coordinator session, never a step of this one.


## 0. Verify the hand-off contract — don't trust the report, re-derive it

**Rule:** re-check what `code-wrap` asserted, from git and GitHub, with `$MAIN_REPO` anchored
to the main checkout: branch on the remote, a distill comment newer than the head (a
`↩️ Sent back` or a bare `— <name>` line is not one, #517), claims still held, the plan file,
a clean trunk checkout, and the gate verdict (a branch-CI run id at the current head on a
`gate: authoritative: ci` repo; otherwise a claim carrying the hermetic verdict). "Fix the
gap" is exactly two mechanical acts — push a wrapped head unchanged, re-claim a released
claim. Everything else is a **send-back**: one `↩️ Sent back — <gap>` Issue comment, once per
head. The coordinator never edits source, amends, force-pushes or re-runs the implementer's gate.
**Stop:** any gap that is not one of the two mechanical fixes ⇒ send back, report it, stop on
this candidate. Never merge past an unattributed dirty trunk.
Full text: [0-handoff-contract.md](0-handoff-contract.md).

## What counts as "a human said go"

**Rule:** the repo's `autonomy:` field picks the door. `autonomy: auto-trunk` ⇒ the grant is
the go-ahead for the trunk merge (B2) once every gate below passes on its own terms.
Otherwise ⇒ a fresh human go-ahead — typed in the session, or a dashboard click carrying a
timestamp **and** an intent id — unless `colab ship --dry` itself reports the change
docs-only (#345). Without either, `colab ship` refuses an agent: hand the human the command
its refusal prints, and they run it through the human door (#525). Never set the `COLAB_HUMAN`
flag on a go-ahead's strength. Never compose a go-ahead yourself. No door ever covers a promotion,
a tag or anything that deploys.
Full text: [go-ahead.md](go-ahead.md).

## What a defer is for — and what it is never for (#257)

**Rule:** a defer is only for a genuine blocker on the work — a red or dead precondition the
coordinator cannot clear, a conflict needing the author's judgement, or a missing human gate.
The originating session's state (stranded composer text, silence, parked) is never one; the
order of same-file siblings is mechanical, never a human gate. A recorded defer names the
precondition, what clears it, and a re-measure trigger; a landed gate fix re-measures every park.
Full text: [defer.md](defer.md).

## B0. Is there still cargo? Then sync `<base>` into the branch

**Rule:** know `<base>` (trunk, or the recorded `integration:` line). Grep `<base>` for
`close[sd]?|fix(e[sd])?|resolve[sd]? #N` per carried issue — shipped already ⇒ no grade, no
merge, go to B2b–B4. `colab landed --worktree <name>`: `cargo`/`unknown` ⇒ continue;
`landed` ⇒ B2b–B4; zero commits ⇒ `colab ship` evidence-close; a trunk-direct unit ⇒
`colab ship --direct`. Then `git merge origin/<base>`, check `git diff --name-only
--diff-filter=U`: generated file ⇒ trunk's side and regen; purely mechanical (a retired shared
file ⇒ trunk's side; an append-only ledger ⇒ the union) ⇒ resolve; needs judgement ⇒ `git merge
--abort` and send back. Merge only `<base>`, never a sibling's branch.
Assert `git diff --stat origin/<base> HEAD` shows only this branch's files, then gate the sync
commit (push and read branch CI where it exists).
**Stop:** a merge that failed with zero conflicted paths never ran — do not commit it.
Full text: [b0-sync.md](b0-sync.md).

### Batch landing — several ready candidates, one combined run (#373)

**Rule:** only where `project.yml` declares `ship-batch: <N>` > 1. Each member passes §0–B1c on
its own; then `colab ship --batch <b1>,<b2>[,…]` replaces B0's sync and B1a's post-sync re-run.
Exit `3` paused (bounded wait, same command again) · `0` landed (go to B2b) · `4` declined,
ship serially. A red trunk declines a batch outright.
Read when the repo declares `ship-batch`: [b0-batch-landing.md](b0-batch-landing.md).

## B1. Verify CI on `<base>` is alive AND green — for the sha you are about to merge

**Rule:** ask by commit, not by recency — `colab trunk-ci` (trunk) or `colab ship --dry
--json`'s CI row (any `<base>`); `GREEN` means every workflow's newest run at that sha
succeeded. A failure that never started still means stop. A declared line with no runs at
all ⇒ check `<trunk>` and say so.
**Stop:** red or missing for the head sha ⇒ no ship, unless a door opens (below).
Full text: [b1-base-ci.md](b1-base-ci.md).

### Red trunk — first ask "is the red real?", then "is this branch the patch?" (#353, #354)

**Rule:** classify the red first (`red:infra` ⇒ one re-run, keyed on `attempt` 1, after
cancelling a queued same-sha duplicate; same-minute deaths on several runners ⇒ check the host
first; a repeat ⇒ `TRUNK RED:` or ops; `red:finding` ⇒ it needs a `TRUNK RED:` issue and a patch). Only the branch **carrying the fix** goes first, may sync
onto the red, and may open a PR (or dispatch a dry run / `workflow_dispatch`) to obtain the
evidence the cure rule reads; a bystander waits for green trunk and records a defer. Not
sure ⇒ bystander. `ci-grant: reviewer` lets you mint a reviewer grant for the patch only.
Read when `<base>` is red: [b1-red-trunk.md](b1-red-trunk.md).

### B1a. Now read the BRANCH's CI too — beside `<base>`'s, not instead of it

**Rule:** re-derive the branch's class at its current head — `green` · `none` · `red:infra` ·
`red:finding` — never take `code-wrap` A5's word. `green` ⇒ B1b; `none` in flight ⇒
`colab ci-wait --sha "$BHEAD" --branch <branch>` (deadline = the repo's measured CI bound, #559), then defer; `none` that cannot
arrive ⇒ proceed, and B2a reads trunk after the merge; `red:infra` ⇒ one re-run, twice ⇒ ops
lane; `red:finding` ⇒ send back. `colab ci-wait` is the only way to wait for CI. A green class
on a head lacking `<base>`'s tip is `stale-base`: sync, push, re-read.
**Stop:** `ci-wait` exit 4 (`RATE_LIMITED`) stops the pass; a capped wait ends this
candidate's turn as a defer.
Full text, with the exit-code table and the infra-vs-finding test: [b1a-branch-ci.md](b1a-branch-ci.md).

## B1b. Harvest every issue the branch carried

**Rule:** build the complete issue set before the squash: `#N` from commit bodies plus the
branch name's **trailing** digit group, cross-checked against `colab claims` — a number in one
source only is a finding. Verify by code, not by commit message. Sort each into Done
(`Closes #N`) · Partial (close + remainder issue) · Untouched (leave open, next step written).
An unticked `## Plan` box with no `Remainder: #M` makes `colab ship` refuse the merge; a
`--refs` keep-open needs its hold in the same step, and a person-only check closes and becomes
a `Human verify:` row (#491).
**Stop:** a shipped half with no oracle of its own does not ship — finish it next session.
Full text: [b1b-harvest.md](b1b-harvest.md).

## B1c. Grade the diff against the plan (#94)

**Rule:** grade against the plan file (`$PLANS_DIR/issue-<N>.md`, then the legacy
`.claude/plans/`) — its *Acceptance oracle* and *Files* — or, with no plan, the Issue's own
ask. Verdict `pass` (rides on B2b's evidence) or `reject` (a comment naming the actual gap,
with a `colab:grade` marker; every claim stays held). UI-affecting work is also graded against
its `docs/design/` artifact; a child of a switched epic is graded "dark with the switch off"
(or "removed completely" for `role=remove`).
**Stop:** any reject ⇒ nothing past B1c runs for that issue set on this pass.
Full text: [b1c-grade.md](b1c-grade.md). Read when the set is UI-affecting or belongs to a
switched epic: [b1c-ui-and-switched-epics.md](b1c-ui-and-switched-epics.md). Read before
posting any reject: [b1c-reject-classes.md](b1c-reject-classes.md) — `reject-decision` is the
default, `reject-escalate` needs all three of its conditions, and `rework` (round 1 only) is
the reject whose recommended route needs no authority you lack. An unattended run never
raises an interactive prompt.

## B2. Squash-merge with `Closes #N`

**Rule:** re-run B0's already-shipped grep immediately before merging. Squash onto `<base>`
(never the main checkout parked on a line), one `Closes #N` per harvested issue, `Refs #N` for
a `tracking` issue or `--refs`. Never hand-write `Closes` around a close-gate refusal. A
core-path branch pauses at `⏸ PR-PENDING` (exit 3): link the PR on each issue and stop. A
repo declaring `owner:` lands on trunk; delivery is `colab deliver`, a separate human act.
`post-ship` hook failures are warnings — never re-run `ship` for one.
**Stop:** a match on the re-check means someone else landed it ⇒ do not merge; go to B2a–B4.
Full text: [b2-squash.md](b2-squash.md).

## B2a. Branch CI could not arrive? Read the trunk run at your squash before any evidence (#374)

**Rule:** only when B1a proceeded on a cannot-arrive `none`. `colab ci-wait --sha "$SQUASH"`
(the trunk bound), then: `green` ⇒ cite the run in B2b · `red:finding` ⇒ file `TRUNK RED: <sha>
(#N) fails <what>` before any evidence, the grade stays `pass` · `red:infra` ⇒ one re-run ·
cap expired ⇒ say so in the evidence, naming the run.
Read when B1a read a cannot-arrive `none`: [b2a-trunk-run.md](b2a-trunk-run.md).

## B2b. Post evidence on EVERY issue — including the auto-closed ones

**Rule:** skip only on `ceremony: light`. On every carried issue, auto-closed or not: a
comment opening `<!-- colab:evidence sha=<squash> -->` then `<!-- colab:grade verdict=pass
round=<n> -->`, the trunk squash sha · `file:line` · what you checked and what came back, a
per-item line for each `## Plan` box, a `Grade:` line, a built-app screenshot for UI work, and
the siblings that must now rebase when a group survives. The grade marker is a closed set of
four whole tokens, compared by equality.
Full text: [b2b-evidence.md](b2b-evidence.md).

## B2c. Update the parent epic — close a native container with its last child; tick a hand-maintained one

**Rule:** native parent ⇒ tick nothing; close the parent (`colab close`) only when it carries
`epic`, every sub-issue is closed, no `- [ ]` remains, and it is not a release record
(`colab ship` does this itself). No native parent ⇒ tick only a `- [ ]`/`- [x]` line that
literally carries `#$N`, with the trunk sha. Never close a hand-checklist epic, rewrite its
prose, build a table, or infer parentage from a title.
Full text: [b2c-epic.md](b2c-epic.md).

## B2d. Tear down a spent `group:<key>` label (#82)

**Rule:** `colab ship` deletes a `group:` label once no open issue carries it, confirmed by
two reads that agree (#448). By hand only without `colab`, through the REST issues list; only
`group:*` labels are ever in scope.
Full text: [b2d-group-label.md](b2d-group-label.md).

## B3. Release the claim(s)

**Rule:** unconditional — every issue in the group, finished or not, both halves (assignee
and `in-progress`). `colab ship` already released what it carried; release by hand only what it
did not (`colab release $N`). A B1c reject never reaches here, so its claims stay held.
Full text: [b3-release-claims.md](b3-release-claims.md).

## B4. Tear down the worktree — remove by DEFAULT

**Rule:** `colab worktree rm <name>` (raw `git worktree remove` only deletes the directory —
finish the rest by hand and say so). Keep one only for a named reason in the report, and then
release its claims by hand. Then journal and delete each plan file whose whole number set is
in the harvested set — `colab ship` does this itself; the shell fallback chains the append and
the delete.
Full text: [b4-teardown.md](b4-teardown.md).

## B5. The release ritual — a SEPARATE act, and not yours

Merging to trunk is **not** a release. What comes next follows
[`exposure`](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here) — read the
legacy `tier` value the same way when that is all a repo declares (`A → released`,
`C → live`, `B → null`):

- **`released`** — the tag is what ships it, and this skill never cuts it: whether a
  candidate or final tag may be automatic follows `CONVENTIONS.md` [§6's release rung](../../CONVENTIONS.md#6-releases).
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
  `reject-escalate`/`rework`, marked the same way on the reject comment, with nothing past it
  executed for that issue set on this pass. An unattended run raised **no interactive
  prompt**. A reject whose recommended route needed no new authority posted that route
  as the direction under a `verdict=rework round=1` marker, together with the alternative a human may pick instead
  (B1c, *A reject that already carries its answer*).
- `gh issue view $N`: checklist ticked (inherited from `code-wrap`), and now closed
  with evidence, or left open with the next step written into it.
- Every issue the branch carried (B1b's harvested set) is either closed with evidence,
  split into a new issue for the leftover, or left open with a written reason. No number
  left dangling.
- Every one of those issues has an evidence comment — **including the ones `Closes #N`
  auto-closed**, which attach nothing on their own.
- **Branch CI could not arrive?** B2a read the trunk run at the squash sha before any
  evidence went out. Each evidence comment cites that run as green, or links the
  `TRUNK RED:` issue filed in this pass, or says the run was still in flight and names it.
- `git log --oneline -5 <base>` shows the squash-merge; **every** claim released
  (unconditionally, finished or not) — unless B1c rejected, in which case every claim in
  that set is still, correctly, held.
- Worktree removed — or kept with the reason written in your report and its claims
  released by hand.
- **Or the ship is paused at `⏸ PR-PENDING` (exit 3, #350).** In that case the checks above
  are "not yet", not "failed": the PR is linked on every carried issue, the claims are still
  held, and your report says which approval it is waiting for.
- Every plan file in the harvested set is gone, and the journal line for it landed first.
- **Your report names the branch you merged into.** Not "merged" — merged *into what*.
  It is the difference between shipped-to-trunk and parked-on-a-line, and only one of
  those is on its way to users.
