# A place-claim's holder is identified by its proven anchor process, as well as by its session string

## Context

A place-claim's ownership test was exact, non-blank string equality on `session`
(`place.js` `ownsHold`, and `conflict`'s same-holder exemption — one comparison, by
design). That string has to be reproduced, identically, by every later command of the
same session. Two measured failures say it cannot be relied on to be:

- **#306 (2026-09-04)** — a session claimed with its *name* in `--session` and
  released with its real URL. Genuine owner, refused, routed to `COLAB_HUMAN=1`. The
  fix was a write-time warning; the identity model was deliberately left alone.
- **#317 (coding-dashboard, 2026-09-05)** — the autopilot ship session
  `ship-coding-dashboard🤖` (pid 80601) recovered #1545 with a **no-worktree** claim,
  which minted a checkout hold under the identity `coding-dashboard-1545`. It shipped,
  then every later squash-merge on that repo was refused **by its own lock**.
  `resolveShipSession` (`tools/colab:7048`) resolves identity from the worktree record
  or a **branch-keyed** claim, and a no-worktree claim carries `branch: null` — so the
  claim that minted the hold was invisible to it and the ship presented a blank
  session. Blank never matches, including blank-against-blank (#242). Releasing
  another identity's hold needs `COLAB_HUMAN=1`, which an unattended session correctly
  would not set. **One merge in 8½ hours** on that repo; four had landed in the hour
  before. Cleared when a human ran `COLAB_HUMAN=1 colab place release <checkout>` at
  ~01:35. Meanwhile the dashboard's strike ladder read the idle session as `deaf` and
  hit `409 unsafeToEvict` 25 times.

The string was never the durable fact about that session. The **process** was — and
since #288 the module already records one properly: `resolveAnchor` adopts an agent
session's long-lived `claude` process only after checking it is alive **and a proven
ancestor** of the invocation, and fails closed to a never-probed `'invocation'` pid
when nothing is provable.

The obvious move — "match on `pid`" — is the one #242 measured and rejected, and that
rejection is written into `place.js`'s doc comments as `⚠ NEVER`, into `CONVENTIONS.md`
("**A `pid` is process lineage, not a session**"), and into #306's own alternatives.
Reopening it blind would exempt a genuine conflict, which is the one failure mode this
primitive must never have.

## Decision

**A hold whose PROVEN anchor process contains this invocation is this caller's own —
in addition to, never instead of, the session string.**

1. `resolveAnchor` reports a new `proof`, stored by `holdRecord` as `anchorProof`:
   `'declared'` (rule 1, `--pid <n>`/`COLAB_PLACE_PID`, verified alive) · `'verified'`
   (rule 2, `CLAUDE_PID` alive **and** a proven ancestor) · `'default'` (rule 4, a bare
   `process.ppid`) · `'none'` (the two fail-closed rules) · absent, on every record
   written before this. `pidKind` could not carry this: rules 1, 2 **and** 4 all
   produce `'anchor'`, because all three may legitimately be probed for liveness.
2. `ownsAnchor(rec, {pid, alive, isAncestor})` is a **new predicate beside**
   `ownsHold`, whose implementation is unchanged. Five terms, all required:
   `machine.isLocal` · `pidKind === 'anchor'` · `anchorProof` is `'verified'` or
   `'declared'` · the anchor is alive · the anchor **is this process or a proven
   ancestor of it, right now**.
3. `ownsPlace(rec, session, anchorOpts) = ownsHold(...) || ownsAnchor(...)` is what
   every consumer asks — `conflict`'s exemption, `releaseOwnedBy`, `cmdPlace release`'s
   `mine`, and `classify`. One predicate, so a CLI that answers "is this mine" cannot
   answer it two different ways.
4. A **confirmed-dead** holder (`lapseDead`) is cleared by the next command that writes
   at that path, and `place release` on one needs no `COLAB_HUMAN`: overriding nobody is
   not a human decision. `live === null` is untouched — #288/#289 still fail closed.

**Term 3 is what keeps #242 closed, and it is load-bearing rather than cautious.** #242
rejected `rec.pid === self.pid` where `pid` was unconditionally `process.ppid` — the
parent SHELL, which two unrelated commands share. Every record carrying one is
`anchorProof: 'default'`, and every record written before this carries no proof at all;
both are excluded by construction, permanently. This repo's own suite is the falsifier:
`ship-promote-place-claim.test.js` acquires a hold as a deliberately *different* session
through `colab place acquire`, whose anchor is the node test runner — which is also an
ancestor of the `colab ship` two lines later. With terms 1/2/4/5 alone, ship self-owns a
live **foreign** hold. That test now asserts `class: live-other` and is the sentinel.

**The equivalence class this admits is never coarser than the string beside it.**
Everything `ownsAnchor` exempts is something the same session could already exempt by
`export COLAB_SESSION=<id>` once — the remedy #242 itself named. What it removes is the
requirement to type that string identically on a later command, which is exactly #306's
complaint, without widening *who* counts as one writer.

**Falsifier.** If two concurrent writers of one checkout are ever measured sharing a
`'verified'` anchor but **not** sharing a session string, term 5 is insufficient and this
ADR must be superseded by a new file (never edited — see `docs/adr/README.md`).

## Alternatives rejected

- **Widen `ownsHold` itself.** Rejected: `cmdPlace release`'s `mine` test and
  `conflict`'s exemption are required to be one comparison (#306), and `ownsHold`'s
  `⚠ NEVER` paragraph is cited from `CONVENTIONS.md` and from #242's own record. A
  reader arriving at that comment must find it still true. The widening therefore lives
  in a named sibling with its own five-term contract and its own tests.
- **Widen to `sessionName`.** Rejected again, on the original evidence: display text is
  not a join key, two concurrent sessions can plausibly choose the same one, and a
  consumer that tried name-matching measured a false match and reverted it.
- **A new `pidKind` value instead of `anchorProof`.** Rejected: `pidKind` answers
  "may this pid be PROBED for liveness" (#288). Overloading it with "may this pid prove
  OWNERSHIP" would make the two questions inseparable, and a legacy record — which must
  stay probable but must never be self-ownable — could then not be expressed at all.
- **Widen release only, not `conflict`.** Rejected: the specimen's failure is an
  *acquire-side* refusal (`tools/colab` `cmdShip`'s B1 place check). A release-only
  widening leaves ship refusing exactly as it did on 2026-09-05, and produces a CLI
  where `place release` succeeds on a hold `place check` calls foreign.
- **Fix `resolveShipSession` to see no-worktree claims instead.** Not rejected —
  narrower than the defect. It would cure this one command for a string-identified
  session while leaving every other command, and every mis-shaped identity (#306), where
  they were. It remains worth doing separately; see Consequences.

## Consequences

- A session can no longer be locked out by a hold it took itself, whatever string it
  presents later, provided its anchor was proved at write time. That is every agent
  session (rule 2 fires on every write site) and any caller passing `--pid`.
- A record written before this is **never** self-ownable — recognised only by its
  session string until the next acquire re-stamps it. Acceptable: the population that
  needed this most re-stamps on its very next `claim`/`solo`/`ship`.
- A dead holder no longer waits for a human. The stale record on this repo's own
  checkout, sitting since 2026-09-01, is cleared by the next write there.
- **Tests must neutralise `CLAUDE_PID`/`CLAUDECODE`/`AI_AGENT`**, exactly as #237
  neutralised `COLAB_HUMAN`. Measured while landing this: 9 tests across 3 files passed
  on CI and failed on an agent's machine, because every child `colab` shared one verified
  anchor and two fixtures pretending to be different sessions became one writer.
- Still open, deliberately out of this unit: `cmdShip`'s B3 releases claims only when a
  worktree exists (`if (sess.name && !opts.keepWorktree)`), so a no-worktree ship never
  releases its claim at all — that is a claim-lifecycle defect, not a place one, and
  `resolveShipSession`'s blindness to a claim carrying neither worktree nor branch
  belongs with it.
