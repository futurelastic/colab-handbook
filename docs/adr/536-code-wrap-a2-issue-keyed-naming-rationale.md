# code-wrap a2-issue-keyed-naming: why, with the measurements

Moved from [`skills/code-wrap/a2-issue-keyed-naming.md`](../../skills/code-wrap/a2-issue-keyed-naming.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a shared sequential counter breaks

That shape
breaks identically for either kind of entry, and it was measured breaking for
gotchas first: on the busiest repo, `docs/gotchas.md` reached ~15KB and dozens
of entries, the renumber procedure this forced had to be re-explained verbatim
in 8 separate session briefs in one week, and every renumber silently
stale-dates every existing `§N` citation elsewhere in the repo, with no error.
An ADR directory numbered sequentially (`0001-`, `0002-`, …) has the same
failure mode for the same reason: two parallel branches each adding "the next
one" pick the same number, and one silently loses its identity at merge.

## Where the issue-keyed shape is already proven

Already proven this way on two repos in the fleet —
`docs/gotchas.d/` carries ~96 entries on the busiest of them.
