# code-triage 0-fingerprint: why, with the measurements

Moved from [`skills/code-triage/0-fingerprint.md`](../../skills/code-triage/0-fingerprint.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The measured cost of running §0 on every ping, and its three causes

**Measured, #244: this was not happening.** A six-week census of one adopting fleet found
code-triage's median run cost **24 tool calls (p90 40) over 1,722 runs** — 8x the
documented three — and code-sweep's median was **27 (p90 59) over 372 runs**. Neither
gap was read amplification (0 median duplicate file reads) or the skill body reloading
mid-run (well under one `Skill` invocation per run). Two causes, both fixed below: inputs 2
and 5 were broad enough to read "changed" on nearly every ping (a bare comment; any push
to any branch, including `code-wrap`'s routine backup push), and — found only once this
was traced against a real checkout — **the persisted record itself had no specified
shape**, so two model-executed runs stored two different partial things and the "cache is
never an authority" rule then correctly forced a full pass regardless of what moved. A
third cause is not fixable from inside this repo at all: nothing outside the executing
agent's own compliance verifies §0 ran, so a skipped §0 and a §0 that ran and found
genuine change are indistinguishable in a transcript. §0 below narrows what it can, and
gives the third cause a receipt instead of pretending to enforce it — see the outcome-line
and cache-record requirements after the fingerprint.
