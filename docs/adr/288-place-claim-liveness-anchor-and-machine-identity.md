# Place-claim liveness: caller-supplied anchor + hardware-bound machine identity

## Context

`tools/lib/place.js`'s liveness probe (`defaultProbe`/`isLive`) decided two different
questions with two raw comparisons, and both produced false signals:

- **Host** (#289): `rec.host !== os.hostname()` — a same-machine hostname read that
  drifted between acquire time and read time (e.g. mDNS `.local` form vs a
  network-registered FQDN) permanently mismatched, making the record read `live: null`
  ("foreign host") forever — never listed by `colab doctor`'s stale-place-claim pass,
  never `--prune`-able, and refusing any later re-acquire even from the same machine.
- **Pid** (#288): every write site passed `process.ppid` unconditionally as the
  liveness anchor, on the stated assumption that the parent shell outlives the
  acquiring `colab` CLI invocation. True for an interactive terminal; false for a
  caller that runs each command in a fresh short-lived shell per invocation (an agent
  issuing separate tool calls) — that shell exits within seconds, `procs.alive(rec.pid)`
  then reads `false`, and `colab doctor --prune` reaps a hold whose actual owning
  process (the long-lived agent session) is still very much alive.

Both defects sit in the same ~20-line predicate span and were filed together
(`group:place-claim-liveness`) because a fix to one changes what the other has to
assume is true about a record.

## Decision

**#289 — compare machine identity, not a hostname string.** New module
`tools/lib/machine.js`: a pure two-tier comparison — cheap hostname canonicalization
(case-fold, strip trailing dot, keep only the first label) resolves the ordinary drift
case; when both sides also carry a hardware-bound id (`ioreg`'s `IOPlatformUUID` on
darwin, the D-Bus machine id on linux, a MAC-address hash as the last resort,
memoized per process), that id decides exactly and is immune to hostname drift
entirely. A record with no `machine` field (every record written before this landed)
falls through to the canonicalized-hostname branch, which is strictly *more*
permissive than the raw string equality it replaces — no migration needed, and no
record that compared equal before can start comparing unequal now.

**#288 — an explicit, auto-detected liveness ANCHOR, not always `process.ppid`.** A new
record field `pidKind: 'anchor' | 'invocation'` distinguishes "this pid is the
long-lived process whose death means the work is over, safe to probe" from "this pid
is only a human-readable lead, never a liveness signal." `resolveAnchor()` decides per
acquire call, in order: an explicit `--pid <n|none>` / `COLAB_PLACE_PID` always wins;
otherwise an agent session's own long-lived process is adopted automatically via
`CLAUDE_PID`, but only after verifying it is both alive AND a proven ancestor of the
current invocation (`procs.isAncestor`, walking `ps -o ppid=`) — never merely trusting
the env var; failing that, an agent shell (`CLAUDECODE`/`AI_AGENT` set) with nothing
provable fails CLOSED (`pidKind: 'invocation'`, kept as a lead, never probed); every
other caller keeps today's exact default (`ppid`, probed normally). A `'invocation'`
hold is surfaced, not silent: `colab doctor` gained a report-only `unprovablePlaces`
section (mirroring `stalePlaces`) so an abandoned one is visible to a human instead of
accumulating invisibly.

## Alternatives rejected

- **Blanket "never trust a recorded pid for liveness" (`live: null` always).** Rejected
  — this would make `colab doctor --prune` never remove *any* place-claim, so every
  ordinary crashed interactive session leaves a permanently `unknown` hold that refuses
  future acquires at exit 2. That is #289's own complaint (permanently unprunable,
  invisible, human-only to clear) reintroduced for every caller, not just the one #288
  reports.
- **Match on pid for `conflict()`'s exemption too.** Explicitly rejected, and this
  decision changes nothing about it: `conflict()`'s existing rule (#242) — only a
  matching, non-blank `session` exempts a re-acquire, pid is a message-only
  `likelySelf` hint — stays completely untouched. `resolveAnchor` governs a different
  question (may a pid ever be *probed* for liveness) from #242's (does a pid ever
  *exempt* a re-acquire), and conflating them was the exact hazard #242 already ruled
  out via a falsifier run (two `colab place acquire` calls from separate tool-call
  shells recorded two different pids).
- **A generated machine-id file under `~/.colab` for #289**, or a persisted alias set
  of hostnames a machine is known to answer to. Rejected — a file under `~/.colab`
  inherits exactly the sync hazard the foreign-host branch exists to backstop: if
  `~/.colab` itself is synced (the hazard `syncedStateProblem` already refuses), two
  machines would read the *same* generated id and the backstop silently disappears. A
  hardware-bound id cannot travel over a file sync by construction.
- **A state.json migration** for either fix. Rejected for both — every change had to
  work by construction against records with neither `machine` nor `pidKind` (the
  absence read as today's exact prior behaviour, or strictly more permissive), because
  `~/.colab/state.json` is real, unmigrated data spread across the fleet.

## Consequences

- An agent session (Claude Code) now gets a correct liveness anchor with **no recipe
  change** — `CLAUDE_PID` auto-detection covers it. A caller that spawns a detached
  long-lived job and exits still needs to pass `--pid <n>` explicitly; auto-detection
  does not cover that shape.
- Two *different* machines whose short hostnames happen to collide, and that have no
  `machine` id recorded on either side, would now compare as the same machine. Bounded:
  this only matters when `~/.colab` is synced across them, which `syncedStateProblem`
  already refuses at every acquire site, and any record written after this change
  carries an exact hardware id (strictly stronger than today's comparison).
- Records already stuck by host drift before this landed self-heal on the next read —
  they become local again, get probed normally, and a genuinely dead one becomes
  prunable for the first time. Records already written by a short-lived agent shell
  keep no `pidKind` and are still treated as `'anchor'` (today's exact prior
  behaviour) — they can still be wrongly pruned once, but any newly-acquired hold from
  the same caller shape is fixed going forward.
- `colab doctor`'s output gained a new, non-actionable-by-default report section
  (`unprovablePlaces`) — never counted toward "issues" or the exit code, purely a
  visibility aid pointing at `COLAB_HUMAN=1 colab place release "<path>"`.

Full design writeup (test oracle, file-by-file diff plan): the planning pass for this
work is preserved in the wrap comment on #288/#289; the plan file itself
(`.claude/plans/issue-288.md`) is session-local and does not survive teardown.
