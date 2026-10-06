# code-wrap · A2 Every doc lands on this branch, never on trunk

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**Every one of these lands on THIS BRANCH, in your worktree. A commit on the trunk
checkout is a defect, not a shortcut** (#322). The distill is prose, it feels like
housekeeping rather than code, and the trunk checkout is where this session's process
cwd already is — which is exactly how one got committed straight onto trunk. What
happens next is not a tidiness problem: `colab ship` merges a *branch*, so it has no
path for a commit already sitting on trunk, and the session that made one is left with
a push its own repo refuses and a guard whose message used to name the variable that
defeats it. Two sessions walked that route in a single day. Write docs with **absolute
worktree paths**, commit them in A4 with everything else, and let them reach trunk the
one way anything reaches trunk.
