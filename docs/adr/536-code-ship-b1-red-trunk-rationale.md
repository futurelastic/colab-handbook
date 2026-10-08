# code-ship b1-red-trunk: why, with the measurements

Moved from [`skills/code-ship/b1-red-trunk.md`](../../skills/code-ship/b1-red-trunk.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the patch and the bystander are told apart

Measured: a trunk turned red on a
docs-only merge — a test deferring against a hardcoded date that real time walked past,
a calendar bomb, no branch's regression. Of three waiting branches, the one whose
parent was the red sha and which fixed the clock opened a PR, ran green and
cure-merged; the two bystanders stayed parked, correctly, and shipped once trunk was
green.
