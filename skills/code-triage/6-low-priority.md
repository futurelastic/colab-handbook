# code-triage · §6 Rank `low-priority` groups last

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


`low-priority` is read three different, undocumented ways by the tools sitting around
this skill unless this check runs: a hard veto by one scheduled driver, a sort key
nothing enforces by a sibling tool, and — before this check existed — invisible to
`code-triage` itself, which reported a `low-priority` group **READY** with no
distinguishing signal at all. The convention (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#priority--a-throttle-not-a-veto-268), *Priority*) settles
which reading is correct: **`low-priority` orders a queue, it does not remove work
from one.**

For every ready or soft-ready group, check whether its lead issue carries
`low-priority`:

```sh
gh issue view <lead-issue> --json labels -q '.labels[].name' | grep -qx low-priority
```

- **Not a readiness gate.** Same posture as `needs-plan` and `mechanical-lane`: this
  label never blocks a group from being reported ready, and §5's gate is unaffected —
  it only changes where in the ranked list the group is printed.
- **Rank last, not off the list.** §4 already says this; this is the check that makes
  it mechanical instead of a judgement call re-derived per group. A `low-priority`
  group that also blocks other work (§4 rank 1) still says so in its `why:` line — the
  label moves its position, it does not erase the reasoning that would otherwise have
  ranked it higher.
- **Report it — one extra `priority:` line in §6, same shape as `mechanical:`.**
  Absent from every group not carrying the label — same discipline as `mechanical:`,
  present only on the minority that earns it.
- **A driver implementing the veto reading must say so where this check can be
  compared against it** — never leave the driver silently skipping what this report
  called ready. That disagreement is a finding to surface, not a difference to paper
  over by second-guessing the driver's behavior here.
