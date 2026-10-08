# code-sweep 1.3-remote-refs: why, with the measurements

Moved from [`skills/code-sweep/1.3-remote-refs.md`](../../skills/code-sweep/1.3-remote-refs.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## The pile of spent refs on origin, measured

Measured on this repo, 2026-09-12: 54 branches on origin besides
`main`, carrying 39 issue numbers, every one of them CLOSED. Two days later there were 56.

## Why one `gh issue list` instead of a call per branch, measured

Measured while writing this section: 56 of 56 read as MISSING that way, 56 of 56
  as CLOSED with the one-call form.

## What `orphan-candidate` rows did before #352

Before #352 this row printed as `open-issue` and went nowhere.
