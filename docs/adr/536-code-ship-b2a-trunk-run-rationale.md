# code-ship b2a: why, with the measurements

Moved from [`skills/code-ship/b2a-trunk-run.md`](../../skills/code-ship/b2a-trunk-run.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The trunk run that went red 19 s after the evidence

Measured 2026-09-25 on one repository: the
coordinator merged, then posted `colab:evidence` and `colab:grade verdict=pass` on both
carried issues **19 s after** the trunk run for its own squash had completed red (2 failing
tests of 929, `red:finding`). No `TRUNK RED:` issue was filed, and the red sat unnoticed for
~40 min until something else happened to open the run.

## The failure was one of order

The measured failure was one of **order**, not of skill. The coordinator could read a red
run perfectly well; it wrote "pass" 19 s before the red it had caused existed.
