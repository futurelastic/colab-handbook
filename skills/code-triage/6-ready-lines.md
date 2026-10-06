# code-triage · §6 Ready lines — `start:`, soft-ready, `mechanical:`, `priority:`, `design:`

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

For each **ready** group, give the four things a session needs to begin. The fourth,
`start:`, is **always the claim-and-worktree command** — ⚖ #233 makes this true on
every repo now, not just `writes: isolated` ones: triage's own output is consumed by
sessions that may be **unattended** (a dashboard auto-start, a scheduled driver), and
solo flow now requires `COLAB_HUMAN=1` — attendance transcribed from a live human
instruction, never inferred, never assumed by a triage report. `start:` may not emit
`colab solo` on any repo, because it cannot know whether the session reading it will
have a human behind it.

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

**On a repo that does not declare `writes: isolated`, add a note — never replace
`start:` with it:** a human working the trunk checkout directly, in a live
conversation, may instead run `COLAB_HUMAN=1 colab solo --session <id>` where neither of
[§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s
two mandatory-branch conditions fires — but that is a human's choice to make in the
moment, not a command this report may hand to whatever reads it next. **`--session` is
mandatory on `colab solo` since #242** (it mints the same shared-checkout hold a
worktree-less `colab claim` does) — never drop it from the note, even though the note
itself is optional:

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
       note: no writes: isolated veto here — a human at the keyboard may instead run
             `COLAB_HUMAN=1 colab solo --session <id>` (no branch mandatory; --session
             mandatory, #242); an unattended session must use the worktree command
             above regardless
```

A **soft-ready** group is startable, so it belongs in the ready list — but it carries a
line the plain ones do not, because a session picking it up needs to know both *what it
is waiting on* and *that the code already exists*:

```
READY* fix/import-fixes-115-114-113   #115 #114 #113
       note: waits on #98 — its code is written and pushed (origin/feat/parser-98,
             cargo), unmerged at the human gate. Start now; do not re-write it.
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

Name the branch in the note. Without it the operator cannot check the claim, and "the
code exists somewhere" is the kind of reassurance that sends someone to write it twice.

A group judged **mechanical + oracle-checkable** (the verdict below, after §5) carries one
more line — present only on the minority that earns it, absent from every other group:

```
READY  chore/relabel-status-columns-140-139-138   #140 #139 #138
       why: cheap and unblocking; trunk CI green 2h ago
       files: app/Reports/*.php (11 files, same rename across each)
       mechanical: yes — batch of 4; oracle: `php artisan test --filter=ReportColumns`
       start: colab claim 140 139 138 --worktree relabel-status-columns-140-139-138
```

A group carrying `low-priority` (the verdict below, after §5) carries one more line
too — present only on the minority that earns it, and printed **last** in the ready
list regardless of what its `why:` line says:

```
READY  fix/stale-log-cleanup-190   #190
       why: cheap and unblocking; trunk CI green 2h ago
       priority: low — startable, ranked last
       start: colab claim 190 --worktree stale-log-cleanup-190
```

A **UI-affecting** ready group — its files fall under a UI surface (views,
templates, frontend components, anything a design system consumes) — carries one
more line, reporting whatever `docs/design/` shows for it (`CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
conclusions are three units, not two*). This is a report line, not a new
readiness gate — the gate is the existing `needs-decision` check in §5 above; this
line exists only so "no artifact yet" is visible before a session starts building,
not after:

```
READY  feat/onboard-redesign-88   #88
       why: cheap and unblocking; trunk CI green 2h ago
       files: resources/js/Onboard/*.tsx
       design: docs/design/onboard-88-spec.md present — build to it
       start: colab claim 88 --worktree onboard-redesign-88
```

**No `design:` state moves a group out of ready** (#356). That holds here, and it holds
for anything that restates this section. If a consumer's label description, agent
prompt or local doc turns "no artifact yet" into "blocked, design lane first", that
paraphrase is wrong. Follow this skill, not the paraphrase. The only design gate is
`needs-decision`. For a small change the artifact is promoted by `code-wrap` A2 on the
branch that builds the surface, so its absence before that branch exists is expected. A
**new surface** waits on its `delivery:design` issue (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
work splits by size*, #359) through a `blocked_by` edge and only that — so it lands in
`blocked` because §5's edge check says so, never because of this line:

```
BLOCKED #88  blocked by #87 (delivery:design, new surface) — clears: the design session, when #87 ships — dispatched: <who, or "not yet">
```

Four states. The first three mirror the ruling's table exactly. The fourth is about
the ruling's record, not the artifact:

- **present** — name the file(s) found under `docs/design/` for this slug/issue.
- **absent** — say so plainly. If nothing has applied `needs-decision` to this
  group yet, that is worth a human's attention before the session starts building
  — but absence is not a new gate to enforce here, it is the same `needs-decision`
  gate §5 above already checks. **Before you print `absent`, run the check below.**
  If the group looks like a **new surface** under §5's size test and no
  `delivery:design` issue exists for it, say so on the line and leave the group ready:
  `design: absent — looks like a new surface, no design issue filed`. Filing the design
  issue and applying the label belong to the filer; neither is a §0.2 write. If both
  issues exist and the edge between them is missing, triage may write it (§0.2 write 1,
  `colab blocked <build> --by <design>`).
- **superseded** — the artifact exists but a later ruling replaced it; name both
  files so a session does not build against the stale one.
- **ruling exists, unrecorded** — a member lacks `decision-recorded`, and a ruling for
  its surface was nevertheless found. Link to it and print a `record:` line under it,
  and keep the group in `ready`. If `needs-decision` is applied, the group is in
  `blocked` (§5) and gets no `design:` line. Its blocked line carries the same link and
  `record:` command as the thing that clears it.

**The unrecorded-ruling check.** Run it for every member of a UI-affecting group that
carries no `decision-recorded` label. Read the issue's own comments and every issue it
links to or references: its parent, its `blocked_by` edges, and any `#N` or
`owner/repo#N` in its body or comments. That costs one `gh issue view <N> --json
comments` per member, plus one per linked issue. You pay it only for UI-affecting
members with no record, which is a small share of a pass. Count a comment as a ruling
only if it meets all three of these:

1. A human wrote it, from an account `colab decision` trusts. An agent's proposal is not
   a ruling.
2. It picks a direction for this surface. A question, "looks good", or a thumbs-up does
   not.
3. Nothing later on the same thread replaces it.

If you are unsure whether a comment qualifies, print it as a candidate: `design: ruling
exists, unrecorded? — <link>`. Do not drop it, and do not report the group as blocked.

```
READY  feat/settings-panel-412   #412
       why: server half shipped (#398); trunk CI green 1h ago
       files: resources/js/Settings/*.tsx
       design: ruling exists, unrecorded — <maintainer>'s comment on #412, 2026-09-20
       record: colab decision 412 --record --ruled-by <maintainer> --body-file <file quoting and linking it>
       start: colab claim 412 --worktree settings-panel-412
```

**Triage prints `record:`. It does not run it.** §0.2 lists every tracker write triage
may make, and nothing outside that list is allowed. Deciding that someone's comment
counts as a ruling is also a judgement about their words. It should be made once, by
whoever signs `--ruled-by`, and a ping-when-idle loop must not be what clears a gate. The
session that takes the group runs the `record:` line before its first build commit, the
same way it runs `start:`. That is the ordinary agent case the command's own help
describes: an agent writing down a ruling a human already made.

Not UI-affecting → no `design:` line, same as `mechanical:` and `priority:` above.
