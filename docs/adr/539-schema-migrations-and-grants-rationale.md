# `migrations`, `migration-grant` and `trust-humans`: why

Moved from [`project.schema.md`, *`migrations`*](../../project.schema.md#migrations--optional) and [*`migration-grant`*](../../project.schema.md#migration-grant--optional) and [*`trust-humans`*](../../project.schema.md#trust-humans--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `migrations` exists

Without it, a repo whose migrations live anywhere else (a Node service's boot migrations in
`backend/migrations/`, a Go service's `migrations/`) is invisible to the gate: `colab ship --dry`
reported `no new migrations ✓` on a branch adding a production data backfill, and the human-only
grant never engaged. Measured on an adopting repo before this key existed.

## Why `migrations` has no opt-out of the defaults

an opt-out can only make a human-only gate see *less*, and that waits for a repo that
genuinely needs it

## Why a schema file is a `migrations:` entry, not a new key (#673)

A repo whose server applies its schema inline (one file running `CREATE`/`ALTER TABLE` at
start-up) had no layout to declare, and the grant gate fails closed without one (#671), so on a
route where a hand cut refuses, its only release was a raw tag push outside every check. An entry
without a trailing `/` now means "this path, or anything under it". That kept the list's shape,
and every `backend/migrations` already declared without a slash means what it meant before. The
alternative, letting the grant alone clear a repo with no layout, would have reversed #671's
rule that a final with nothing read is a human's act.

## Why "no migrations" is a `none:` block with a reason (#672)

A repo whose data lives behind another service's API has no schema at all, so after #673 it still
had nothing to declare, and #671's fail-closed gate left `--auto` no way to release it. A
declaration that the repo has none turns "cannot see" into "nothing to read", but it is the one
`migrations:` value that makes the gate see less, so it carries two brakes. The reason is required,
and it sits in the same block as the declaration, so it cannot drift away from it the way a sibling
key could (the CLI's YAML reader has no flow maps, which rules out an inline form). The guard is
measured, not trusted: a Laravel or Prisma migrations directory at the commit contradicts the
declaration, and every cut and the audit refuse it. Relaxing the human-final policy for a hand cut,
the other way out the issue proposed, was dropped, because once this lands it gains nothing.

## Why `migration-grant` is a separate flat key

`migrations:` stays a list of path prefixes because three readers depend on that shape.
Where the gate looks and who may open it are unrelated settings.

## Why `trust-humans` is declared when agents have their own account

The association class (`OWNER`/`MEMBER`/`COLLABORATOR`) cannot tell that account from a
person, so without the list an agent-posted grant reads as a human's.

## Why `trust-humans` is a flat key

The audit's descriptor reader refuses nested shapes on purpose, and a list inside a map is
one of them.

## Why a malformed `trust-humans` means nobody is human

Falling back to the association class would quietly reopen the hole the key was declared to
close.
