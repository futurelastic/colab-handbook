# code-triage 0-wakes-and-red-trunk: why, with the measurements

Moved from [`skills/code-triage/0-wakes-and-red-trunk.md`](../../skills/code-triage/0-wakes-and-red-trunk.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The measured red trunk that stayed unowned for about 40 minutes

Measured: a trunk went red on a
re-run (code unchanged, live data drifted, a static check failed). A session filed the
diagnosis as an issue, but the title had no `TRUNK RED:` prefix and the issue was
`agent-filed`. Two triage pings in the next ~25 minutes printed `unchanged` and stopped.
Every ship candidate in the repo stayed parked on "trunk red has no owner" for about 40
minutes, until someone outside triage retitled the issue and accepted it.
