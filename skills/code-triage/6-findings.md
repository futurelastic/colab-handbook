# code-triage · §6 Findings and the limits lines

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

Then, **findings** — group-level, so they are not a bucket and do not compete with the
rule below. One block per group that broke the one-branch contract (§3):

```
FINDING group:panel-fidelity — 3 live branches in one group (contract: one)
        members:  #210 #211 #213 #216 #220 #222 (6 open)
        collide on: src/ui/PanelView.tsx, src/i18n/messages/panel.ts
        carrier:  fix/panel-fidelity-210-211-213  (covers 3 members, cargo)
        then:     feat/panel-beat-216 (1), fix/panel-i18n-220 (1)
        land one at a time: each rebases onto trunk AFTER the carrier lands
        seen-at:  trunk e31a896, 2026-09-06T09:12Z
```

A group that already has a live carrier gets **`continue:`**, naming that ref — never a
`start:` line minting a second worktree. `colab worktree new` refuses an existing branch
anyway (#124, and `--force` does not override it), so a `start:` there would hand the
reader a command the CLI is guaranteed to reject:

```
FINDING group:import-fixes — 2 live branches in one group (contract: one)
        carrier:  fix/import-fixes-115-114  (covers 2 members, cargo)
        continue: resume the carrier — code-start step 3, "Found one → continue it, or ask"
        then:     fix/import-delimiter-113 (1) rebases after it lands
```

**Print the limits line on every pass, including a clean one** — the same discipline
`colab worktrees` applies to its orphan scan ("a clean result answers 'none THERE', not
'none anywhere'") and `colab holders` applies to a failed fetch. A findings section with
nothing in it is not a guarantee, and must not read as one:

```
findings: none — no second live branch in any group AT PASS TIME (trunk e31a896).
  Blind to: a branch created after this pass ended (caught on the next ping — a pushed
  sibling ref moves §0's `branches` digest, so the next ping cannot short-circuit); an
  unpushed branch on another machine; a ref whose name carries no open member number
  (the `colab holders` net covers this only where the group's `Because:` line names a
  path); a group whose evidence line names no path at all.
```

Never write a stronger promise than that line. Triage does not poll, so it cannot detect a
second branch mid-flight, and a report implying otherwise is worse than one that says what
it missed.

**Switch findings** (§2, *A switched epic*, #340) print in the same section, one block
each. They are findings for a human's decision, not blockers, so the bucket lists above
stay unchanged:

```
FINDING switches — 4 unfinished switched epics (policy: at most ~3; CONVENTIONS §5 rule 6)
        unfinished: bulk-import (since 2026-08-02), bulk-export (2026-08-20),
                    sso-rewrite (2026-08-29), audit-log (2026-09-10)
        decide:     finish or drop one before another epic's add child lands
FINDING switch:bulk-import — unfinished 44 days (policy: ~4 weeks; rule 6)
        added by:   #43 (merged 2026-08-02)   remove child: #47 open
FINDING switch:bulk-export — needs=bulk-import, but remove child #58 has no blocked_by on #47 (rule 3)
FINDING switch epic #60 — marker not cleared: role=enable on #61 (closed set: add · remove)
```

The switch read gets its own limits line on every pass, including a clean one and an
out-of-scope one:

```
switches: 2 declared, 1 unfinished (bulk-import, 12 days) — AT PASS TIME (trunk e31a896).
  Blind to: an epic without the `epic` label; a child linked by a checklist line instead of
  a native sub-issue; children past the first 50 (report `totalCount` when it is higher);
  an age crossing 28 days on a §0-unchanged ping, because nothing in the fingerprint moves
  with the calendar, so the next full pass reports it.
switches: not checked — exposure: self (CONVENTIONS §5 Switched epics binds `released` only)
```
