# code-wrap · A2 Issue-keyed naming (gotchas, ADRs)

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Issue-keyed naming — the fix for any sequential-counter document (gotchas, ADRs)

Both gotchas and ADRs used to accrete into a **single file with a shared
sequential counter**: numbered sections cited elsewhere by number.

The fix is one convention applied to both, not two conventions that drift
apart: **key the filename on the issue number, never a sequence.**
`<issue-number>-<slug>.md`, one entry per file, append-only — never edit
another entry's file. No shared counter, so no merge contention and nothing to
ever renumber; the issue number is a stable id citations can use across
renames; two parallel branches adding an entry each touch a different file,
never the same line.

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

Why: [ADR 536](../../docs/adr/536-code-wrap-a2-issue-keyed-naming-rationale.md).
