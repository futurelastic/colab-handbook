# code-wrap a3-read-the-verdict: why, with the measurements

Moved from [`skills/code-wrap/a3-read-the-verdict.md`](../../skills/code-wrap/a3-read-the-verdict.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the gate output is filtered

On a repo with a real suite, the gate's raw output is not a rounding error next to
`CLAUDE.md` — measured on one mature repo, 366,594 bytes (~104,700 tokens) of
combined stdout+stderr against a 113,989-byte `CLAUDE.md`, at 3,212/3,213 green.
The volume is structural, not a sign of trouble: a TAP-style runner emits a
`# Subtest:` line **and** an `ok N` line per assertion, so it scales with
assertion count — which every convention here encourages growing. And it does not
cost once: gate output joins the cached prompt prefix, so a run at turn 10 of a
40-turn session is re-read on every turn after, not paid for a single time.

