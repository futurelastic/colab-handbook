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
