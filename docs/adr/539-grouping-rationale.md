# Grouping: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Grouping — issues that must share one branch*](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a group exists

**Issues that touch the same files must move on one branch** — the group is a
collision-prevention mechanism, not a tidiness preference.

## Why neither existing mechanism fits

**Neither existing mechanism has the right shape:** sub-issues are hierarchical (asserts
a false parent); mutual blocked-by would mean the readiness gate never reports either
member ready. A group needs a symmetric, flat relationship. A one-way `blocked_by` chain
is wrong too: it turns one shared branch and one review into one review cycle per member
(*File contention is never an edge*, under *Readiness* above, #371).

## Why the label object is torn down

...once every member is
closed** (#82) — one fleet repo accumulated ~12 stale `group:*` labels before this
existed.

## Why a sibling branch is never merged to borrow its fix

...a file-level group), because a branch carrying a sibling's unlanded commits cannot land
independently of it, and then neither converges.
