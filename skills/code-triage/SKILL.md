---
name: code-triage
description: "Decide what to work on next in ONE repo. Takes every open Issue, discards the ones already shipped and the ones someone else holds, groups what must move together (issues touching the same files must serialize — usually one branch, or a place-claim on any repo not declaring writes: isolated), orders what remains by blast radius, and says which groups can be started RIGHT NOW — including whether the repo's trunk CI is alive enough to merge into. Outputs claim + branch commands that feed straight into code-start. A group is ONE unit of work, so a second live branch across its members is reported as a finding naming the carrier branch and the rebase order — never offered as a second spawn. Flags a group judged genuinely hard with a needs-plan label + one-line reason, for code-plan to draft against later — never a plan of its own. Also asks, per ready group, whether the work is batch-mechanical with a usable oracle, and tags the minority that qualifies with a mechanical-lane label + suggested batch size, for a cheap mechanical-work engine to pick up — never routes or dispatches it itself. Cheap to re-run only when §0 is honoured first: a five-input fingerprint compare that ends a genuine no-change ping in three calls — a convention the executing agent follows, not a gate anything enforces, so every run opens by naming which §0 outcome it took (unchanged / changed:<inputs> / no usable cache). Trigger phrases: 'what should I work on', 'triage the issues', 'what can we start', 'plan the next session', 'group the open issues', 'what is ready to pick up', 'sort the backlog'; and — when this session's last act was a triage — the re-ping forms 'again', 'anything new?', 'check again', 'anything to pick up yet?', or a bare 'go'. Runs before code-start; pairs with code-start and code-wrap."
---

# code-triage — what should we work on next?

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/code-triage.md 2>/dev/null || echo "(no local policy for code-triage in this repo)"`

If `.colab/skills/code-triage.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

Runs **before** [`code-start`](../code-start/SKILL.md), on **one repo**. Its output is
a short ranked list of *groups* you could open a session on today, plus an honest
account of why everything else is not on it.

`code-triage` → `code-start` → `code-wrap`.

**How this file is built (#524).** This is the core: the steps in order, each with its rule
and its stop condition, and the commands and tables a run executes. Each step's full text —
edge cases, the measurements behind them, worked examples — sits in a reference file next to
this one, moved there verbatim, and the step names it. **Read a step's reference file before
you act on that step**; the line here is an index to it, never a substitute. Where they seem
to differ, the reference file holds the full rule.

## Principle — an open Issue is a claim about the world, not a queue

Trackers drift behind trunk, always in the same direction: work gets done and the
Issue stays open. Measured on one fleet: **26 of 30 issues sat open with their code
long since merged** (commits said `(#N)`, which does not auto-close, instead of
`Closes #N`), and **4 of 9 sessions in a single day burned an agent** discovering the
work was already shipped.

So triage that skips verification is worse than no triage: it hands someone a
confident, wrong plan. **Every candidate gets checked against the code before it
reaches your list.**

## 0. Has anything changed? — ask before doing anything else

**Rule:** fingerprint five inputs in three network calls — trunk sha; a backlog digest of open
issues' `number,state,labels,title,body` (`N2` receipt); a two-way dependency digest with each
blocker's `BY` line (`COV` receipt); this repo's slice of `~/.colab/state.json`, anchored on
the main checkout; issue-carrying remote branches with an ahead flag (`B5` receipt) — cached
in `$CACHE` (`<git-common-dir>/colab-triage.json`). No receipt, a truncated read, or the
empty digest `e3b0c44298fc1c14` is never a match. On **every** pass, short-circuited too:
re-check stored wakes (`$CACHE.wakes`), and check for a red trunk nobody owns (an accepted
`TRUNK RED:` title or a stored `redTrunk`; else `colab trunk-ci --json`, never an inline
`gh run list` filter). Waiting only on a human counts as unchanged. A match never means merge.
**Stop:** all five equal, no wake met, no unowned red ⇒ report `nothing has changed since
<ts>`, re-print the stored conclusion (§0.1), stop. Full text: [0-fingerprint.md](0-fingerprint.md),
[0-wakes-and-red-trunk.md](0-wakes-and-red-trunk.md); why each input reads what it reads:
[0-fingerprint-notes.md](0-fingerprint-notes.md).

**Every run — short-circuited or not — opens by printing exactly one of three outcome
lines, before anything else.** This is the one thing #244 established a docs repo actually
*can* ship toward "verified to have fired": not an enforced gate (nothing here executes a
skill), but a spoken, greppable receipt that turns "did §0 run" from an invisible
compliance question into a line any reader — human, an orchestrator's transcript scan, a
later census — can check for.

```
§0 unchanged since <ts> · fingerprint <16hex> · <n> calls — re-printing stored conclusion (scope: <scope>)
§0 changed: <input names that moved, e.g. trunkSha,branches — or wakes, unownedRedTrunk> — full pass
§0 no usable cache: <missing | version <v> unrecognised | unparseable | truncated | empty read on input <n>> — full pass
```

The third line is the load-bearing one — it is what separates *cold cache* from *genuine
change*, the exact distinction a transcript census cannot make from a bare "full pass". A
run printing none of the three did not run §0 as specified; §6's report and every write
below still happen, this is purely an addition at the top.

### 0.1 Persist the conclusion, not only the writes

**Rule:** store the §6 conclusion (ready with soft-ready notes, blocked, taken, close,
findings) and its **scope** in `$CACHE`; short-circuit only when the fingerprint matches
**and** that scope covers the request. Required shape `code-triage/7`: `version`, `scope`,
`ranAt`, all five `fingerprint` keys, `lastRun`, `conclusion`; `issues`, `wakes`, `redTrunk`,
`asks` required-when-present. A missing key or unknown version is `no usable cache`; never
store the empty digest. Full text: [0.1-conclusion-record.md](0.1-conclusion-record.md).

### 0.2 Running this twice must change nothing

Under ping-when-idle a re-run is the normal case, not the exception, so every write this
skill performs has to be idempotent.

**This skill's tracker writes are exhaustive — the list below is all of them, and nothing
else is authorised.** An enumeration of "which writes must be careful" reads, by omission,
as permission for anything unlisted; it is not. If a write is not one of the eight below, it
is not a triage write, no matter how naturally it seems to belong on the issue:

1. `blocked_by` dependency edges, via `colab blocked` (§4, #251)
2. the `deps-checked` label, via `colab readiness` (single-issue mode, §4; whole-repo path, §6)
3. the `group:<key>` label plus its one evidence comment (§3)
4. the `needs-plan` label plus its one reason comment (§6)
5. the `mechanical-lane` label plus its one reason comment (§6)
6. a transcribed `Hold:` line for a legacy hold whose reason and date are already recorded
   (§2, *Held*, #386)
7. measured file names appended to an issue's `Touches:` line, when this pass measures a
   live branch holding them (§3, *Record a measured collision where the brake reads it*,
   #386)
8. a `TRUNK RED: <sha> fails <check>` issue — or, where an open issue already tracks that
   failure's flake class, one comment on it recording this occurrence (§5.2, #390) — or
   the **adoption** of an open issue that already diagnoses this red sha: its retitle to
   that form, the removal of `agent-filed`, and one comment (§5.2 step 3, #430). All four
   bounds must hold, and the list is the whole of them:
   - trunk CI is **red** at `<trunk>`'s current head sha (§5, asked by commit);
   - **no open, accepted `TRUNK RED:` issue exists** in this repo (accepted = no
     `agent-filed` label) — one open red is one patch in flight, and a second filing
     splits it;
   - the **mechanical re-run has already been attempted** for this sha, or **cannot
     apply** — the red commit touches more than the docs lane, or no scheduled driver
     runs this repo;
   - **at most one filing per red sha** — the issue, the one comment, or the adoption;
     never two of them and never twice.

**Rule, beyond the list:** writes 6-7 only transcribe; write 8 records a measurement, never a
diagnosis. Triage never re-runs a CI job. §6 is never posted; "only when changed" authorises
nothing new. Every write reads before it writes, and a `deps-checked` older than a
`blocked_by_added` is stale. Full text: [0.2-idempotence.md](0.2-idempotence.md).

### 0.3 Per-issue verdict cache — reuse across a pass that proceeds (#247)

**Rule:** key per issue N = sha256 of trunk sha + N's `I` line + its `DEP` line (zero added
calls). Reuse N's stored verdict only when N's key and every group-mate's key match, no newly
present issue overlaps its file-set, no group member closed, and N is not a hold whose wake
just met; else re-derive N's whole group. §4's ordering is redone every pass. Store `issues`
pruned to open issues, never from an empty read. Full text: [0.3-verdict-cache.md](0.3-verdict-cache.md).

## 1. Gather

**Rule:** `gh issue list --state open --limit 100` and its `in-progress` subset; compare with
§0's `COV` total and state the coverage when the cap bites. This repo only — the fleet picture
is the audit, `colab update`, `colab claims`. Full text: [1-gather.md](1-gather.md).

## 2. Discard what is not really open

**Rule:** each pass below takes an issue off the start list; each is still reported in its
own bucket (§6), never silently dropped.

- **Taken** — `in-progress` or a live claim (`colab claims`) is someone else's. An assignee
  without the label, or the reverse, is a broken **half-claim**: discard it, report its
  repair; its group is blocked on it. A stale claim is a finding, never permission. A
  `deferred:*` claim's wake is evaluated every pass: met ⇒ *parked, wake met*; unresolvable ⇒
  *parked, wake unresolvable*; none ⇒ ordinary Taken, noted. Full text: [2-taken.md](2-taken.md).
- **Already shipped** — `git log --all --grep="#<N>"`, and grep for what the issue
  *describes*. Fully shipped ⇒ `colab close <N> --comment "<evidence>"` (trunk sha +
  `file:line`), never a bare `gh issue close`; partly ⇒ narrow it. Memoize the verdict per trunk
  sha on a clean tree only, never the evidence. Full text: [2-already-shipped.md](2-already-shipped.md).
- **Containers** — an `epic` is never a start candidate; it goes in the epic bucket. Findings:
  an epic carrying `needs-decision` or a `decision:options` block, a `delivery:*` label on an
  epic, an open epic whose sub-issues are all closed (triage does not close it). A release
  tracking issue is a record, reported the same way. Full text: [2-epics.md](2-epics.md).
- **Switched epics** — only on `exposure: released` or a bare legacy `tier: A` (else say so on
  the `switches:` line). Four or more unfinished, or any older than 28 days, is a finding for
  a decision, never a blocker; no label, no comment. Read when the repo is `released`:
  [2-switched-epics.md](2-switched-epics.md).
- **Non-code delivery** — `delivery:content` / `ops` / `elsewhere` ⇒ the route bucket;
  `delivery:design` ⇒ the design bucket, but it still takes §5's first gate and the marker
  write. No `delivery:*` label, `delivery:code` and `delivery:docs-only` proceed normally.
  Full text: [2-non-code-delivery.md](2-non-code-delivery.md).
- **Held** — a hold is a `deferred:*` label or a label declared under `holds:` in
  `project.yml`, never inferred from a name. Off the ranked list, into blocked; evaluate its
  newest `Hold:` line's `wake:` every pass and print `FIXED` (a legacy hold transcribed —
  write 6, only when label, `review-by:` date and a recorded reason naming the owner all
  exist), `STALL`, `WAKE` or `HELD`. Record unmet wakes in `$CACHE.wakes`. Triage never
  removes a hold. Full text, with the wake table: [2-held.md](2-held.md).

## 3. Group — this is a correctness constraint, not tidiness

**Rule:** issues that touch the same files must serialize — one branch on `writes: isolated`;
on a repo permitting trunk-direct, an attended human session behind a place-claim unless one
of the two mandatory-branch conditions fires. Group on overlapping files or subsystem, a
prerequisite, or children of one epic landing together; keep disjoint files apart. On
`isolated`, all issue numbers in one **trailing** run. Read an epic's state, never its title
(a checklist is a claim); verify `file:line` before quoting. Full text: [3-group.md](3-group.md).

### Then persist the group — it is a judgement no tool can re-derive

**Rule:** `group:<key>` on every member plus one `Group:` / `Because: <file:line>` evidence
comment, grepped for first. Remove the label where contradicted and from a one-member group.
Quote the current tree; record only checked collisions. Full text: [3-persist-group.md](3-persist-group.md).

### Then ask the one-branch question — a second live branch is a finding, not a spawn

**Rule:** for every group with two or more open members, in any bucket, after the removal
rules: primary net = local and `origin` refs whose **whole** trailing number run intersects the
open members (zero network calls); classify each with `colab landed --branch`; second net =
`colab holders <p>` on the `Because:` paths (`cargo` only); on a coexistence repo a
place-claim (`colab places`) is a live unit too. Fail toward the finding. Carrier = most
members, then older head, then ref name; triage reports the order, never performs it.
Full text: [3-one-branch.md](3-one-branch.md).

### Record a measured collision where the brake reads it (#386)

**Rule:** when this pass measures (from git, or a `cargo` `holders` row) that a live branch
not the issue's own writes a file the issue will edit, append those paths to the issue's
`Touches:` line (write 7) — append, never rewrite — and still report it. It is not a group.
Full text: [3-touches.md](3-touches.md).

## 4. Order by blast radius, not by number

**Rule:** band first by owner priority — `priority:now` › `priority:high` › unlabelled ›
`low-priority` (#537) — then, within each band, rank surviving groups: 1 blocks other work,
2 reaches users (by `exposure`; a bare legacy `tier: B` gives no signal), 3 cheap and
unblocking, 4 everything else. The band orders, never admits: a held `now` group stays held. A human's recorded queue order outranks yours among the
groups it names, never as an edge. State each rank's reason. Full text: [4-order.md](4-order.md).

### Then write the dependencies down — as relationships, not just as report prose

**Rule:** a dependency you determined (B needs something A produces) becomes an edge:
`colab blocked <blocked> --by <blocker>`, which reads before and after writing. Never an edge
for a queue position, for file contention (report that as a finding), or from titles alone.
A partly-external wait is a finding; triage does not split it. `--clear --reason` only a false
edge, never one whose blocker landed. Full text: [4-dependency-edges.md](4-dependency-edges.md).

### Single-issue mode

**Rule:** given one issue, run §2 and the §5 gate on it alone and leave the answer where a
machine reads it: a `blocked_by` edge, or `colab readiness <N>` (raw fallback: add
`deps-checked`). Read the label back — an exit code is not evidence. No marker on `ceremony:
light`. The conclusion covers that issue only (§0.1). Full text: [4-single-issue.md](4-single-issue.md).

## 5. The readiness gate — can this start *right now*?

**Rule:** a group is ready only if every gate holds; anything else is `blocked`, blocker
named. Unclaimed (no half-claim) · verifiably undone (§2) · actionable · nothing it depends on
missing — read `blockedBy`, judge each open blocker's state (§5.1), and empty means *nobody
looked* · trunk CI alive — `colab trunk-ci` must print `GREEN` for trunk's current head sha,
never a `gh run list` filter of your own; red with no patch ⇒ §5.2, once per repo · no live
worktree on this group's own paths · no pending `needs-decision` (look for a recorded or
unrecorded ruling first; a second question is `colab decision --reopen`; an ask in neither
shape is a finding) · delivery code, docs-only or not asked · not held. Full text: [5-gates.md](5-gates.md).

### Every label that affects a start — who sets it, who clears it (#360)

**Rule:** only the labels in this table, and those declared under `holds:`, keep an issue off
the READY list or off an unattended start; `agent-filed` stays READY and prints a
`provenance:` line. Full text, with the table: [5-start-labels.md](5-start-labels.md).

### 5.1 An open blocker is not one verdict — look at what state it is in

**Rule:** for each open blocker, read §0's `BY` line, then its **remote** branch by trailing
number and `colab landed --branch origin/<branch>`: closed or `landed` ⇒ clears; a pushed
`cargo` branch ⇒ soft (`READY*`); anything else ⇒ blocked. Any hard blocker outranks every
soft one; a session or claim is not evidence; unsure ⇒ blocked; never record the soft verdict.
Report `blocked by #N` · `soft: waiting on #N` · `free (checked)` · `dependencies unchecked`
apart. Full text: [5.1-blocker-state.md](5.1-blocker-state.md).

### 5.2 A red trunk with no patch yet — file it, never re-run it (#390)

**Rule:** run once per pass, before §4, whenever §5's trunk-CI read is red. An open, accepted
`TRUNK RED:` issue ⇒ write nothing. The scheduled driver's re-run still pending ⇒ wait.
Otherwise adopt an existing diagnosis (retitle, drop `agent-filed`, one comment), comment once
on an accepted flake-class issue (and record `redTrunk`), or file `TRUNK RED: <sha> fails
<check>`; grep for the sha first. Never re-runs a job. Read when trunk CI is red: [5.2-trunk-red.md](5.2-trunk-red.md).

## 6. Report — make it directly actionable

**Rule:** console output, never posted to the tracker. An empty ranked list opens with the
`DRY` block. Each ready group prints its branch and numbers, `why:`, `files:` and `start:` —
always the claim-and-worktree command, never `colab solo` (a human note may be added on a
non-isolated repo). Soft-ready prints `READY*` with a `note:` naming the branch; `mechanical:`,
`priority:` and `design:` (with `record:`) lines appear only where earned, and no `design:`
state moves a group out of ready. Every blocked line says what blocks it, who clears it and
whether they were asked — none named or none asked prints `STALL`, first; an open human ask
prints one `ASKED` line, and only a new ask gets the five-line card, once. Then taken, close
these, epics, route, design. Findings: one `FINDING` block per group that broke the one-branch
contract (a live carrier gets `continue:`, never `start:`), switch findings, and the
`findings:` and `switches:` limits lines on every pass.
Full text: [6-console-and-dry.md](6-console-and-dry.md), [6-ready-lines.md](6-ready-lines.md),
[6-buckets.md](6-buckets.md), [6-findings.md](6-findings.md).

**Do not let an Issue vanish.** Every open number ends the pass in exactly one
bucket — ready, blocked, taken, epic, route, design, or close-it. A number that quietly falls off
the list gets re-triaged from scratch next time, which is how the same work gets
discovered three times.

### Then persist each verdict — the report is not the only consumer

**Rule:** skip on `ceremony: light`. Free ⇒ `colab readiness <N>` for every member; soft-ready
⇒ no marker; blocked ⇒ unset, `--clear` if stale. The design bucket gets the same write. The
pruned §0.3 `issues` map is written here too. Full text: [6-persist-verdicts.md](6-persist-verdicts.md).

### Then flag hard groups with `needs-plan` — a label, not a plan (#94, `CONVENTIONS.md` [§5](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94) *Planning*)

**Rule:** a ready or soft-ready group judged genuinely hard gets `needs-plan` on its lead issue
and one `needs-plan: <reason>` comment (grep first). One sentence, never a plan; not a gate;
the minority only. Full text: [6-needs-plan.md](6-needs-plan.md).

### Then flag delegable groups with `mechanical-lane` — a batch size, not a routing decision (#93)

**Rule:** ask every ready or soft-ready group *mechanical + oracle?* Both yes ⇒
`mechanical-lane` on its lead issue, one `mechanical-lane:` comment with the oracle and a
`Suggested batch size:` (grep first), and a `mechanical:` report line. Doubt ⇒ untagged. Not a
gate. Full text: [6-mechanical-lane.md](6-mechanical-lane.md).

### Then rank `low-priority` groups last — a throttle, not a veto (#268)

**Rule:** a group whose lead issue carries `low-priority` is ranked last — never off the list —
and prints a `priority:` line; it is not a gate. A driver reading it as a veto is a finding.
Full text: [6-low-priority.md](6-low-priority.md).

Hand the top group to **code-start**, which will re-verify the claim before taking it.

## Verify complete

- **No write outside §0.2's eight landed on the tracker.** In particular: no per-beat
  narrative verdict comment, no "Triage at trunk `<sha>`" note, no "re-measure — verdict
  CHANGED/REVERSED" update, no correction to any of these, no restated §6 report, no
  "still ready, unchanged" note — the report went to the console and nowhere else. A
  group's file-contention line, if reported at all, named an actual path overlap with this
  group's own deliverables, not the repo-wide worktree list.
- **One of the three required §0 outcome lines was printed, first, before anything else** —
  `unchanged` / `changed:<inputs>` / `no usable cache`. A run printing none of them did not
  run §0 as specified, whatever else it got right.
- A run that short-circuited said so, named the timestamp it compared against, and
  re-printed a stored conclusion whose scope covers what was asked.
- A run that proceeded wrote the **required** `$CACHE` shape — `version`, `scope`, `ranAt`,
  all five `fingerprint` keys, `lastRun`, and `conclusion` — not a partial record. A record
  missing any fingerprint key, or none of the five, is the failure #244 measured directly in
  this checkout: a cache nobody can compare against next time, that forces every future run
  to take the full pass regardless of what actually changed.
- The `issues` map (§0.3) was rewritten, not appended to — every entry corresponds to an
  issue still open at the end of this run, nothing else. A group verdict that was reused
  had every member's key checked, not just the one issue being printed.
- Re-running changed nothing that was already true: no duplicate `blocked_by` edge (`colab
  blocked` is idempotent on an already-present edge — §4, #251), no re-closed issue, no
  second copy of a group's evidence comment.
- Every multi-issue group survives this run: `group:<key>` on **every** member, one
  evidence comment naming the collision, and the label removed anywhere it stopped being
  true. A group that exists only in this report is the failure §3 describes.
- **Every group with two or more open members was asked the one-branch question** (§3) —
  including groups whose members all landed in `taken`, which is the bucket the motivating
  measurement's group would otherwise have vanished into unremarked.
- Every second live branch found is reported as a **finding** naming the carrier and the
  rebase order, and a group with a live carrier got a `continue:` line rather than a
  `start:` one that `colab worktree new` would refuse (#124).
- **Every `Hold:` line this pass posted was a `FIXED` transcription** (§2, *Held*): the
  hold label, a `review-by:<date>` label and a recorded reason naming the owner were all
  there, no `Hold:` line for that label existed before, and `wake:` holds only the date.
  **Every `Touches:` append names a path measured against a live branch** (§3), and nothing
  already on the line was rewritten or removed.
- **No ref was rebased, pushed, deleted or otherwise edited by this pass.** Triage names
  the order; `code-ship` B0 performs it. Neither is among §0.2's eight authorised writes.
- **The findings limits line was printed — clean or not** — and it claims only pass-time
  knowledge, naming what it is blind to. A findings section that reads as a guarantee of no
  second branch is a fail, not a wording nit: nothing here polls.
- The finding went to the console and to `$CACHE`'s `conclusion.findings`, and **nowhere on
  the tracker**. It is not one of §0.2's writes, and not a ninth.
- Every open Issue is accounted for in exactly one bucket.
- The verdicts were **persisted, not only printed**: every free group got its
  `colab readiness` marker, every blocked group was left unset (or cleared if
  stale), soft-ready was left unmarked — and, where an event sink is configured,
  the `readiness.marked` events are present in the feed, not merely the
  `deps-checked` labels on GitHub. A pass that feeds an event-driven consumer
  verifies its sink, not only its GitHub writes.
- Every "ready" group passed all six gates, not just "nobody is assigned".
- Every open blocker was judged on its **state** (§5.1), not on being open — and every
  soft-ready group says what it waits on and names the branch the code is already on.
- No `blocked_by` edge was cleared merely because its blocker's code landed (`colab blocked
  --clear` refuses a closed blocker without `--force` — §4, #251).
- No edge was written for file contention. Every contention-only edge found, and every
  issue only partly behind an external wait, was reported as a finding, and none was
  "fixed" by triage (§4, #371). Every epic carrying a `delivery:*` label, and every open
  epic whose native sub-issues are all closed, was reported in the epic bucket (§2, #371).
- No UI-affecting group ended up in `blocked` just because it had no artifact, or because
  its ruling was never recorded (§6, `design:` line, #356). Every member with no
  `decision-recorded` label had the unrecorded-ruling check run before `absent` was
  printed. Every ruling found was reported with its link and a `record:` line, and
  triage did not run `record:` itself.
- Every unclaimed, unheld `delivery:design` issue went through §5's first gate and got the
  same marker write as a free code group, or had a stale marker cleared (§2, §6, #380).
  Being off the ranked list did not exempt it.
- **A red trunk got a `TRUNK RED:` issue, or a named reason it did not** (§5.2, #390): an
  open one already existed, the scheduled driver's re-run was still pending for this sha,
  or this sha was already filed. No CI job was re-run by this pass, and no sha was filed
  twice.
- A pass with an empty ranked list opened with the `DRY` block. Every listed issue named
  what would make it startable and who holds that (§6, #380).
- Every blocked line says who clears it and whether they have been asked. Any line with
  no one named, or no one asked, printed as `STALL`, first in the blocked list (#356).
- Every open human ask printed as one `ASKED` line (`unchanged, waiting on <link> since
  <date>`), with the date it was first put and no options. Only an ask that was not
  already open got the five-line card, and its `asks` entry was stored (§6, #489).
- Every "already shipped" call carries evidence (sha + `file:line`) — not a hunch.
- Branch names carry all issue numbers in one trailing run.
- Every group judged hard got `needs-plan` on its lead issue plus a one-line reason
  comment — and it landed on the minority actually judged hard, not on every group as a
  default.
- Every ready or soft-ready group was asked the mechanical + oracle question; every yes
  got `mechanical-lane` on its lead issue plus a one-line reason and suggested batch
  size, and a `mechanical:` line in the §6 report — and, same as `needs-plan`, it landed
  on the minority actually both mechanical and oracle-checkable, not on every group.
- Every `priority:now` / `priority:high` group was banded ahead of the unlabelled ones before
  blast radius was applied, still passed §5's gate like any other, and carries a `priority:`
  line in the §6 report; an agent-applied `priority:*` label was reported as a finding.
- Every `low-priority` group was ranked last in §4's list — never off it, never sorted
  by its own blast-radius reasoning alone — and carries a `priority:` line in the §6
  report; §5's readiness gate treated it exactly like any other group.
- Anything surprising — a stale claim, a dead trunk CI, an epic whose table
  contradicts its title — is **reported**, not silently worked around.
