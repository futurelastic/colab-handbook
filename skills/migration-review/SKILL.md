---
name: migration-review
description: "Review the database migrations a branch carries, as the repo's migration-reviewer role, and end in exactly one verdict: GRANT (a passing review record and the grant command bound to the reviewed HEAD), REWORK (a brief the author can act on without asking back: file+line, the risk in one sentence, a named fix pattern, the command that proves the fix), or ESCALATE (a named condition a human must rule on). Reads the migration against the engine production runs, not the engine CI happens to test on. Never decides release contents or business timing, never grants a migration that already ran on a database holding real data, never trades data away on the author's behalf. Written for whichever agent or person an adopter binds to the role; loads the same way for all of them. Trigger phrases: 'review this migration', 'migration review', 'is this migration safe', 'grant the migration', 'the ship is parked on no-new-migrations', 'needs-migration-grant', 'act as the migration reviewer'. Before binding a new reviewer to the role, run its blind test set (test-set/README.md)."
---

# migration-review — read the migration, reach one verdict, leave evidence

The repo's `colab ship` refuses a branch that adds a migration unless a grant opens that door
([CONVENTIONS.md §5, *Migration exemption*](../../CONVENTIONS.md#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98)).
A grant from a human says *someone looked*. A grant from the `migration-reviewer` role has to
say *what was looked at* — the review record — and it covers only the commit that was
reviewed. This skill is the looking.

It is written for **the reviewer**: whoever an adopter has bound to the role. Nothing here
depends on which model, agent or person that is. What it depends on is that the reviewer has
**not** seen the blind test set's answer keys (see [*Before a new reviewer takes the
role*](#before-a-new-reviewer-takes-the-role)).

**Three files make up the study material.** Read them in order the first time; after that,
this file plus the checklist is enough for a routine review.

| File | What it holds |
|---|---|
| `SKILL.md` (this file) | when it runs, the procedure, the checklist, the verdict rule, what each verdict outputs |
| [`playbook.md`](playbook.md) | the risk ladder with worked examples, the engine behaviour each checklist item leans on (every claim sourced and dated) |
| [`rework-brief.md`](rework-brief.md) | the brief format and the catalogue of named fix patterns a REWORK must cite |

`test-set/` is **not** study material. It is the exam. A reviewer never opens `test-set/keys/`
— having read them makes it untestable ([below](#before-a-new-reviewer-takes-the-role)).

---

## When it runs, and when it must not

**Runs** when a branch carrying a migration needs a grant: an issue labelled
`needs-migration-grant`, a ship parked on *no new migrations*, or a direct request.

**Preconditions — check them first; each failing one ends the review before it starts:**

1. **The repo accepts reviewer grants.** The trunk checkout's `.github/project.yml` says
   `migration-grant: reviewer`
   ([project.schema.md](../../project.schema.md#migration-grant--optional)). Absent or
   `human` → stop and say *this repo takes human grants only*. Do not review "to help"; a
   review nobody can record is a review that will be redone.
2. **The role is bound to you.** The adopter's configuration names who fills
   `migration-reviewer`. If it does not name you, you are not the reviewer — stop.
3. **The branch is pushed and its tip is what you will read.** Record the full 40-hex sha
   of `origin/<branch>` now. That sha is the HEAD your verdict is bound to; a new commit
   voids it, and you review again from the top.
4. **You are not the author.** A reviewer never grants a migration it wrote or co-wrote on
   this branch. Stop and say so.

**Never runs to decide** what goes into a release, when a change should ship, or whether a
business wants to give up data. Those surface as ESCALATE, below — never as a GRANT or
a REWORK dressed up to avoid asking.

---

## Procedure

1. **Enumerate every migration in the diff.** `git diff --name-only origin/<trunk>...<head>`
   filtered by the repo's migration paths — the defaults the gate watches plus every prefix
   in `project.yml` `migrations:`
   ([project.schema.md](../../project.schema.md#migrations--optional)). Then look *outside*
   those paths for schema or data changes that slipped past them: raw SQL in a seeder, a
   console command, a model boot hook, a data-fix script. A list you did not build yourself
   is not a list you reviewed.
2. **Read each migration's `up` and `down` in full.** Not its filename, not its commit
   message, not a label another tool put on it. A text-matching risk label once called a
   table drop "additive"; the name of a file is the author's intent, the body is what runs.
3. **Establish the deploy engine and version.** From the repo's runbook, deploy workflow,
   infrastructure notes or CI's deploy-engine leg — in that order of trust. Unknown engine
   or version → you cannot pass item 3; say what you looked at.
4. **Establish the data.** Row count and write rate of every touched table in production, if
   the repo records them; otherwise the order of magnitude you can defend, and say it is an
   estimate. Then the question that decides escalation on its own: **has this migration
   already run anywhere that holds real data** — production, a staging copy of production,
   a customer's instance? Check the deploy log, the `migrations` table of any environment
   you can read, and the issue thread.
5. **Place each migration on the risk ladder** ([playbook §1](playbook.md#1-the-risk-ladder)).
   The branch's rung is its highest migration's rung.
6. **Walk the checklist** below, item by item, against every migration. Write each result
   down as you go — *pass*, or *fail* with file:line. The record carries the count.
7. **Read CI's round-trip result at the recorded HEAD** — both engine legs, and whether the
   round-trip seeder writes rows into every table this branch touches
   ([templates/README.md, *Migration round-trip*](../../templates/README.md#migration-round-trip--what-the-laravel-job-proves-and-what-it-cannot)).
   Pending → no verdict yet; come back when it finishes. The grant needs `pass`.
8. **Apply the escalation rule**, then the verdict rule. Output exactly one verdict.

---

## The checklist

Ten items. Each is pass or fail for the branch; a single failing migration fails the item.
`checklist-items` in the record is `<passed>/10`. **One defect fails every item it breaks** —
a dropped `nullable` fails item 9 (the generated SQL) and item 4 (the rows it hits); list both.
One brief may then cover both, with both item numbers in its heading.

| # | Item | Passes when | Playbook |
|---|---|---|---|
| 1 | **Scope** | Every schema or data change on the branch is in the list you built at step 1 — including any outside the watched paths. | [§1](playbook.md#1-the-risk-ladder) |
| 2 | **Rung** | Each migration's rung comes from what its body does on the deploy engine, and you can state it. | [§1](playbook.md#1-the-risk-ladder) |
| 3 | **Deploy engine** | Engine and version are known, and every judgement below was made for *that* engine, not the test engine. | [§3](playbook.md#3-engine-behaviour-that-decides-verdicts) |
| 4 | **Existing rows** | For every change, rows that already exist end up with a value the author intended: no silent fill (`''`, `0`, zero date), no rounding, no truncation, no rejected constraint (FK over orphans, unique over duplicates). | [§3](playbook.md#3-engine-behaviour-that-decides-verdicts) |
| 5 | **Locking** | On the table's real size and write rate, the DDL's algorithm and lock level on the deploy engine are acceptable, and the metadata-lock wait is named where a long transaction could block it. | [§3.1](playbook.md#31-locking-and-online-ddl--mysql-and-mariadb) |
| 6 | **Reversibility** | `down` undoes exactly what `up` did — no more, no less — or the migration is declared irreversible and the data it destroys is recoverable from somewhere named. | [§4](playbook.md#4-reversibility) |
| 7 | **Rollout order** | Old code runs against the new schema and new code runs against the old schema for the length of a deploy (expand → migrate → contract). Nothing needs code and schema to land at the same instant. | [§5](playbook.md#5-expand--migrate--contract) |
| 8 | **Backfill** | Every data move is batched, idempotent, restartable, and not in the same migration as a table-rebuilding DDL on a large table. | [§6](playbook.md#6-backfills) |
| 9 | **Generated migrations** | Anything a tool generated (a schema diff, a `->change()`, an ORM's migrate) was read as SQL, and it does exactly what the author asked — no restated-modifier loss, no unrelated drift. | [§7](playbook.md#7-generated-migrations) |
| 10 | **Proof** | CI's round-trip passed at the recorded HEAD on the deploy engine, and its seeder writes rows that **exercise what this migration changes** — a `NULL` where it touches nullability, an orphan where it adds a foreign key, a long value where it narrows. Rows that merely exist in the table do not count. | [§8](playbook.md#8-what-a-green-ci-proves) |

---

## The escalation rule

Loss of data is the one thing this role is never allowed to trade. The rule sorts it.

**Intent comes from the issue and the author's own words, never from the code.** A loss the
issue does not ask for, and the author has not accepted, is accidental — even when the code
looks deliberate. If the thread is silent and it matters, ask there before the verdict; do not
guess `loss-intended` on the author's behalf.

- **Accidental loss that a data-preserving rework fully fixes → REWORK.** The author did
  not mean to lose the data, and a known pattern keeps it. This is the ordinary case.
- **ESCALATE** — to a human, with the condition named — when any one of these holds:

| Condition id | Holds when |
|---|---|
| `loss-intended` | The author wants the loss, or accepts it when you name it (a column dropped *because* it is no longer wanted, history deliberately truncated). Whether that data may go is a business decision. |
| `no-preserving-route` | You cannot name a data-preserving pattern that still meets what the issue asks for. |
| `ran-on-real-data` | The migration already ran on a database holding real data. The question is no longer whether the migration is safe but how to repair or accept what it did — never a reviewer's call. |
| `outside-role` | Reaching a verdict would mean deciding release contents or business timing (which of two conflicting migrations goes in this release, whether to hold one back). A *request* about timing — "please grant before Friday" — is not this condition: the verdict does not depend on it, and the grant says nothing about when the change ships. |

The escalation check itself is recorded in the grant as `escalation: data-loss-rule`
with `escalation-result: clear`. A review that escalates mints nothing, so the individual
condition id travels in the escalation note instead.

**ESCALATE outranks REWORK.** If a migration both fails the checklist and trips a condition,
the verdict is ESCALATE; list the rework you would have asked for inside the note so the
human ruling does not have to redo your reading.

---

## The verdict rule — exactly one

| Verdict | When |
|---|---|
| **GRANT** | All 10 items pass, the escalation rule is clear, and CI's round-trip passed at the recorded HEAD. |
| **REWORK** | At least one item fails, and no escalation condition holds. Every failure has a named fix pattern. |
| **ESCALATE** | Any escalation condition holds — whatever the checklist says. |

There is no fourth verdict. *Probably fine*, *grant with a note*, *rework but could ship*
are not verdicts. If CI is still pending, or step 3 or 4 is still unanswered and answerable,
you have not finished — keep going. If a precondition failed, you never started, and you
say which one.

**If you cannot name a fix pattern for a failure, that is not REWORK.** Either a catalogue
pattern fits ([rework-brief.md §3](rework-brief.md#3-the-fix-pattern-catalogue)), or it is
`no-preserving-route` and the verdict is ESCALATE.

---

## What each verdict outputs

### GRANT — a review record and the command that records it

The record is the one `colab migration-grant` validates
([CONVENTIONS.md §5](../../CONVENTIONS.md#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98),
`tools/lib/migration-grant.js` `REVIEW_RECORD_FIELDS`). Every value below is fixed for a
GRANT except the reviewer id, the head and the optional CI run:

```sh
colab migration-grant <N> --branch <branch> \
  --role migration-reviewer --reviewer <your-declared-id> \
  --verdict approve --checklist pass --checklist-items 10/10 \
  --escalation data-loss-rule --escalation-result clear \
  --ci-roundtrip pass --ci-run <run-url> \
  --head <the 40-hex sha from precondition 3>
```

- **The command is human-gated today, for every grant role** — `colab migration-grant` refuses
  unless a human asserts attendance
  ([CONVENTIONS.md §5](../../CONVENTIONS.md#migration-exemption--a-narrow-human-created-door-through-no-new-migrations-98)).
  The reviewer never makes that assertion itself: it posts the review (below) and hands the
  command to whoever may run it. The review is the reviewer's; the recording is the tool's rule.
- **Post the review as an issue comment too** — the rung, one line per migration, and the
  checklist results with file:line. The grant record says *that* each item passed; the
  comment says *why*, and it is what the next reviewer of a similar migration reads.
- The grant covers that HEAD only. Any later commit on the branch means a new review.

### REWORK — one brief per failure

Post a comment with one brief per failing item, in the format of
[rework-brief.md §1](rework-brief.md#1-the-brief-format): **file:line · the risk in one
sentence · the named fix pattern · the proof command.** The author must be able to act on
it without asking you anything. Do not rewrite the migration for them; do not mint anything.

### ESCALATE — the condition, the evidence, the question

Post a comment naming **the condition id**, the evidence that tripped it (file:line, the
deploy log line, the author's words), and **the one question the human must answer**
("may the `legacy_notes` column's contents be discarded?"). Add the rework you would
otherwise have asked for, so the ruling can go straight to action. Mint nothing.

Headings for these comments are for readers; no tool parses them today.

---

## Before a new reviewer takes the role

An adopter binding a new agent (or person) to `migration-reviewer` runs the blind test set
**first**: [`test-set/README.md`](test-set/README.md). The candidate gets the study material
above and `test-set/cases/`, and never `test-set/keys/`. A candidate that GRANTs any case
whose key is not GRANT fails outright, whatever else it got right.

A reviewer that has read the keys cannot be tested with them again. Re-test with new cases.
