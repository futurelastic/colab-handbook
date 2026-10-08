# code-ship b4: why, with the measurements

Moved from [`skills/code-ship/b4-teardown.md`](../../skills/code-ship/b4-teardown.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why removal is the default

Finished-but-not-removed worktrees are the single
most-skipped step we measured (8 of 9 sessions, 2.9 GB) — and the permissive
"(optional)" this step used to open with is what produced that miss rate.

## The jq failure mode the chained delete replaced

Measured failure mode this
  replaces: `jq` missing → the old `$(jq …)` command substitution failed, `printf` still
  wrote a bare newline (exit 0) into the journal, and the un-chained `rm -f "$PLAN"` on the
  next line still ran — the plan file was gone with no journal line to show for it.
