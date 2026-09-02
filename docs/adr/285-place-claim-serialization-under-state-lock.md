# Place-claim serialization: the decision moves inside the state lock

## Context

`writes: direct` (#283) declares that the trunk checkout is a strictly one-writer-at-a-time
resource and that every direct writer holds the path-scoped place-claim on it. #285 was filed to
implement that, and framed the work as *loosening* `colab solo`'s entry gate from "refuse if
anything is held" to "acquire, queue or refuse if held."

Implementing it found the premise wrong in both halves.

**There was nothing to loosen.** `place.conflict` already cleared for a confirmed-dead holder
(`place.js`, `if (h.live === false) return null`) and for a same-session re-acquire (#242), and
`solo.entryProblems` already ignored worktrees (#236) and off-checkout claims (#240) on purpose,
at length, in its own docstring. The gate was already "whoever holds it right now."

**And the hold serialized nobody.** Every shared-checkout acquire site was a check-then-act pair
straddling the state lock:

- `placeState()` called `state.loadState()` with **no lock**;
- `place.conflict` judged that snapshot;
- `placeMutate()` → `state.mutate` → `withLock` then re-read state and wrote
  `st.places[key]` **unconditionally**, never re-checking the fact the decision rested on.

Five such sites: `cmdClaim`'s trunk-checkout path, `cmdSolo`, `cmdPlace acquire`, `cmdShip`'s B1
(which takes this hold on the main checkout for the duration of a merge), and `cmdPromote`.

Measured on a fixture, against the pre-#285 binary: **8 concurrent `colab place acquire`
invocations on one checkout all exited 0**, and `state.json` ended up holding a single record
belonging to whichever process wrote last. That is the "two sessions can each read *unlocked*,
each write *held by me*, and both proceed **with confidence**" failure `CONVENTIONS.md`
("Place-claims") names as worse than having no lock at all — arriving through the check/write
split rather than through the synced-filesystem route that bullet was written about.

This was not a `direct`-only or future concern. `ship` B1 and `promote` are agent writers of the
main checkout **today**, on every repo, under every `writes:` value.

## Decision

**1. One decide-and-write function, called inside the critical section.** `place.acquire(st, opts,
probe)` re-runs `conflict()` against the state object it is handed and writes the record only when
that state is clear. Callers pass it as `state.mutate`'s function, so the `st` it judges is the one
loaded under the lock, microseconds before the write. It stays pure with respect to the filesystem,
like everything else in the module: policy (`syncedStateProblem`, `resolveAnchor`,
`requirePlaceIdentity`, the `COLAB_HUMAN=1` bar) stays at the call site, because those are questions
about the *caller*, not about the record.

**2. The cheap pre-check stays at every call site.** It refuses without taking the lock in the
common case, and it owns the `--force`/`COLAB_HUMAN` policy. It is simply no longer the authority.
Both refusals are composed from the same `conflict()` result so their wording cannot drift; the
inner one appends a line saying the holder arrived between the check and the write.

`cmdClaim` and `cmdSolo` perform compound mutations (claims, worktree stubs, the `solo` record). They
signal a lost race by **throwing out of the mutation function**, which rolls the whole thing back —
`state.mutate` throws before `saveState`, so nothing is written. `placeMutate` re-raises anything
carrying `placeRace` rather than reporting it with its "lock unreachable, fall back to a worktree"
degrade wording, which would tell a caller the wrong thing entirely.

**3. Acquire-or-refuse. No queue, no waiting.** Rejected: a real queue with waiters.

- The state lock is a **busy-wait spin** with a fixed budget. A blocking acquire would hold a
  machine-wide lock across an unbounded wait, starving every other `colab` command — including the
  release the waiter is waiting for.
- A waiter entry is a **stored flag**, and this module's founding premise is that it stores no flag
  it must later trust: release is a read-time liveness lookup precisely because nothing reliable
  runs when a session dies. A queue entry would need its own liveness probe — a second copy of the
  problem #288/#289 had just fixed, in the module they fixed it in.

A caller that wants to wait polls `colab place check <path>` itself. Serialization is what
one-writer-at-a-time means; waiting is a caller's business.

**4. `colab solo` reclaims a solo lock whose place-claim holder is confirmed dead.** `st.solo`
records presence and carries no liveness signal, so a crashed session's leftovers blocked every
later attendee until somebody reached for `--force` — the same instrument used to take over a *live*
holder. The co-located place-claim does carry liveness, so ask it. `live: true` and `live: null`
(unprovable, including every #288 `invocation`-anchored hold, and the case where no place record
exists) both keep today's refusal. Deliberately **not** gated on `writes:`: a stale record is
equally stale under every value, and a safety rule that applies in only one mode is the class of
conditional `../../CONVENTIONS.md` §4's incident log warns about. Strictly narrower than the `--force` it
replaces.

**5. One `direct`-specific change, and it is a tightening.** A place-claim on a `writes: direct`
repo's **own trunk checkout** must carry an identity (`--session`); `requirePlaceIdentity` replaces
`warnWeakIdentity` there. A blank-identity hold can never be re-acquired or released by its own
owner (`conflict`'s exemption matches only a truthy `session`, #242; `place release`'s `mine` test
is the same comparison), which under a declared serialization contract wedges the checkout until a
human intervenes. #242 left `place acquire` warn-only on purpose; this raises that floor for the one
descriptor that asks for it, on its own trunk checkout only.

## What was deliberately NOT decided

**Automated trunk-direct stays forbidden.** The issue's framing ("several spawned agent sessions and
a human all committing straight to the same trunk checkout at once") reads as legalising automated
trunk-direct under `direct`. `CONVENTIONS.md`'s constraint matrix states that cell **forbidden** for
the whole coexistence column, `direct` included; the `direct` subsection says the value
"under-delivers … never over-delivers"; and #284's ruling says outright that it "does not authorize
any session to take trunk-direct anywhere the veto and the attendance bar do not already allow it."
Flipping that cell is a ⚖ ruling, not an implementation, and shipping it inside a safety-gate diff
is precisely how a permission change escapes review. `audit-writes-matrix.test.js` passes **unedited**
after this change, which is the mechanical proof no cell moved.

**Cross-machine locking.** The state lock is a same-filesystem `mkdir`. It orders writers on one
machine and says nothing across a synced `~/.colab`. Unchanged backstops: `syncedStateProblem`
refuses the acquire outright, and #289's foreign-machine branch fires when the marker heuristic
misses. `CONVENTIONS.md` rules cross-machine coordination out of scope for this convention.

**Converging `st.solo` with `st.places`.** Decision 4 makes `solo` liveness-aware by *delegating* to
the place record; it does not merge the two. `solo` is a published state contract with an external
dashboard reader, so convergence is its own unit.

**`direct`'s close path.** #284 assumed a branchless `direct` unit falls into `colab ship`'s
evidence-close by existing detection and asked whoever implemented the runtime to verify rather than
assume. Verified: it does not — `ship` refuses before evidence-close is ever consulted, and `solo
--done` closes nothing. Recorded and handed to #302.

## Consequences

- The place-claim now actually excludes concurrent writers, which it did not before, on every repo
  rather than only on `direct` ones. `ship` B1 and `promote` are the paths that were most exposed.
- One new refusal path exists in `cmdShip` B1; it runs the same `cleanupEphemeral()` every other
  exit from that block owes, so a refused ship leaves no ephemeral worktree behind.
- The lock is held marginally longer — one `conflict()` call, which is pure apart from a
  `procs.alive` syscall. Git calls stay **outside** the lock; moving one in would starve
  `withLock`'s budget machine-wide on a large repo.
- `tools/lib/place-serialize.test.js` is the oracle, and was demonstrated **failing** (8 winners
  where 1 is required) against the pre-#285 binary before it passed against the new one — a
  concurrency test nobody has seen fail is not an oracle. `place.test.js`'s `acquire` block proves
  the same property deterministically, so a scheduler that makes the process-level file pass for the
  wrong reason cannot hide a regression.
