---
name: code-wrap
description: "Close the IMPLEMENTER half of a coding session: distill what you learned back onto the feature's GitHub Issue, update any repo docs the work made stale, run the repo's own quality gate, commit only the deliverable paths, push the session branch as backup — then assert the hand-off contract and stop. Never merges, never touches trunk. That is a separate skill, code-ship, run by a coordinator session once a human says go. Trigger phrases: 'wrap up the session', 'finish coding', 'close the session', 'done coding', 'update the issue'. Pairs with code-start before it and code-ship after it."
---

# code-wrap — close a session: distill → docs → gate → commit → hand off

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/code-wrap.md 2>/dev/null || echo "(no local policy for code-wrap in this repo)"`

If `.colab/skills/code-wrap.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

**This is the implementer's half only.** It distills, gates, commits, and pushes a
backup — then stops. It never merges to trunk; that is
[`code-ship`](../code-ship/SKILL.md)'s job, run by a coordinator session once a human
says go. If you came here expecting to merge or find `Phase B`, you want that skill —
this one asserts a checklist for it to pick up, nothing more.

"Stops" means stops **before `code-ship`**, not "the session is over": a wrap that leaves
claimed work unfinished with no named blocker is a checkpoint, and the session carries on
(*A partial wrap is a checkpoint*, under Hand off, #486).

Notation: `$N` = the feature's Issue number · `<trunk>` = the branch sessions
merge into — the value of `trunk:` in `.github/project.yml`
([§2](../../CONVENTIONS.md#2-tiers): `main` on Tier B (fixed); on Tier C a
branch distinct from `main` — `dev` by default, any other name equally
conforming, never a fixed spelling; `dev` on the ordinary Tier A, or `main` on
a tag-gated Tier A) — the tier letter is only ever a **legacy** correlate of
the value, it never decided it · `<base>` = **the branch this session ships
into** — `<trunk>`, unless it was cut from a declared `integration:` line, in
which case it is that line.

**Read `ceremony:` from `.github/project.yml` before the first write.** Absent, or
`ceremony: standard` — everything below applies as written. `ceremony: light`
(project.schema.md#ceremony--optional) thins one step here and nothing else: A1's
narration distills real gotchas only, no progress commentary. (Its other thinned step —
`code-ship`'s evidence comment — lives in that skill, not this one.) Every other step in
this file — claim discipline, squash-eligibility, the quality gate — runs exactly the
same regardless of `ceremony`.

**How this file is built (#524).** This is the core: the steps in order, each with its rule
and its stop condition, and the commands and tables a run executes. Each step's full text —
edge cases, the measurements behind them, worked examples — sits in a reference file next to
this one, moved there verbatim, and the step names it. **Read a step's reference file before
you act on that step**; the line here is an index to it, never a substitute. Where they seem
to differ, the reference file holds the full rule.

### Did this session open with `colab solo`? Its exit is different, not thinner

**Rule:** a claim with no worktree is a trunk-direct *unit*, not solo (#302): run Phase A,
then `colab ship --direct --session <id>`. A true solo session (no claim, no worktree) runs
A3's gate anyway, hermetic run included, distills only if a decision emerged, then
`colab solo --done` (refuses unless clean and fully pushed); `code-ship` never runs. `writes:`
does not tell you which you are — `colab place check`, `colab claims`/`colab worktrees` do;
genuinely unsure ⇒ the ordinary flow below.
Read when the session opened with `colab solo`, or holds a claim with no worktree:
[0-solo-exit.md](0-solo-exit.md).

## Do this now

### A1. Distill knowledge onto the Issue

The Issue is the feature's external memory — write so the next session gets full
context from `gh issue view $N` without re-reading the codebase.

```sh
gh issue view $N                         # then edit the body:
gh issue edit $N --body-file <tmpfile>   # tick the checklist, add Decisions/Gotchas
gh issue comment $N -b "**<YYYY-MM-DD>** — did X, decided Y, left Z open."
```

- Record **reusable knowledge** — a decision and *why*, a gotcha, a dead end —
  not a copy of the diff. The code is already in git.
- No GitHub remote? Write the same into the session notes file from code-start.
- **`ceremony: light` repo** — distill real gotchas only; skip the progress-commentary
  comment (the `**<YYYY-MM-DD>** — did X…` line above). A tick of the checklist and a
  genuine decision/gotcha still belong here — this thins commentary, not knowledge.
- **Wrote or extended a plan file this session** (`$PLAN`, i.e.
  `<main checkout>/.plans/issue-$N.md`, or under `COLAB_PLANS_DIR`, or — written before
  #488 — the legacy `.claude/plans/issue-$N.md`; resolve via `--git-common-dir`, never a
  bare relative path, #113; #94)? Anything in it worth keeping past this session moves
  here, now — the file itself is disposable and dies at `code-ship` teardown. A rung-2
  plan's *Approach* and *Risks* sections are the likeliest candidates when the reasoning
  behind a non-obvious choice would otherwise be lost with the file.

#### Filing a follow-up here? It is agent-filed, and it must say so

**Rule:** a follow-up you decided to file gets the `agent-filed` label, a body ending
`Filed-by: agent (during code-wrap of #$N, session <name>)` plus an `Ask:` line (`backlog` ·
`permission` · `ruling` · `deferred(<trigger>)`), and `colab issue-filed <N>` where `colab`
exists. More than one session of work ⇒ an epic with sub-issues. One the human asked for is
`Filed-by: boss (via session <name>)`, no label.
Read when you file a follow-up: [a1-follow-up.md](a1-follow-up.md).

### A2. Update repo docs the work made stale — not in `CLAUDE.md`

The Issue is the feature's log; **docs in the repo are the living knowledge** the
next person reads without digging through Issues. If this session changed any of
these, update the doc **in the same session** (don't leave "will update later" in
a comment while the file stays wrong). Four of the five destinations below are
in `docs/` — the fifth, a comment at the call site, is not, and follows after
them:

- Domain model changed (new entity/table, renamed concept, new flow) → the
  architecture doc — a single **running** description of the system as it is
  now, edited in place.
- Infra/ops changed (deploy, env, DNS, service account, runbook) → the deploy doc.
- A **decision** worth a rationale-preserving record — chosen option, why,
  alternatives rejected, consequences — not just what the system now looks
  like → an ADR, **one file per decision**: `docs/adr/<issue>-<slug>.md`
  (create the directory if missing).
- A long-lived gotcha (bites again, not tied to one feature) → **one file per
  gotcha**, `docs/gotchas.d/<issue>-<slug>.md` (create the directory if
  missing) — never append it into whichever file is already in your context,
  which is always the repo's instruction file (`AGENTS.md`, else `CLAUDE.md`).

The last two share one naming rule — see below — because they share one defect.

**Rule:** every one of these lands on THIS BRANCH, in your worktree — a commit on the trunk
checkout is a defect (#322). Write docs with absolute worktree paths; commit them in A4.
Full text: [a2-on-this-branch.md](a2-on-this-branch.md).

#### Design artifact — promote it out of exploration, onto this branch, right here (`CONVENTIONS.md` §5)

**Rule:** a branch that followed a `⚖ Decision recorded` design ruling promotes its artifact to
`docs/design/<slug>-<N>-mockup.html` or `<slug>-<N>-spec.md` on this branch (superseded ones
marked, never deleted); which branch carries it follows the size rule (#359). The ruling must
postdate the review (#379) — if not, do not promote, and say so. No ruling ⇒ skip silently.
Read when a design ruling landed on this branch: [a2-design-artifact.md](a2-design-artifact.md).

#### Or: a comment at the call site — when `docs/` is the expensive answer

**Rule:** will the reader be at this exact line? does the knowledge outlive the code? **The
invariant goes in the comment; the incident goes in the doc**; when both, the comment points.
Full text: [a2-call-site-comment.md](a2-call-site-comment.md).

#### Issue-keyed naming — the fix for any sequential-counter document (gotchas, ADRs)

**Rule:** new entry ⇒ new file `docs/gotchas.d/$N-<slug>.md` or `docs/adr/$N-<slug>.md`, never a
sequence; existing single-file/sequential docs stay as they are (lazy migration), never copied
back and forth. Full text: [a2-issue-keyed-naming.md](a2-issue-keyed-naming.md).

#### `CLAUDE.md` is a router, not an archive

**Rule:** the instruction file (`AGENTS.md` where it exists, plus `@`-imports; never edit
tool-managed blocks as prose) gets a pointer, not a copy; prefer editing a line to adding
one; move content, never drop it. Full text: [a2-claude-md-router.md](a2-claude-md-router.md).

#### A *new rule* is a follow-up unit, not a line in this session's diff

**Rule:** something newly concluded goes on an Issue, written by its own claimed unit. Touched
the instruction file ⇒ re-check its pointers against `ls docs/`. Never write a secret into docs.
Full text: [a2-new-rule.md](a2-new-rule.md).

#### `docs-lint`, if this repo has adopted it — structure, not truth

**Rule:** run `node <path-to>/docs-lint.mjs --repo .` if the repo has it; advisory only, never
blocks A4. Read when the repo has `docs-lint.mjs`: [a2-docs-lint.md](a2-docs-lint.md).

### A2b. Reconcile the trunk checkout — is anything of mine sitting in it?

This session's process cwd is the main checkout, not this worktree — it started that
way before the worktree existed (`code-start` step 4 creates it), and nothing ever
moves it. So a tool call made with a **relative path**, any time after that point,
lands on trunk with no error and no warning — most often a docs or changelog edit
made later in the session, after the code itself (absolute worktree paths) already
landed correctly. Check now, before A3 runs the gate on a tree that might be missing
what you are about to commit:

```sh
git -C <repo-root> status --porcelain -uall     # broader than code-ship's check — see below
git -C <repo-root> fetch -q origin <trunk> && \
  git -C <repo-root> log --oneline origin/<trunk>..<trunk>   # #322: a COMMITTED stray, which the line above cannot see
```

**Rule:** a committed stray (second command) is yours to move, never publish: branch it,
`reset --hard origin/<trunk>`, ship or cherry-pick it here; never the push guard's env var.
Dirty ⇒ the ownership ladder (branch overlap, content, timing, company) to one of three
verdicts: **mine** — recover by patch, never a stash, re-run A3; **not mine** — report with
its plausible owner, never clean it; **can't tell** — leave it, report what you checked.
**Stop:** never commit past or delete dirt you cannot attribute.
Full text: [a2b-ownership-ladder.md](a2b-ownership-ladder.md).

### A3. Run the repo's own quality gate

**First, which gate is the verdict here — local, or branch CI (#410)?** Read `gate:` from
**trunk's** `project.yml` (only trunk's value counts, as with `live-env`), then whether any
workflow fires on a push to this branch:

```sh
git show origin/<trunk>:.github/project.yml | sed -n '/^gate:/,/^[^ ]/p'
sed -n '/^on:/,/^jobs:/p' .github/workflows/*.yml     # a push: trigger covering this branch?
```

- **`ci` mode** — `gate:` declares `authoritative: ci` **and** a workflow fires on this
  branch's push (`tools/lib/gate.js` `gateMode`), **and** that workflow runs the tests on a
  runner that does not share a developer's machine (#408's conditions 2 and 3 below). Then
  A3 is **one run of `gate.smoke`**, teed to a file (target ≤ 3 min: lint, types, the tests
  for what you changed), with **no** `colab gate-hermetic` pass — a clean CI runner is the
  hermetic run by construction. Smoke red → fix it. Smoke green → A4, and the **verdict**
  comes from A5's branch-CI read, which in this mode you wait for. Skip the rest of A3's
  full-gate text below.
- **`local` mode** — everything else: no `gate:`, `authoritative: local`, or no branch
  trigger (workflows firing only on a trunk push and `pull_request`). The rest of A3
  applies unchanged: the full gate, plus the hermetic second run.

Either way, **while iterating, run the tests for what you changed, not the full suite**
(`code-start`, *While you work*). The full suite runs once, where the verdict comes from.

Run whatever this repo's CI runs — resolve it from the repo, don't assume:

```sh
# Node:    npm run lint / types:check / test   (whichever scripts exist)
# Laravel: vendor/bin/pint --dirty ; php artisan test --compact
# else:    read .github/project.yml `stack` and .github/workflows/ to find the gate
```

Gate red because of your change → fix it. Never make it green by loosening the
test. If it's red for a reason unrelated to your work, that's a finding — report
it, don't paper over it (`CONVENTIONS.md` [§8](../../CONVENTIONS.md#8-conformance-and-reconciliation)).

**The gate going green against the plan's stated oracle IS the stop condition
(#94).** Not a floor to build past — polishing beyond what the oracle asks for is
scope creep, not diligence. If the plan file (`$PLAN`, when one exists) names the
oracle, that is what "done" means for this session; a green gate that satisfies it is
the signal to move to A4, not a reason to keep going.

#### Run the test step a second time, hermetically — mandatory (#403)

The gate is **not** green until the test step has also passed with this machine taken
away. Run the repo's test command through `colab gate-hermetic`, which runs it twice and
prints one verdict:

```sh
colab gate-hermetic -- <the repo's test command>     # e.g. -- npm test
                                                      #      -- sh -c 'php artisan test --compact'
```

**Rule:** verdicts — `green` (both runs passed) · `skipped` (`live-env: none`; green if the
normal run is) · `red` (normal run fails) · `live-env` (hermetic red: **a red gate**; fix the
test's fixture, `--keep` only a variable the suite truly needs, named). Record the verdict word
in A1 and the hand-off. A green branch-CI run at the head may stand in, as `branch-ci <sha7>`,
only when all three of #408's conditions hold. Run a long suite once, teed, with `pipefail`.
Full text, with the verdict table: [a3-hermetic-rules.md](a3-hermetic-rules.md).

#### Read the verdict, not the transcript

**Rule:** filter output before reading it — counts on green, each failure's name and
`file:line` on red; keep the gate's exit code (`set -o pipefail`); filter each runner.
Full text: [a3-read-the-verdict.md](a3-read-the-verdict.md).

#### Notify the dashboard, best-effort

**Rule:** `colab gate-recorded` (green) or `--fail` (red, unrelated to this branch);
fire-and-forget; no `colab` ⇒ skip. Full text: [a3-notify-dashboard.md](a3-notify-dashboard.md).

### A3b. Request a migration grant, if this branch needs one

**Rule:** diff `<base>...HEAD` for `database/migrations/`, `prisma/migrations/` and every
declared `migrations:` prefix. No match, or every carried issue holds `needs-migration-grant`
or `migration-granted` ⇒ A4. Else add `needs-migration-grant` **before declaring hand-off
complete**, read it back, and report that a human still runs `colab migration-grant` (a
reviewer grant is voided by any later commit). Granting or reviewing is never yours.
**Stop:** label absent after the add ⇒ never create it; report the request could **not** be
filed, pointing at `colab labels --ensure`. Full text: [a3b-migration-grant.md](a3b-migration-grant.md).

### A4. Commit only the deliverable paths

```sh
git add <specific deliverable paths>   # NOT git add -A
git status                             # confirm no local/preview/config files sneak in
git commit                             # Conventional Commits: type(scope): summary
```

Conventional-Commit prefix is mandatory — release notes group on it, so an
unprefixed commit is invisible in the changelog (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).

### A5. Push the session branch as backup — then read the run it started

```sh
git push -u origin <branch>    # a backup/record, NOT a PR, NOT trunk
```

**Rule:** A3's local green does not answer for branch CI. Read every run at the pushed head
(`HEAD=$(git rev-parse HEAD)`, then `gh run list --branch <branch>` filtered to `$HEAD`); waiting on
one in flight is `colab ci-wait --sha "$HEAD" --branch <branch> --timeout 15m`, never a
hand-rolled loop or a background wait. **Stop:** exit 4 (RATE_LIMITED) ⇒ report `none` with
the reset time, do not retry. Full text, with the command: [a5-read-the-run.md](a5-read-the-run.md).

The four classes, their quantifiers and each one's next step are defined in
`CONVENTIONS.md` [§4](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314),
*Branch CI* — use exactly those names. What you are classifying at `$HEAD`:

| class | what you saw at `$HEAD` |
|---|---|
| `green` | **every** run `completed`, at least one `success`, none `failure` (a `cancelled` straggler beside a `success` is still `green`, #92) |
| `none` | no run exists yet, or **any** run is still in flight — a green fast sibling does not cover an unfinished slow one (#307) |
| `red:infra` | a run failed **before** the suite could judge the branch — runner boot, browser install, billing lockout, a dependency fetch; **exit 2** where separated |
| `red:finding` | the suite ran and something in it failed — **exit 1** where separated |


**Rule:** a red class is data — record it, never start fixing `red:infra`; unseparated exit
codes ⇒ §4's ordered log test, undecidable is `red:finding`. Say which `none` you measured (no
branch-push trigger · in flight · no workflows). `local` mode: do not block, report `none`.
`ci` mode (#410): wait 15 minutes; `green` ⇒ `branch-ci <sha7> run <databaseId>`;
`red:finding` ⇒ fix, re-push, re-read; `red:infra` or capped ⇒ hand off with run id and class.
Full text: [a5-reading-the-class.md](a5-reading-the-class.md).

## Hand off — assert the contract, then stop

**Do not merge. Do not open a PR. Do not push trunk.** Wait for an explicit human
go-ahead ("OK, merge it") before anything in `code-ship` runs — clicking Start on
this session was not that go-ahead.

The reason the two phases used to be one skill is that the seam between them is
where things get lost. Replace implicit continuity — "Phase A ended, so Phase B has
what it needs" — with an explicit checklist this skill **asserts** and
[`code-ship`](../code-ship/SKILL.md) **verifies** independently, from git and GitHub,
never by trusting this session's word for it:

- [ ] session branch pushed (A5), **and** its branch-CI class recorded for the pushed
      sha — `green` · `none` · `red:infra` · `red:finding`, naming the sha (A5). A red
      class does not fail this box; an unrecorded one does
- [ ] distill comment posted on each carried issue (A1)
- [ ] **`ci` mode (#410):** smoke green (A3) **and** the branch-CI run id + class at the
      pushed head (`branch-ci <sha7> run <databaseId>`, A5) — `code-ship` reads that run
      and never re-runs tests locally. **`local` mode:** as below
- [ ] gate result recorded — green, or red-for-an-unrelated-reason reported (A3) — and
      the hermetic verdict word from `colab gate-hermetic` (`green` · `skipped` · `red` ·
      `live-env`) recorded beside it, or `branch-ci <sha7>` when a green branch-CI run at
      the head sha stood in for it (A3, #408). A `live-env` verdict is a red gate, not a pass (#403)
- [ ] migration-grant REQUEST filed on every carried issue whose branch touches a
      migration path and didn't already carry the signal (A3b) — or N/A, no migration
      files on this branch
- [ ] claim(s) still held — nothing here releases them; `code-ship` B3 does
- [ ] plan file present at `$PLANS_DIR/issue-$N.md` (`$MAIN_REPO/.plans/` unless
      `COLAB_PLANS_DIR` says otherwise) or the legacy `$MAIN_REPO/.claude/plans/issue-$N.md`
      (#488) — the **absolute main checkout path**, resolved via `--git-common-dir`, not
      "present in `.plans/`" relative to wherever this checklist happens to be asserted
      from (#113; #94) — **or**
      the one line `rung 0 because <reason>` in its place (#486). Absent with no such
      line is a **failed box, not a blank one**: see *A missing plan file* below
- [ ] trunk checkout reconciled (A2b) — clean, or every dirty path worked through the
      ownership ladder and reported by verdict (recovered / not-mine-with-owner /
      can't-tell) — never left unexplained

State this checklist, filled in, as the last thing you report. A box you cannot
check is not a reason to force it true — say what is missing and why, and let
whoever picks up `code-ship` decide, rather than asserting a contract you did not
actually meet.

### A missing plan file — say so, never report "hand-off complete" over it (#486)

**Rule:** check each carried issue for `$PLANS_DIR/issue-$n.md` or the legacy
`.claude/plans/` path under the main checkout (via `--git-common-dir`). Present ⇒ tick.
Absent, real rung 0 ⇒ `rung 0 because <one line>`. Absent otherwise ⇒ report `plan file
missing — rung <1|2> work wrapped without one`, not hand-off complete.
**Stop:** never back-fill a plan after the code. Full text, with the check script:
[handoff-missing-plan.md](handoff-missing-plan.md).

### A partial wrap is a checkpoint, not the end of your turn (#486)

**Rule:** unfinished work on a still-claimed issue ⇒ keep working, same turn. End the turn only
with a `Blocked: <what is missing> — <who or what clears it> (<link>)` line on the Issue per
unfinished item, reported first, or with the remainder moved to its own issue and unclaimed.
**Stop:** "the rest is follow-up" is not a blocker. Full text: [handoff-partial-wrap.md](handoff-partial-wrap.md).

## Verify complete

- `gh issue view $N`: checklist ticked, Decisions/Gotchas updated, session comment added.
- Durable knowledge landed in `docs/`, and `git diff --stat -- CLAUDE.md` shows a pointer
  or an edit — not a transplanted section. If it grew by ~30 lines, A2 was read backwards.
- `<base>` is unchanged — no session commit in `git log <base>`. This skill never merges;
  if `<base>` moved, something ran that belonged to `code-ship`, not here.
- **The main checkout is back on trunk** — `git -C <repo-root> branch --show-current`
  must print `<trunk>`. If you branched in place rather than using a worktree, this is
  the step that pays that debt: a checkout left on a feature branch means anything
  reading that tree (dev server, symlink, LaunchAgent) is serving unmerged code.
- **Ask git, scoped to the repo root, whether it is *dirty* — again** —
  `git -C <repo-root> status --porcelain -uall`, nothing else. Never infer from a path
  prefix or a directory walk: `colab worktree new` nests every worktree inside the main
  checkout, at `<repo-root>/.worktrees/<name>`, so a live worktree's absolute path
  always carries the main checkout's path as a prefix, and a plain listing there reads
  as "the main checkout is dirty" when it is not — git already excludes registered
  worktrees from the parent's status (`CONVENTIONS.md`
  [§4](../../CONVENTIONS.md#4-branches-and-commits)). This is A2b's ladder re-run, not a
  fresh judgement call: clean, or dirty with exactly the not-mine set A2b already worked
  through and reported. **Git only ever answers whether the root is dirty, never whose
  the dirt is** — a hit here that A2b never saw means something after A2b (most often
  A4's own commit) introduced new dirt on trunk; go back to A2b rather than assuming
  ownership either way.
- The hand-off checklist above is stated, filled in, in your final report — not implied.
  Its plan-file box is ticked or carries `rung 0 because …`; a missing plan on non-rung-0
  work is reported as such, never as "hand-off complete" (#486).
- **No claimed issue has unfinished work without a `Blocked:` line on it** — otherwise
  this was a checkpoint, and the session goes back to work rather than ending here (#486).
