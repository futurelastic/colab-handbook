# A hot file is filed by triage itself — a ninth write, not a hand-off

## Context

Across adopting repos, one path repeatedly held three or more waiting issues behind the
file-contention brake: a ledger every change appends to, a size-budget file, a page
component and a stylesheet each thousands of lines long. Every time, a human or a watch
noticed; triage did not. Triage already saw each collision one issue at a time (§5's file
gate, §3's `Touches:` append), but nothing counted collisions per path.

`code-triage` §0.2 makes its tracker writes an exhaustive list. Filing a structure issue
was not on it, so the rule had to decide where that write lives: a new triage write, or a
hand-off to an issue-filing skill.

## Decision

A ninth triage write: `HOT FILE: <path> — <N> issues wait on it`, labelled `agent-filed`,
read before filing by path across all states (open or closed `not planned` ⇒ nothing;
closed `completed` ⇒ a new episode only at a newer trunk sha), with no `blocked_by` edge and
no `priority:*` label. An open issue already restructuring the path counts as the structure
issue; when that issue is itself waiting on the path, triage prints a `self-deadlock`
finding and files nothing.

## Why not a hand-off

- The issue-filing skill that wires epics and edges is not part of this handbook, so a
  portable skill cannot depend on it.
- A hand-off is "triage prints, someone else files" — the exact failure measured.
- The structure issue needs none of that skill's tree wiring: file contention is never an
  edge, so it has no edges to wire.
- Write 8 (`TRUNK RED:`) is the precedent: a bounded, measurement-only filing, keyed for
  idempotence. A path key works the same way a sha key does.

## Consequences

- Write 8's four bounds moved from the triage core to `skills/code-triage/5.2-trunk-red.md`
  so the core stays within its 400-line budget.
- A `colab` counter for `Touches:` paths across open issues would make the count
  mechanical. It is not built; the measurement is prose until one is wanted.
