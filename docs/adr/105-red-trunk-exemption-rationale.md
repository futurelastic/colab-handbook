# Red-trunk exemption: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Red-trunk exemption — the one-shot door through trunk-CI-green (#105)*](../../CONVENTIONS.md#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a CI grant is more dangerous

Same shape as a migration grant, strictly **more dangerous** — a bad migration grant
merges one reviewed schema change; a bad CI grant merges into a repo whose own test suite
is known-failing.

## Why a reviewer role exists

The reviewer role exists because the maintainer ruled (2026-10-05) that the coordinator
owns a red trunk end to end, including this exemption, where the cure rule (below) still
refuses.
