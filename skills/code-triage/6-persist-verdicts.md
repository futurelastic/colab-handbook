# code-triage · §6 Persist each verdict

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**`ceremony: light` repo? Skip this whole subsection** — same reasoning as §4's
single-issue mode: nothing unattended ever reads the column on a repo that cannot
also carry `autonomy: auto-trunk`, so the write is pure cost. Rank and report as
normal; just do not journal the marker.

A ranked report is what a *human* reads. The other consumer is event-driven
(§0): its status column moves only on a write this skill journals, and §4's
marker write is the one this whole-repo path forgot — so a flawless pass can
leave every verdict printed and none of it persisted, and the consumer stays
blind despite a fully-correct run. Do the §4 write here too, once per group,
keyed to which verdict §5.1 returned — this is the §4 rule lifted into the
whole-repo path, not a new one:

- **free (checked)** — no open blocker at all → write the marker for every
  member, exactly as single-issue mode does (§4):
  ```sh
  for N in 115 114 113; do colab readiness "$N"; done   # deps-checked + readiness.marked event
  ```
- **soft-ready** — startable, but its blocker is still open (code pushed,
  unmerged; §5.1) → **do not** write the marker. `deps-checked` means *no open
  blocker*, which is false here, and §5 rejected a second label for the soft
  case for exactly this reason: it is a read-time judgement, recomputed each run
  from the edge plus the blocker's state, never persisted. The report line
  carries the soft verdict; the graph does not.
- **blocked** — leave the marker unset, and clear a stale one
  (`colab readiness <N> --clear`) if a blocker opened since it was last set
  (§0.2 computes that staleness). Empty is the right machine state for "not
  free"; a `deps-checked` sitting on a now-blocked issue is the lie §5 warns of.

Prefer `colab readiness` over a raw `gh` edit for the reason §4 gives: colab
owns the write, so it is journaled and the `readiness.marked` event fires from
the same site — the single signal the event-driven consumer actually receives.

**The design bucket is persisted too, not only the ranked list (#380).** Every
unclaimed, unheld `delivery:design` issue gets the same three-way write, keyed to
its own §5.1 verdict (§2, *Non-code delivery*): free → `colab readiness <N>`,
blocked → unset (or `--clear` if stale), soft-ready → unmarked. It is off the
ranked list, but a design scheduler reads the same marker, so skipping it here
parks the design session and everything built behind it.

**This is also where §0.3's per-issue cache gets written, once per pass.** After the
`$CACHE` fingerprint and `conclusion` writes (§0.1), write the pruned `issues` map: one
`{key, group, bucket}` entry per issue still open at the end of this pass — reused
verdicts included, not just freshly-derived ones, since a reused verdict's key has not
changed and stays valid to compare against next pass.
