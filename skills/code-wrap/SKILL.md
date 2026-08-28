---
name: code-wrap
description: "Close the IMPLEMENTER half of a coding session: distill what you learned back onto the feature's GitHub Issue, update any repo docs the work made stale, run the repo's own quality gate, commit only the deliverable paths, push the session branch as backup — then assert the hand-off contract and stop. Never merges, never touches trunk. That is a separate skill, code-ship, run by a coordinator session once a human says go. Trigger phrases: 'wrap up the session', 'finish coding', 'close the session', 'done coding', 'update the issue'. Pairs with code-start before it and code-ship after it."
---

# code-wrap — close a session: distill → docs → gate → commit → hand off

**This is the implementer's half only.** It distills, gates, commits, and pushes a
backup — then stops. It never merges to trunk; that is
[`code-ship`](../code-ship/SKILL.md)'s job, run by a coordinator session once a human
says go. If you came here expecting to merge or find `Phase B`, you want that skill —
this one asserts a checklist for it to pick up, nothing more.

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

### Did this session open with `colab solo`? Its exit is different, not thinner

Solo flow (CONVENTIONS.md, *Solo flow*) made no worktree and holds no claim, so there is
nothing here — or in `code-ship` — for either skill to harvest or tear down. This is not
`ceremony: light` again, it is a genuinely different shape, and running the sections
below against it produces confusing no-ops. The solo exit is its own, short path:

1. **Run the quality gate anyway** (A3) — solo flow relaxes ceremony, never the gate.
2. **Distill onto an Issue only if a decision emerged** this sitting (A1's spirit,
   not its letter) — solo flow's whole premise is that the commit *is* the memory
   when nothing needs to outlive the session; do not manufacture a narration Issue
   for the sake of having one.
3. **Verify clean and pushed, then release the lock:**
   ```sh
   colab solo --done
   ```
   `--done` re-derives both facts itself (tree clean, fully pushed to
   `origin/<trunk>`) and refuses if either is false — it is the check, not a
   formality that trusts you. A refusal means finish the commit/push first; it is
   not a signal to fall back into the worktree-shaped steps below.
4. **Nothing else runs, and `code-ship` never runs at all.** No B0 sync, no B1 CI
   gate beyond what already ran on trunk post-push, no B2 squash (there is no branch
   to squash), no B2c/B2d/B3/B4. The release ritual (`code-ship` B5 — whichever
   shape `exposure` gives it) is a separate question that solo flow does not settle
   either way — solo flow is gated on session attendance (human-asserted, never
   automated) plus the repo not declaring `writes: isolated` (⚖ #233, CONVENTIONS.md, *Writes* / *Solo
   flow*), neither of which is coupled to `production`, so a live repo may run solo
   flow.

If you are unsure whether this session is a solo session, **`writes:` in
`.github/project.yml` no longer answers this** (⚖ #233 — the field is a veto on ANY
session, including yours; it says nothing about whether YOUR session specifically opened
through solo flow). The reliable signal is `colab solo`'s own lock, not the descriptor:
```sh
colab place check <repo-abs-path>    # exit 0 = free or held by you; exit 1 = held by a live other
```
or check `colab claims`/`colab worktrees` for a row naming your branch — if one exists,
this was NOT a solo session (solo flow makes neither). If genuinely unsure, treat it as
the ordinary worktree flow below; the ordinary steps degrade safely (they just find
nothing to do), where the solo path degrades unsafely if run against a session that DOES
hold a claim or worktree.

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
  `<main checkout>/.claude/plans/issue-$N.md` — resolve via `--git-common-dir`, never a
  bare relative path, #113; #94)? Anything in it worth keeping past this session moves
  here, now — the file itself is disposable and dies at `code-ship` teardown. A rung-2
  plan's *Approach* and *Risks* sections are the likeliest candidates when the reasoning
  behind a non-obvious choice would otherwise be lost with the file.

#### Filing a follow-up here? It is agent-filed, and it must say so

This step is where most agent-initiated issues in the fleet are born: you found
something real, it is out of scope, so you file it rather than lose it. Keep doing
that — but a follow-up you decided to file is **work no human has approved yet**,
and it must be labelled so a batch-start tool can leave it alone
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#provenance--who-decided-the-work-should-exist), *Provenance*):

```sh
gh label create agent-filed --color C5DEF5 --description "Filed by an agent on its own initiative — not human-approved" 2>/dev/null || true
gh issue create --title "<type>: <thing>" --label agent-filed --body-file <tmpfile>
```

Record the returned number and, if `colab` is installed, follow with
`colab issue-filed <N>` — a best-effort notify event (`issue.filed`, #102) so an
external observer learns the issue exists without waiting out its own poll
interval. No `colab` on this machine means skip it.

End the body with the origin, naming the issue you were wrapping when you found it —
that is the breadcrumb back to the context — and, on the next line, the ask class
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#ask--the-filer-declares-the-ask-class-89), *Ask*) so a decision surface never has to re-derive it from
prose:

```
Filed-by: agent (during code-wrap of #$N, session <name>)
Ask: backlog
```

Use `permission` for a request to touch machine/prod state, `ruling` for a question
that resolves to a human judgment and never to a diff, `deferred(<trigger>)` when
you have already decided no action is needed until something else happens, and
`backlog` — the default a missing line reads as anyway — for an ordinary work
proposal.

**Before you file: would one session finish this?** If not, it is an epic — file
the parent for the goal and each item as its own issue, linked as sub-issues, with
`blocked_by` for real ordering (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate), *Epics*).

The distinction is intent, not keyboard. **If the human asked for the follow-up
during this session, it is theirs** — `Filed-by: boss (via session <name>)`, no
label. Only what you decided to raise on your own is `agent-filed`.

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
  which is always `CLAUDE.md`.

The last two share one naming rule — see below — because they share one defect.

#### Or: a comment at the call site — when `docs/` is the expensive answer

The four destinations above all cost something to read *later* — a doc is cold
storage, opened on demand. A comment costs something to read *now* — it is a tax
paid by everyone who opens that source file, forever, whether or not they care.
Both costs are real, so A2 is not "always docs/": ask two questions, in order,
before picking a destination for a piece of knowledge this session surfaced.

1. **Will whoever needs this be looking at this exact line when they need it?**
   Yes → a comment. No — they will be searching a symptom, or deciding before they
   ever open this file — → `docs/`.
2. **Does the knowledge outlive the code it sits next to?** A note on why a loop
   isn't a map dies with the loop → a comment. A vendor/API quirk, or an incident
   and how it presented, survives any refactor of the line it currently sits on →
   `docs/gotchas.d/`.

Shorthand: **the invariant goes in the comment; the incident goes in the doc.**

When both are warranted — the reader at the call site needs the warning, and the
knowledge is also worth finding by search — the comment is a **pointer, not a
copy**: `// see docs/gotchas.d/<issue>-<slug>.md`, never the incident retold
in-line. Same anti-duplication rule as `CLAUDE.md`'s pointer-not-copy rule below,
for the same reason: whichever copy rots first, the other keeps being read.

This lane does not relax the naming/keying rules for gotchas and ADRs below — it
only says some knowledge never belonged in either, because its whole audience is
the person already reading that line.

#### Issue-keyed naming — the fix for any sequential-counter document (gotchas, ADRs)

Both gotchas and ADRs used to accrete into a **single file with a shared
sequential counter**: numbered sections cited elsewhere by number. That shape
breaks identically for either kind of entry, and it was measured breaking for
gotchas first: on the busiest repo, `docs/gotchas.md` reached ~15KB and dozens
of entries, the renumber procedure this forced had to be re-explained verbatim
in 8 separate session briefs in one week, and every renumber silently
stale-dates every existing `§N` citation elsewhere in the repo, with no error.
An ADR directory numbered sequentially (`0001-`, `0002-`, …) has the same
failure mode for the same reason: two parallel branches each adding "the next
one" pick the same number, and one silently loses its identity at merge.

The fix is one convention applied to both, not two conventions that drift
apart: **key the filename on the issue number, never a sequence.**
`<issue-number>-<slug>.md`, one entry per file, append-only — never edit
another entry's file. No shared counter, so no merge contention and nothing to
ever renumber; the issue number is a stable id citations can use across
renames; two parallel branches adding an entry each touch a different file,
never the same line. Already proven this way on two repos in the fleet —
`docs/gotchas.d/` carries ~96 entries on the busiest of them.

- **New entry → new file**, `docs/gotchas.d/$N-<slug>.md` or
  `docs/adr/$N-<slug>.md` as appropriate, in this session's commit.
- **An existing single-file/sequential doc becomes optional, never mandatory
  to keep updating.** `docs/gotchas.md`, if a repo has one, becomes a curated,
  hand-maintained topical guide that *points into* `gotchas.d/` entries (`See
  docs/gotchas.d/N-slug.md`) — never a second copy of one. A sequentially
  numbered ADR directory, if a repo has one, is simply left as historical
  record. Either way: don't copy an entry's content back and forth between
  old and new; the old doc links or sits still, it doesn't duplicate.
- **Migration is lazy, for both.** A repo that already has `docs/gotchas.md`
  or a sequentially-numbered `docs/adr/` keeps it exactly as-is — no forced
  split, no renumber, no rewrite. Only *new* entries from here on use the
  issue-keyed name. If the directory doesn't exist yet, don't create the old
  shape just to hold one entry — go straight to the issue-keyed one.
- Repo has neither yet? The directory is created by this step, on demand —
  no template run is required to start using it. A stub README for each
  directory (naming rule, the don't-copy-back rule above) is available at
  [`templates/gotchas-d-README.md`](../../templates/gotchas-d-README.md) and
  [`templates/adr-README.md`](../../templates/adr-README.md) for
  adoption/handbook-sync to seed; copying it in is optional, not a
  precondition for writing the first entry.

#### `CLAUDE.md` is a router, not an archive

It holds conventions, trunk (and the legacy tier, when that's all a repo declares),
ports, run commands, and **pointers** to the docs
that carry the depth. It is also the one file loaded in full into **every** session
before any work starts, which makes it the worst place in the repo for append-only
accretion — and currently the place accretion lands.

Measured across six repos: **~30 lines added per session, and not one commit ever
made one smaller.** The furthest along went 66 → 452 lines (39 KB, ~10-12k tokens)
in two days; every session in it — including one that only touched CSS — pays that
before doing anything, which is the opposite of code-start's whole premise.

A better destination existing is not enough: the repos that already had a
contributing/gotchas doc grew at exactly the same rate, because nothing pointed
there. So the counter-pressure has to be here:

- **If the knowledge belongs in `docs/`, the `CLAUDE.md` change is a pointer, not a
  copy.** Duplicating is worse than misfiling — whichever copy rots first, the other
  keeps being read. We found a restart procedure living in both, and three other
  rules living *only* in `CLAUDE.md`, so no after-the-fact routing rule can sort
  them: "ops → the deploy doc" silently loses a rule, "gotchas → `CLAUDE.md`"
  returns a second drifting copy.
- **Prefer editing an existing line to adding one.** If nothing already in
  `CLAUDE.md` has become wrong, the correct diff to it is often no diff at all.
- **This is not licence to distill less.** The content is worth keeping — location
  and unboundedness are what's wrong. Move it; never drop it.

This paragraph used to be enforcement-by-prose only, and that failed silently: a repo
was measured at 112,382 bytes / 197 lines — the line count read as healthy while one
"pointer" row alone had grown to 68,350 bytes (60.8% of the file), because nothing
mechanical was watching bytes. `audit/audit.mjs` now flags this — a `CLAUDE.md` over
~40 KB, or any single physical line more than 6x the file's median and over 2 KB — as
an advisory (`audit/README.md`, #64). It is a starting-point threshold, not a hard
gate, but it means a session no longer has to catch this by eye.

#### A *new rule* is a follow-up unit, not a line in this session's diff

A2 covers docs your work made **wrong** — the domain moved, the deploy changed, a
gotcha surfaced. It does not cover a session that *concluded something new*: a rule
about how people work, a decision with alternatives that were weighed. Those go on an
Issue now and get written by a claimed unit of their own (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#writing-a-conclusion-down--the-decision-and-the-document-are-two-units),
*Writing a conclusion down*). Two reasons, and the second is the one agents miss:

- The reasoning needs a home a reader can find, and a squash commit body is not one.
- Normative prose is the most-contended file in a repo. Slipping an unclaimed rewrite
  of it into an unrelated feature's diff is exactly the parallel-branch collision the
  claim model exists to prevent — with nothing claimed, so nothing can warn anyone.

Do not use this to postpone A2's actual job. "This doc is now wrong" is this session;
"here is something new we decided" is the next one.

**Touched `CLAUDE.md`? Re-check its pointer section against `ls docs/`.** An index
that omits half the docs is worse than no index, because a reader trusts it and
stops looking. Measured: one repo's pointer section lists a session-notes file and
the README while omitting four docs totalling 120 KB — this step grew the body for
14 commits and never once maintained the index.

Never write a secret into docs — only *where it lives* (a GitHub Secret, `.env`
on the server, a password manager). Docs are deliverable paths; commit them in A3.

#### `docs-lint`, if this repo has adopted it — structure, not truth

A2 above is about whether docs are still **true**; a separate, optional check
handles whether the doc graph is still **structurally sound** — router links that
resolve, `docs/` files nobody points to, drafts left where current truth lives,
§-citations that resolve. If this repo has copied in `docs-lint.mjs`
(`templates/docs-lint.mjs` — colab-handbook #249), this is the moment to run it:
docs were just touched, so this is when a broken reference is cheapest to catch.

```sh
node <path-to>/docs-lint.mjs --repo .
```

**Advisory only — never a reason to block A4.** Fold any finding into this
session's report the same way you would any other advisory (CI gone red for an
unrelated reason, a stale claim); fix it now if it is trivial and yours, otherwise
say so and move on. No `docs-lint.mjs` in this repo → skip this step silently,
same as any other optional tool this skill checks for.

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
```

Clean → skip to A3. Dirty → **git is authoritative about *whether* the root is dirty
and silent about *whose* the dirt is.** Do not default to either answer; work the
ladder, strongest signal first:

1. **Branch overlap.** Did your branch touch this path?
   `git -C <worktree> diff --name-only <base>...HEAD -- <path>`. Non-empty is close
   to decisive, and it is exactly the observed shape: a docs file edited on both
   sides, the paragraph present on trunk and missing from the worktree's own copy.
2. **Content.** Read the diff (`git -C <repo-root> diff -- <path>`) for a tracked
   file, or the file itself for an untracked one. Recognisable as this session's own
   prose or edit → it's yours, whatever the branch overlap said — this is the only
   signal that catches a stray write to a path your branch never otherwise touches.
3. **Timing.** Was the root already dirty when this session opened? Check `$PLAN`'s
   `Trunk-dirty-at-start` line (code-start step 4) if one exists, or compare the
   file's mtime against this worktree's `created` timestamp (`colab worktrees`).
4. **Company.** `colab worktrees` / `colab claims` — is any *other* session live in
   this repo right now? None → "someone else's live work" has no candidate owner.

One of three verdicts, never a fourth:

- **Mine (or plausibly mine)** — recover it, don't discard it. Capture and replay a
  patch, never a stash (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)):
  ```sh
  git -C <repo-root> diff -- <path> > /tmp/misplaced.patch   # or read an untracked file directly
  git -C <repo-root> checkout -- <path>     # only this path — never a whole-tree `checkout -- .`
  git -C <worktree> apply /tmp/misplaced.patch
  ```
  Re-run A3's gate after — it needs the complete tree, not one missing the file you
  are about to commit. **This is a recovery, not "cleaning someone else's work"** —
  the never-clean rule below is about the other two verdicts, not this one.
- **Conclusively not mine** (branch never touched it, content is unrelated, predates
  this session, another live session is the plausible owner) — **report it, never
  clean it**, exactly as before, but now say who the plausible owner is (from
  `colab worktrees`) instead of only "the root is dirty."
- **Can't tell** — leave it, and say precisely what you checked in the report.
  Neither commit past it nor delete it.

**Why `-uall` here, and tracked-only at `colab ship`:** an untracked file written by
a relative path is invisible to `colab ship`'s dirty-trunk gate forever — it stays
tracked-only by design (#86, regression-guarded, do not "fix" that). A2b is the only
point in the whole flow that class is ever caught, so it deliberately reads wider.
Two things that widens the net to catch, read correctly: a whole *directory* showing
up under `-uall` is an unregistered worktree, not an edit — check `git worktree list`
before reacting, the #273 lesson still applies. And `$PLAN`
(`.claude/plans/issue-$N.md`) showing up here is expected when this session wrote
one — code-start best-effort excludes it via `.git/info/exclude`, but that is
machine-local, not a guarantee every adopter's `.gitignore` repeats it.

### A3. Run the repo's own quality gate

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

#### Read the verdict, not the transcript

On a repo with a real suite, the gate's raw output is not a rounding error next to
`CLAUDE.md` — measured on one mature repo, 366,594 bytes (~104,700 tokens) of
combined stdout+stderr against a 113,989-byte `CLAUDE.md`, at 3,212/3,213 green.
The volume is structural, not a sign of trouble: a TAP-style runner emits a
`# Subtest:` line **and** an `ok N` line per assertion, so it scales with
assertion count — which every convention here encourages growing. And it does not
cost once: gate output joins the cached prompt prefix, so a run at turn 10 of a
40-turn session is re-read on every turn after, not paid for a single time.

A list of test names that passed is the least informative text a session can hold.
Filter before reading it back:

```sh
<gate command> 2>&1 | grep -E '^(not ok|# fail|# pass|Test Files| *Tests )'
```

Adjust the pattern to the runner's own vocabulary — Jest/Vitest, `phpunit`,
`pytest` each summarize differently; grep the one line format that carries
pass/fail counts and failing test names, not the runner's default default verbosity.

- **Quiet on green: pass counts only.** Detailed on red: the failure count and the
  name + `file:line` of each failing test, not just that some failed.
- **The exit code is the verdict — preserve it.** A naive pipe through `grep`
  returns the filter's exit status, not the gate's; `set -o pipefail` (or capture
  the gate's own exit code before piping) so a red gate cannot read as green. Get
  this wrong and it is worse than reading the raw transcript.
- **More than one runner (e.g. lint + tests) → filter each one.** A filter tuned
  to one runner's output silently drops the other's failures, which reads as a
  pass.
- Truncation is not a substitute for filtering: a long run can push the one
  failing line past a tool's read window while the summary sits further down
  still — the filtered command above avoids ever emitting the noise, rather than
  hoping the reader's truncation point lands somewhere safe.

#### Notify the dashboard, best-effort

Once the verdict is known, report it to the dev-dashboard's hand-off checklist mark
("does this branch have a recorded quality-gate result?") — read-side and persistence
already live there; this is the only write call site (#116):

```sh
colab gate-recorded             # gate came back green
colab gate-recorded --fail      # gate is red, for a reason unrelated to this branch's own change
```

Same posture as every other `colab` notify call: silent when `notifyUrl` is unset
(the default — nothing above breaks without it), fire-and-forget, never fails or
slows this step. It resolves the worktree from cwd against `colab worktrees` and
`HEAD`'s own sha automatically — pass `--worktree <name>` / `--sha <sha>` only when
running it from somewhere other than the worktree whose gate just ran. No `colab`
installed → skip this call; A3's own verdict (above) is still what governs A4/A5.

### A3b. Request a migration grant, if this branch needs one

`colab ship` refuses, unconditionally, any branch touching `database/migrations/` or
`prisma/migrations/` unless every claimed issue already carries a live
`migration-granted` exemption (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98),
*Migration exemption*) — human-only, so creating that grant is never yours to do here.
What **is** yours: making sure the *request* gets filed, so the human with the
authority to grant it is actually asked — instead of a session finishing, wrapping,
reporting success, and going idle, with the un-shippable branch discovered only when a
later `ship` (often days later, often a different session) refuses it.

```sh
git diff --name-only <base>...HEAD | grep -E '(^|/)(database|prisma)/migrations/'
```

- **No matches** → nothing to do, skip to A4.
- **Matches, and every issue this branch carries already holds `needs-migration-grant`
  or `migration-granted`** → the request (or the grant itself) already exists, skip to A4.
- **Matches, and a carried issue holds neither** → apply the request signal to that
  issue now, **before declaring hand-off complete** — and read it back, because an exit
  code is not evidence the write took (`code-triage` carries this same lesson for the
  identical failure):
  ```sh
  gh issue edit <issue> --add-label needs-migration-grant
  gh issue view <issue> --json labels -q '.labels[].name' | grep -qx needs-migration-grant
  ```
  - **Confirmed present** → done. State it in the wrap report — which issue(s) got the
    label — and note that a human still has to run
    `colab migration-grant <issue> --branch <branch>` (human-gated — no agent may set the
    env assertion that authorizes it) before `code-ship` can merge this branch.
  - **Still absent after the add** → this repo adopted the conventions before
    `needs-migration-grant` entered the set (#230) and never back-filled it, so the ADD
    landed on a label that does not exist — the same doubly-silent failure
    `readinessMissingLabelHint`/`migrationGrantMissingLabelHint` exist to name for
    `deps-checked`/`migration-granted` (`tools/lib/labels.js`). **Do not create the label
    here** — defining it is not this step's job; `tools/lib/labels.js`'s
    `CONVENTION_LABELS` already owns that definition, and a skill that also defines it
    becomes a second source of truth that drifts (this skill is public and copied by
    other repos, so the drift ships to them too). Say so loudly instead: report that the
    request could **not** be filed, and point at `colab labels --ensure` (or
    `handbook-sync`, `CONVENTIONS.md` §9 step 3) to provision the convention label set —
    never claim success on a write that did not land.

This is mechanical, not a judgement call — a file-path diff, and a label *application*
gated on nothing but ordinary `gh` access, no `COLAB_HUMAN`, no schema review. It never
defines the label and never substitutes for the grant; only a human minting
`migration-granted` still authorizes anything.

### A4. Commit only the deliverable paths

```sh
git add <specific deliverable paths>   # NOT git add -A
git status                             # confirm no local/preview/config files sneak in
git commit                             # Conventional Commits: type(scope): summary
```

Conventional-Commit prefix is mandatory — release notes group on it, so an
unprefixed commit is invisible in the changelog (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).

### A5. Push the session branch as backup

```sh
git push -u origin <branch>    # a backup/record, NOT a PR, NOT trunk
```

## Hand off — assert the contract, then stop

**Do not merge. Do not open a PR. Do not push trunk.** Wait for an explicit human
go-ahead ("OK, merge it") before anything in `code-ship` runs — clicking Start on
this session was not that go-ahead.

The reason the two phases used to be one skill is that the seam between them is
where things get lost. Replace implicit continuity — "Phase A ended, so Phase B has
what it needs" — with an explicit checklist this skill **asserts** and
[`code-ship`](../code-ship/SKILL.md) **verifies** independently, from git and GitHub,
never by trusting this session's word for it:

- [ ] session branch pushed (A5)
- [ ] distill comment posted on each carried issue (A1)
- [ ] gate result recorded — green, or red-for-an-unrelated-reason reported (A3)
- [ ] migration-grant REQUEST filed on every carried issue whose branch touches a
      migration path and didn't already carry the signal (A3b) — or N/A, no migration
      files on this branch
- [ ] claim(s) still held — nothing here releases them; `code-ship` B3 does
- [ ] plan file present at `$MAIN_REPO/.claude/plans/issue-$N.md` — the **absolute main
      checkout path**, resolved via `--git-common-dir`, not "present in `.claude/plans/`"
      relative to wherever this checklist happens to be asserted from (#113) — **if** one
      was written this session (#94); absent is fine when the work never needed one
      (rung 0)
- [ ] trunk checkout reconciled (A2b) — clean, or every dirty path worked through the
      ownership ladder and reported by verdict (recovered / not-mine-with-owner /
      can't-tell) — never left unexplained

State this checklist, filled in, as the last thing you report. A box you cannot
check is not a reason to force it true — say what is missing and why, and let
whoever picks up `code-ship` decide, rather than asserting a contract you did not
actually meet.

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
