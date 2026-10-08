# code-triage · §6 Console output, and the `DRY` block

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**This report is console output, not a tracker write.** Print it to whoever is reading this
session; never post it, or any per-beat summary of it, as an issue comment. §0.2 names the
nine writes this skill is authorised to make — a narrative verdict is not one of them, even
when the verdict is genuinely new information. If a group's verdict changed in a way worth
recording durably, that lands through one of the nine named writes (the label, the evidence
comment, the plan/lane reason, a transcribed record), never through a fresh prose comment
invented for the occasion.

**A dry pass is a finding (#380).** When the ranked list is empty (no ready and no
soft-ready group), the report **opens** with that fact, before any bucket. It then lists
every open issue that is not taken, not an epic and not a close candidate, one line each:
the one thing that would make it startable, and who holds that thing. Its first line is fixed, so a reader cannot mistake it for a clean result:

```
DRY    0 of 22 open issues startable (trunk e31a896) — what unsticks each:
       #501  unchanged, waiting on <link> since 2026-09-22 (clears: <maintainer>)
       #502  nobody named — STALL
       #507  lift deferred:date, wake met — @maintainer — not asked
       #87   design session start — nobody claimed it — DESIGN, free
       all   trunk CI red at e31a896 (test job) — TRUNK RED: #512, filed this pass — patch unclaimed
```

- Each line is the same fact the matching blocked, taken, design or route line carries,
  reduced to *what* and *who*. It adds no judgement of its own, so every rule on those
  lines still applies. `STALL` and `WAKE` lines stay first.
- When one blocker holds every issue, as a red trunk CI does (§5), print it once as the
  `all` line instead of repeating it per issue. Once a `TRUNK RED:` issue exists — filed
  by this pass under §0.2 write 8, or already open — **the line names it**, and says
  whether its patch is claimed. Before it exists, the line names what it waits on: the
  scheduled driver's re-run in flight, or the §5.2 bound that stopped the filing. Triage
  still never re-runs the job (§0.2).
- `N` in the header counts every open issue. If none of them gets a line (all epics, all
  taken, or all route), the header still prints, followed by one line saying so.
- The `DRY` block is console output like the rest of §6. It is never posted to the tracker.

Why: [ADR 536](../../docs/adr/536-code-triage-6-console-and-dry-rationale.md).
