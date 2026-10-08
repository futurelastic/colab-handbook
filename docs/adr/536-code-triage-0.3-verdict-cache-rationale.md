# code-triage 0.3-verdict-cache: why, with the measurements

Moved from [`skills/code-triage/0.3-verdict-cache.md`](../../skills/code-triage/0.3-verdict-cache.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the per-issue map is pruned on every write: the 61 KB sweep cache

This is the exact defect #244
found and fixed for `colab-sweep.json` (61 KB, 24 accumulated ad-hoc keys), arriving here by
a different route — a per-issue cache has one entry per open issue on the backlog by
construction, not one per issue this repo has ever had.
