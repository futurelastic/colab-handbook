# code-ship b0-sync: why, with the measurements

Moved from [`skills/code-ship/b0-sync.md`](../../skills/code-ship/b0-sync.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the already-shipped grep comes before grading

Measured: 3 of 8 candidates in
one repository's ship queue were already on trunk; one read CONFLICT only because its own
content was already there, and grading it would have spent a full review on nothing.

## Why a zero-diff deliverable needs its own close door

Measured: the claim was
released, the worktree torn down, and the issue stayed open until a human said in
prose that finishing with no commit was acceptable.

## Why a sync never pulls in a sibling's branch

Measured on a downstream session orchestrator, 2026-09-05 — its own ADR
on reorganising its ship lanes, section 2 L5: one branch in a `group:` label
carried **8 `chore(sync)` commits** pulling siblings' fixes ahead of their own trunk
merge. The cost is not the noise — it is that a branch holding a sibling's unlanded
commits can no longer land independently of that sibling, so each waits on the other and
neither converges, while both keep burning CI rebasing around each other. The commit
message shape above is exactly the one that failure wore, which is why this paragraph
sits under it.
