# code-triage §3 group naming: why, with the measurements

> **Superseded in part by [ADR 630](630-shared-files-start-in-parallel.md) (2026-10-19):** a shared file alone no longer groups or serialises; only issues that change the same logic do, and only `contention.coupled` paths hold a start. The text below is kept as the record.

Moved from [`skills/code-triage/3-group.md`](../../skills/code-triage/3-group.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why sloppy naming defeats the skill

The failure this whole skill exists to prevent, re-created by
sloppy naming.
