# Grouping: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Grouping*](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a group exists

Measured: a real triage run
concluded two issues MUST share a branch, printed the `file:line` collision, and had
nowhere to record it outside the terminal.

## Measured incident

Measured on a downstream session orchestrator, 2026-09-05 — its own ADR on reorganising
its ship lanes, section 2 L5 and section 7 item 7: one `group:` label, whose evidence line
named a single view component as the collision, held 6 open issues and 3+ live parallel
branches; two overlapped on that view component, its i18n message file and `CLAUDE.md`, and one
carried **8 `chore(sync)` commits** pulling siblings' fixes ahead of their own trunk
merge. They burned CI rebasing around each other and none converged. Nothing had read the
label: the dashboard's `planShipOrder` never consulted it, and its pairwise conflict check
is same-beat only.
