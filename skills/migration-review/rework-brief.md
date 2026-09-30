# migration-review — the rework brief

Study material for the `migration-reviewer` role ([SKILL.md](SKILL.md)). A REWORK verdict is
only as good as the brief it leaves behind. The test: **can the author fix it without asking
the reviewer anything?** If not, the brief is not finished.

---

## 1. The brief format

One brief per failing checklist item, per migration. Four parts, always in this order:

```md
### <checklist item #[, #…]> <item name> — <path/to/migration.php>:<line>

**Risk.** <one sentence: what happens to which data, on which engine, when>

**Fix.** `<pattern-id>` — <one or two sentences applying the pattern to this migration>

**Proof.** `<the command whose output shows the fix works>`
```

- **One brief per defect.** When one defect fails several items (a dropped `nullable` fails 4
  and 9), write one brief and put every item number in its heading.
- **file:line** points at the statement that causes the risk, not the top of the file.
- **Risk** is one sentence, and it names the data and the engine. *"On MariaDB, every existing
  `shipments` row gets `carrier_code = ''`."* — not *"this could cause problems"*.
- **Fix** names exactly one pattern from the catalogue below and says how it applies here. It
  does not paste a rewritten migration; the author owns the code.
- **Proof** is a command the author can run, with the output that means success. Usually the CI
  round-trip on the deploy engine with a seeder row that exercises the case, sometimes a query
  against a copy of the data.

After the briefs, one line: **Re-review at the new HEAD.** The verdict was bound to the commit
reviewed; any fix is a new commit and a new review.

### An example

```md
### 4 Existing rows — database/migrations/2026_09_12_add_carrier_code.php:14

**Risk.** On MariaDB, adding `carrier_code` as `NOT NULL` with no default writes `''` into
every existing `shipments` row, and nothing downstream can tell `''` from a real code.

**Fix.** `nullable-then-backfill` — add the column nullable, backfill it from
`shipments.carrier_id` in a separate migration, then make it `NOT NULL` in a third once the
backfill has run everywhere.

**Proof.** `ROUNDTRIP_SEEDER=ShipmentsRoundtripSeeder` in the CI round-trip, with at least one
pre-change `shipments` row; the deploy-engine leg ends with `SELECT COUNT(*) FROM shipments
WHERE carrier_code = '' OR carrier_code IS NULL` returning 0.
```

---

## 2. What a brief must never do

- **Never offer a data-losing fix.** If the only route you can see drops the data, that is
  `no-preserving-route` — ESCALATE, not REWORK ([SKILL.md](SKILL.md#the-escalation-rule)).
- **Never ask the author a question in place of a fix.** "Is this column still used?" is a
  question for the issue thread before the verdict, not a brief.
- **Never invent a pattern.** If nothing in §3 fits, either the catalogue is missing an entry
  (add it, with a source, in a separate change) or the case is an escalation.
- **Never bundle unrelated style advice.** A brief is about data and availability. Naming
  conventions and code layout belong in an ordinary code review.

---

## 3. The fix-pattern catalogue

| Pattern id | Use when | What the author does |
|---|---|---|
| `explicit-default` | A new `NOT NULL` column has a value every existing row can truthfully take. | Declare that default in the migration, so no row receives an engine's implicit one. |
| `nullable-then-backfill` | A new required column's value must be computed per row. | Add it nullable → backfill in its own migration → add `NOT NULL` in a later one, after the backfill ran everywhere. |
| `widen-dont-convert` | A type change narrows or loses precision (decimal → integer, shorter text). | Keep or widen the type; convert at read time, or not at all. |
| `new-column-and-backfill` | The type really must change, and old values must survive. | Add a column of the new type, backfill with an explicit conversion the author chose, switch reads, drop the old column in a later release (`expand-contract`). |
| `clean-before-constrain` | A foreign key or unique index would meet orphan or duplicate rows. | A separate data migration resolves them first, then the constraint follows. It keeps every original value it changes — copied to an archive table or column, with the row's key — so the change can be undone; a fix that deletes or overwrites without that copy loses data. Counting the rows is the proof. |
| `restate-modifiers` | A `->change()` (or any regenerated column definition) omits modifiers the column has today. | Restate every modifier to keep — `nullable`, `default`, `unsigned`, `comment` — and check the generated SQL. |
| `mirror-down` | `down` does not undo exactly what `up` did. | Rewrite `down` as the inverse of `up`, statement for statement. |
| `declare-irreversible` | `up` destroys data `down` cannot restore, and the loss is already ruled acceptable. | Make `down` fail loudly, and name where the data can be recovered from. Only after a ruling; never a way around one. |
| `keep-and-deprecate` | A column or table is dropped by accident, or before every reader has stopped. | Keep it; stop writing it; drop it in a later release once nothing reads it (`expand-contract`). |
| `expand-contract` | Old and new code cannot both run against the schema during a deploy — renames, drops, new required fields. | Split into expand, migrate and contract steps across releases (playbook §5). |
| `one-ddl-per-migration` | A migration holds several DDL statements, and a later one can fail on existing rows after an earlier one committed (playbook §3.4). | One DDL change per migration, so a failure leaves a state the migrations table describes truthfully. |
| `batched-backfill` | A data move runs as one statement, or in the same migration as a rebuilding `ALTER` on a large table. | Batch by primary-key range, make it idempotent, move it out of the DDL migration. |
| `online-schema-tool` | A `COPY` or long in-place rebuild on a table too large or busy for the window. | Run the change through an online schema-change tool or a planned window, and say which in the migration's comment. |
| `lock-timeout-guard` | An `ALTER` on a busy table could wait on a metadata lock and block traffic behind it. | Set a short lock wait timeout for the migration's session and retry, rather than queueing indefinitely. |
| `add-roundtrip-proof` | CI's round-trip is missing, has no deploy-engine leg, runs the wrong engine version, or seeds no rows in a touched table. | Adopt the round-trip job from `templates/`, pin the deploy-engine version, and add seeder rows at the pre-change schema for every touched table. |

Every pattern here keeps the data. That is the difference between a REWORK and an ESCALATE.
