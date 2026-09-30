# migration-review playbook — what to look for, and why

Study material for the `migration-reviewer` role ([SKILL.md](SKILL.md)). The checklist says
*what* to check; this file says what each check is looking for, on which engine, and where
that knowledge comes from.

**Every claim about an engine carries a source and the date it was checked**, in the form
`[S3]` pointing at [§9](#9-sources). An engine claim with no source is a guess, and a guess
is exactly what a review exists to replace. If you learn something new about an engine while
reviewing, add it here with its source — never from memory.

Examples use Laravel's schema builder because that is the stack the handbook's round-trip
template covers. The SQL each one produces is what matters; the same reasoning applies to
any migration tool.

---

## 1. The risk ladder

A rung describes **what the migration does to data that already exists**. Read it from the
body on the deploy engine — never from a filename, a commit message or a label. The branch's
rung is its highest migration's rung.

| Rung | What happens to existing data | Typical operations |
|---|---|---|
| **0 — new only** | Nothing existing is read or rewritten. | Create a table. Add a nullable column, or one with a constant default, where the engine does it as a metadata change. |
| **1 — rewritten, values kept** | Existing rows are read or the table is rebuilt, but every value survives unchanged. The risk is time and locks. | Add an index. Widen a `VARCHAR` across a length-byte boundary. Add a foreign key over clean data. Make a column nullable. Backfill a new column from values already there. |
| **2 — values can change or be refused** | Existing values can be filled, rounded, truncated, or the statement can fail part-way on real rows. | Change a column's type. Add `NOT NULL` without a default. Narrow a column. Add a foreign key or unique index over data you have not checked. `->change()` on a column. Rename something running code still reads. |
| **3 — data leaves** | Values are destroyed by design or by effect. | Drop a column or table. Delete or truncate rows. A lossy conversion (decimal → integer, text → shorter text). A `down` that drops more than its `up` added. |
| **4 — already happened** | The migration has run on a database holding real data. | Any of the above, after the fact. |

**The rung does not decide the verdict by itself.** Rung 0 can still fail item 7 (rollout
order); rung 3 can still be REWORK when the loss was accidental and a pattern keeps the data.
Rung 4 is always ESCALATE (`ran-on-real-data`): the review is no longer about the migration.

### Worked examples

**Rung 0 — a new column with a constant default.**

```php
Schema::table('invoices', function (Blueprint $t) {
    $t->string('currency', 3)->default('JPY');
});
```

On MySQL 8.0.12+ and MariaDB 10.3.2+ adding a column is an instant, metadata-only operation
[S1][S7] (MariaDB before 10.4: only as the last column [S7]). Existing rows read the default.
Checklist items 4–8 pass trivially; item 7 still asks whether old code inserting without
`currency` is fine (it is: the default covers it).

**Rung 1 — an index on a busy table.**

```php
Schema::table('events', fn (Blueprint $t) => $t->index(['account_id', 'created_at']));
```

No value changes, so item 4 passes. Item 5 is the whole review: on InnoDB, adding a secondary
index is an in-place operation that permits concurrent DML [S1], but it still needs a brief
exclusive metadata lock at the start and the end, and **a pending exclusive metadata lock
blocks every later query on the table** while it waits behind a long transaction [S2]. On a
table taking writes around the clock, name that wait and how long the longest transaction
runs.

**Rung 2 — `NOT NULL` without a default, the case that passes on SQLite.**

```php
Schema::table('shipments', fn (Blueprint $t) => $t->string('carrier_code'));
```

On SQLite this **fails** against a table with rows: an added `NOT NULL` column must have a
non-null default [S9]. On MariaDB it succeeds, and every existing row gets the implicit
default for the type — `''` for strings, `0` for numbers [S3] — silently. Measured on one
fleet on 2026-09-30: sqlite red, MariaDB green with `''` in every row [M1]. Item 4 fails:
`''` is not a carrier. Fix pattern `nullable-then-backfill` or `explicit-default`
([rework-brief.md §3](rework-brief.md#3-the-fix-pattern-catalogue)).

**Rung 3 — the lossy conversion that looked like a tidy-up.**

```php
Schema::table('ledger_lines', fn (Blueprint $t) => $t->integer('amount')->change());
// was decimal(12,2)
```

Changing a column's type rebuilds the table with `ALGORITHM=COPY` and blocks concurrent DML
on MySQL [S1]. Converting existing values into an integer column rounds half away from zero
[S5] — `12.50` becomes `13`. Strict SQL mode stops conversions that *truncate* [S6]; rounding is
not truncation, and in the fleet measurement this migration succeeded on MariaDB and rounded
money [M1]. Accidental? REWORK with `widen-dont-convert` or `new-column-and-backfill`. Intended
(the business moved to whole units)? ESCALATE `loss-intended` — whether the cents may go is
not the reviewer's call.

**Rung 3 — the `down` that deletes more than `up` created.**

```php
public function up()   { Schema::table('users', fn ($t) => $t->string('locale')->nullable()); }
public function down() { Schema::dropIfExists('users'); }   // copy-paste from a create migration
```

`up` is rung 0; `down` is rung 3, and rollback is exactly when nobody reads carefully. The
round-trip's schema compare catches it [M1]. Item 6 fails; fix pattern `mirror-down`.

**Rung 4 — found in the deploy log.** A branch reopened for "a follow-up" carries a migration
the deploy log shows already applied to production last week. Whatever its body does, the
verdict is ESCALATE `ran-on-real-data`: a second run, a rollback or an edit to an applied
migration are all repairs to live data, and repairs are a human's decision.

---

## 2. Reading a migration

- **Read `up` and `down` together.** A migration is a pair; half of one is not reviewed.
- **Look for the implicit.** A `->change()` restates the whole column; an ORM's generated diff
  can carry drift nobody asked for; a raw `DB::statement()` runs without the schema builder's
  guards.
- **Look outside the migration directory.** Seeders that run in production, console commands
  that fix data, boot hooks that write — all change data without passing the no-new-migrations
  gate.
- **Split what you read into DDL and DML.** They fail differently: DDL on MySQL/MariaDB commits
  implicitly and cannot be rolled back [S4]; DML inside a transaction can.

---

## 3. Engine behaviour that decides verdicts

The deploy engine decides. The test engine only decides whether CI is green.

### 3.1 Locking and online DDL — MySQL and MariaDB

- **Three algorithms.** `INSTANT` changes metadata only; `INPLACE` works on the table without a
  full copy and may allow concurrent DML; `COPY` rebuilds the table and blocks writes [S1].
  Name the algorithm the engine will pick for each statement.
- **Instant column add.** Default since MySQL 8.0.12; at any position since 8.0.29 [S1]. MariaDB:
  last column only from 10.3.2, any position from 10.4 [S7].
- **Instant column drop.** Default since MySQL 8.0.29 [S1]; MariaDB 10.4+ [S7].
- **Changing a column's data type** is `COPY` only on MySQL — the table is rebuilt and concurrent
  DML is not permitted [S1]. MariaDB does not support it `INSTANT` in most cases [S7].
- **`NOT NULL` on an existing column** is an in-place rebuild, needs strict SQL mode, and fails
  if the column holds `NULL` [S1].
- **Metadata locks.** Even an online operation takes an exclusive metadata lock briefly, and
  waits for transactions already holding the table to finish; while it waits, **it blocks every
  later transaction on that table** [S2]. The practical risk is not the DDL's run time, it is a
  forgotten long transaction turning a one-second change into an outage. Item 5 names it.
- **Size matters more than shape.** A `COPY` on a thousand rows is nothing; on a hundred-million
  row table it is hours of blocked writes. When the repo does not record table sizes, estimate
  and say so. Past what a maintenance window absorbs, the fix pattern is `online-schema-tool`.

### 3.2 What happens to existing rows

- **Implicit defaults.** A `NOT NULL` column without an explicit default takes the type's
  implicit default: `0` for numbers, `''` for strings, the "zero" value for dates [S3]. Adding
  such a column to a populated table fills every row with it. Measured on MariaDB [M1].
- **Type conversion.** `ALTER TABLE` converts existing values "as well as possible" and warns
  that this may alter data; strict SQL mode makes a *truncating* conversion fail [S6]. Converting
  into an integer or `DECIMAL` column rounds half away from zero [S5] — a change of value, not a
  truncation, and one that succeeded on MariaDB in the fleet measurement [M1].
- **Foreign keys over existing rows.** With `foreign_key_checks` on, adding a constraint over
  orphan rows fails; with it off, the constraint is added and orphans are never checked, not even
  when checks are turned back on [S8]. Measured: an FK over orphans rejected on MariaDB, and
  green on empty tables [M1]. Either outcome is a finding: a failure part-way through a deploy,
  or a constraint that lies.
- **Unique indexes over existing rows** fail on the first duplicate. Count duplicates before,
  not during. `NULL`s are not duplicates: a unique index permits many `NULL`s in a nullable
  column [S13].

### 3.3 SQLite-vs-deploy-engine traps

Tests often run on SQLite; production rarely does. The two disagree in both directions:

| Behaviour | SQLite | MySQL / MariaDB |
|---|---|---|
| Add `NOT NULL` without default to a populated table | fails [S9] | succeeds, fills implicit default [S3][M1] |
| Column types | flexible typing — a value keeps its own type unless the table is `STRICT` [S11] | enforced, values converted [S6] |
| Decimal → integer | no rounding enforced by the column | rounds half away from zero [S5][M1] |
| Foreign keys | off by default per connection [S10] (a framework may turn them on) | on by default [S8] |
| DDL inside a transaction | transactional | implicit commit, not rolled back [S4] |
| Constraint checks on `ADD COLUMN` | `CHECK` and `NOT NULL` tested against existing rows since 3.37.0 [S9] | per statement |

**A green SQLite run proves nothing about the deploy engine.** Item 3 exists because of this
table, and item 10 needs the deploy-engine leg.

### 3.4 DDL is not transactional on MySQL/MariaDB

A migration with three `ALTER`s that fails on the third leaves the first two applied: each DDL
statement commits implicitly [S4]. The migrations table does not record the migration as run, so
a retry replays statements that already happened and fails differently.

Split a migration when **a later statement can fail on rows that already exist** — a constraint
over data, a type change, a `NOT NULL` — after an earlier one has committed. That is the fix
pattern `one-ddl-per-migration`. Statements that cannot fail on existing data (a new nullable
column, then an index over it while every value is `NULL`) may share a migration; splitting
them buys nothing.

---

## 4. Reversibility

- `down` undoes **exactly** what `up` did. It drops what `up` added and restores what `up`
  changed — no less, and no more.
- Restoring a *shape* is not restoring *data*. A `down` that re-adds a dropped column brings back
  an empty column. If `up` destroys data, `down` cannot return it; the migration is irreversible
  whatever `down` says. Name where the data could be recovered from (a backup, an archive table
  written by `up`), or treat it as rung 3.
- A `down` that throws "irreversible" is honest and acceptable on rung 0–2 when there is a
  reason; a `down` that silently does something else is not.
- The round-trip job exercises `down` on seeded data [M1]; read its schema compare.

---

## 5. Expand → migrate → contract

During a deploy, old code and new schema coexist, and so do new code and old schema if a
rollback happens. A change is safe to roll out when both pairings work.

1. **Expand** — add the new thing alongside the old: a nullable column, a new table, a new
   index. Old code ignores it.
2. **Migrate** — write both, backfill, switch reads to the new thing. Several deploys, if needed.
3. **Contract** — once nothing reads the old thing, remove it, in a later release.

What breaks it: renaming a column running code reads (old code fails the moment the migration
runs); dropping a column in the same release that stops reading it; adding `NOT NULL` before
every writer sets the value. Fix pattern `expand-contract`.

---

## 6. Backfills

- **Batched** by primary key range, small enough that one batch holds locks briefly.
- **Idempotent** — running it twice gives the same result; a restart after a crash is safe.
- **Separate from the DDL** on large tables. A table-rebuilding `ALTER` and a full-table
  `UPDATE` in one migration hold locks for the sum of both, and a failure in the second leaves
  the first committed [S4].
- **Not reading the model.** A backfill that goes through the application's current model can
  break when the model changes later; read and write the table directly.

Fix pattern `batched-backfill`.

---

## 7. Generated migrations

- **`->change()` on Laravel 11 and later drops every modifier you do not restate** — `nullable`,
  `default`, `unsigned`, `comment` [S12]. A one-word type change can silently make a nullable
  column `NOT NULL`; measured red on both engines over `NULL` rows [M1]. Fix pattern
  `restate-modifiers`.
- **Schema-diff tools** emit what differs, including drift the author did not intend. Read the
  diff as SQL and check each statement against the issue.
- **ORM migrate commands** that have no `down` (Prisma Migrate is one) cannot round-trip; the
  proof is a drift check against the deploy engine instead [M1].

---

## 8. What a green CI proves

The handbook's round-trip job migrates from zero, rolls back the branch's migrations, seeds rows
at the pre-change schema, migrates again, and compares the schema — on the test engine and on the
deploy engine at production's version [M1]. Read a green result for what it covers:

- **It proves** `up` and `down` run on both engines, `down` restores the schema, and the
  migration survives the rows the seeder wrote.
- **It does not prove** anything the seeded rows do not exercise — on empty tables the data
  traps (FK over orphans, lost `nullable`, lossy conversion, implicit fill) are green on both
  engines [M1], and a table seeded only with rows that avoid the trap is no better. Check the
  seeder writes the rows this migration can hurt: a `NULL` for a nullability change, an orphan
  for a new foreign key, a duplicate for a unique index, a long value for a narrowing.
- **It does not prove** locking behaviour at production size, rollout order, or intent.
- **Pending is not green.** Wait for it.
- **A deploy-engine leg at the wrong version proves nothing about production** [M1].

---

## 9. Sources

Checked on **2026-09-30** unless a row says otherwise. Recheck a source before relying on it for
a version newer than the one it documents.

| Id | Source | Claim it supports |
|---|---|---|
| S1 | MySQL 8.0 Reference Manual, *Online DDL Operations* — <https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html> | Algorithm per operation; instant add default since 8.0.12, any position since 8.0.29; instant drop default since 8.0.29; type change `COPY` only, no concurrent DML; `NOT NULL` needs strict mode and fails over `NULL`s |
| S2 | MySQL 8.0 Reference Manual, *Online DDL Performance and Concurrency* — <https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-performance.html> | Exclusive metadata lock waits for open transactions; a pending one blocks later transactions |
| S3 | MySQL 8.0 Reference Manual, *Data Type Default Values* — <https://dev.mysql.com/doc/refman/8.0/en/data-type-defaults.html> | Implicit defaults: `0` numeric, `''` string, "zero" dates |
| S4 | MySQL 8.0 Reference Manual, *Statements That Cause an Implicit Commit* — <https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html> | DDL (`ALTER TABLE`, `CREATE INDEX`, …) commits implicitly |
| S5 | MySQL 8.0 Reference Manual, *Rounding Behavior* — <https://dev.mysql.com/doc/refman/8.0/en/precision-math-rounding.html> | Values stored into `DECIMAL`/integer columns round half away from zero |
| S6 | MySQL 8.0 Reference Manual, *ALTER TABLE Statement* — <https://dev.mysql.com/doc/refman/8.0/en/alter-table.html> | Type change converts existing values and may alter data; strict mode stops truncating conversions |
| S7 | MariaDB Knowledge Base, *InnoDB Online DDL Operations with the INSTANT Alter Algorithm* — <https://mariadb.com/kb/en/innodb-online-ddl-operations-with-the-instant-alter-algorithm/> | Instant add last column from 10.3.2, any position from 10.4; instant drop from 10.4; type change not instant in most cases |
| S8 | MySQL 8.0 Reference Manual, *FOREIGN KEY Constraints* — <https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html> | With `foreign_key_checks` disabled, constraints are ignored and re-enabling does not scan existing rows |
| S9 | SQLite, *ALTER TABLE* — <https://www.sqlite.org/lang_altertable.html> | Added `NOT NULL` column needs a non-null default; `CHECK`/`NOT NULL` tested against existing rows since 3.37.0 |
| S10 | SQLite, *Foreign Key Support* — <https://www.sqlite.org/foreignkeys.html> | Foreign keys disabled by default, enabled per connection |
| S11 | SQLite, *Datatypes In SQLite* — <https://www.sqlite.org/datatype3.html> | Flexible typing; `STRICT` tables since 3.37.0 |
| S12 | Laravel 11 upgrade guide, *Modifying Columns* — <https://laravel.com/docs/11.x/upgrade> | `->change()` drops every modifier not restated |
| S13 | MySQL 8.0 Reference Manual, *CREATE INDEX Statement* — <https://dev.mysql.com/doc/refman/8.0/en/create-index.html> | A `UNIQUE` index permits multiple `NULL` values in a nullable column |
| M1 | Measurement on one fleet, 2026-08-31 to 2026-09-30, recorded in this repo: [templates/README.md, *Migration round-trip*](../../templates/README.md#migration-round-trip--what-the-laravel-job-proves-and-what-it-cannot), the round-trip template's commit, and the reviewer-role epic (#396) | On a real Laravel 13 app, seeded: `NOT NULL` without default red on sqlite, green on MariaDB filling `''`; `->change()` losing `nullable` over `NULL` rows red on both; a `down` dropping more than `up` added red at the schema compare; three SQLite-green migrations unsafe on MariaDB — `''` fill on `NOT NULL`, FK over orphans rejected, decimal → integer rounding money; all data traps green on empty tables; 15 human grants in the month, none refused |
