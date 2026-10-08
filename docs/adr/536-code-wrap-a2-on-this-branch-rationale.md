# code-wrap a2-on-this-branch: why, with the measurements

Moved from [`skills/code-wrap/a2-on-this-branch.md`](../../skills/code-wrap/a2-on-this-branch.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a doc committed on trunk is a defect

The distill is prose, it feels like
housekeeping rather than code, and the trunk checkout is where this session's process
cwd already is — which is exactly how one got committed straight onto trunk. What
happens next is not a tidiness problem: `colab ship` merges a *branch*, so it has no
path for a commit already sitting on trunk, and the session that made one is left with
a push its own repo refuses and a guard whose message used to name the variable that
defeats it. Two sessions walked that route in a single day.
