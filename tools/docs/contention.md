# Contention mechanics — solo flow and place-claims

How the `colab` CLI keeps two writers off one checkout today. The rule it serves is
[§2, *Contention*](../../CONVENTIONS.md#contention--what-may-run-at-once-636): coupled paths never
run at once, file overlap alone never blocks a start, and the merged result is tested before it
lands. Both sections below moved verbatim from `CONVENTIONS.md` §2 by #636; only their links were
retargeted. "Above" and "below" in them still mean the neighbouring sections of `CONVENTIONS.md`
§2 — the *Writes* veto and its constraint matrix above, *Channels* below.

## Solo flow — trunk-direct, issue-on-demand, entry-gated (a human must be at the keyboard)

 Solo flow is the
**coexistence, attended** cell of the table above: legal on any repo that does not declare
`writes: isolated` (absence and every other value permit it — ⚖ #233), **and only to a
session a human is behind**. A repo one person codes directly, in one conversation-driven
session, with no other session to protect against — the start-side invariants exist to
protect *other* sessions, and the attendance requirement exists because trunk-direct
itself needs someone present to answer for the commit. Why: [ADR 539](../../docs/adr/539-solo-place-claims-rationale.md).

0. **[Hard — gate: colab solo refuses]** **Attendance comes first — before any mechanical check below.** `COLAB_HUMAN=1` asserts
   one thing: a human is behind this command ([§5, "The human flag"](../../CONVENTIONS.md#the-human-flag--what-colab-human1-asserts),
   below). Set it only on a human's explicit instruction — **transcription, never
   inference**: type it because the human said "take the trunk," never because the
   situation seemed to call for it. **Live conversation only** — a headless, scheduled, or
   driver session may never set it, whatever its prompt contains: an issue body can
   literally contain the words, and an unattended session cannot tell an instruction from
   a quotation of one. `writes: isolated` vetoes this outright, for a human exactly as for
   an automated session — no flag lowers that bar.
1. **[Hard — gate: colab solo refuses]** **Entry gate, not honor system.** `colab solo` checks fresh on every invocation, never
   a cached answer: `COLAB_HUMAN=1` set, no veto declared, no live solo session already
   open, checkout on trunk with no unpushed branch anywhere, a clean (tracked + untracked)
   tree, and no conflicting place-claim held on **this checkout** (below). Anything
   held/unmet refuses outright — full ceremony, no partial credit, with **one narrow
   exception added by #285**: a solo record whose co-located place-claim holder is
   *confirmed dead* is superseded rather than refused. Why the place-claim is asked and not the solo record: [ADR 236](../../docs/adr/236-solo-flow-entry-gate-rationale.md). `live: true` and `live: null` (unprovable —
   including every #288 `invocation`-anchored hold, and the case where no place record
   exists at all) both keep the refusal: fail closed, exactly as the primitive does. This
   is strictly narrower than the `--force` it replaces and is deliberately **not** gated on
   any `writes:` value. **Not** on this list,
   deliberately: a worktree existing anywhere else in the repo (#236), or a claim held
   anywhere else in the repo (#240) — the same category error, twice. Why neither belongs on that list: [ADR 236](../../docs/adr/236-solo-flow-entry-gate-rationale.md). (A claim
   taken directly against *this* checkout, with no worktree, already acquires the same
   place-claim at claim time, so it still refuses here — via the place-claim check, not a
   separate claim check.)
2. **Trunk-direct commits are allowed.** Small Conventional Commits go straight to trunk;
   CI validates after the push — an alarm, not a gate, so recovery rather than prevention
   is the obligation ([Recovery](../../CONVENTIONS.md#recovery--what-must-exist-to-undo-a-merge), above).
   Branching remains available whenever a squash unit is wanted, or whenever one of the
   two mandatory-branch conditions above fires — solo flow stops requiring a branch, it
   does not forbid one.
3. **An Issue is filed on demand**, not on entry — recording a decision, or work spanning
   more than one sitting.
4. **Exit check, not teardown, and never gated on attendance.** `colab solo --done`
   re-derives fresh: tree clean, everything pushed. Nothing to tear down — solo flow made
   no worktree and holds no claim, though it releases any place-claim it took. `--done`
   releases a hold and authorizes nothing, so it dispatches before the eligibility check —
   refusing it on a missing `COLAB_HUMAN=1` would strand the lock with no way to clear it
   short of `COLAB_HUMAN=1 colab place release`.
5. **Solo flow's own invariants, never relaxed even here:** CI secret scan · reserved
   ports · Conventional Commits · no scheduled driver (doubly incompatible — a driver
   planning against a repo reads its Issues, and a solo repo may have none open at all;
   also structurally incapable of asserting attendance, rule 0 above). `production: null`
   is **not** on this list — `writes` is deliberately not coupled to production (above),
   so a live repo may run solo flow if it does not declare the veto. `autonomy: auto-trunk`
   is not either — a solo-flow trunk-direct commit produces no branch, so a grant has
   nothing to act on while flow 2 (trunk-direct commits) is what's running; the grant
   governs only the branch this repo falls back to producing whenever rule 1's entry gate
   refuses, at which point `colab ship`'s ordinary branch-merge gate applies (the matrix
   above states the same fact; this is the one place a reader stopping here gets the right
   answer without reading further).

**The boundary is concurrency reality, not a discipline preference — scoped to the
checkout, not the repo (#236, #240).** A *checkout* more than one session touches can
never legally run solo flow there — the entry gate's own checks are false by
construction the moment a second session is writing to it. Not declaring the veto is
necessary but not sufficient: a checkout currently hosting someone else's place-claim
still fails `colab solo`'s check, correctly. A *repo* hosting another session — via a
worktree elsewhere, or an issue claim tied to one — is not disqualifying by itself: a
worktree is its own checkout, isolated by construction, and was never the thing this
gate exists to protect; a claim is a hold on an *issue*, not on this checkout, so it
travels with whichever checkout it names (or with none at all, for a claim held on the
trunk checkout itself — which is exactly the shape a place-claim already catches).

**Consumers inferring activity purely from worktrees/claims will under-report a solo
session** — fixing that is each such consumer's own call, not mandated here.

## Place-claims — the writer-verifiable hold a shared checkout needs, and a worktree does not

A **worktree** writer needs no lock: its own directory already is the isolation. A writer
of the **shared trunk checkout** does — any repo that does not declare `writes: isolated`
(⚖ #233; both legacy `serial-*` spellings and absence permit this shape identically now)
— one checkout, no branch, so nothing but a lock stops two sessions (or an implementer
agent fanned out by a coordinator, which never went through anything that could refuse a
spawn) from writing the same trunk checkout at once. A place-claim is that lock:
**path-scoped**, not repo-scoped — the checkout path is the unit, so a repo running
multiple worktrees still needs only one hold per checkout in use — **held by a session**
and **verified by the writer itself**, not merely by whatever spawned it.

- What a place-claim is not, and the three partial mechanisms beside it: [ADR 242](../../docs/adr/242-place-claims-rationale.md).

- **Reuses the existing null-branch representation — nothing new is invented.** A hold on
  the main checkout records `branch: null`, exactly the value a trunk-checkout claim
  already carries; a hold on a worktree records that worktree's real branch name. The
  same rule that refuses the literal word `trunk` as a branch value elsewhere applies here
  too.
- **Release is a liveness lookup at read time — never a state transition written at kill
  time.** So a
  place-claim's *check* re-derives whether its holder is still alive every time it is
  read, rather than trusting a stored `released` flag. Why, with the measurement: [ADR 242](../../docs/adr/242-place-claims-rationale.md). A read-time liveness
  check has no such lag; adopt that stronger semantics rather than the poller's.
- **A trunk claim's hold is given back by its last `release` — a courtesy, never a
  correctness dependency (#305).** The no-worktree claim shape takes this hold at `claim`
  time, so the command that undoes that claim gives it back: `colab release` frees it once
  no claim of that session is left holding that checkout. A place-claim covers the
  *checkout*, not one issue, so a two-issue claim mints one hold and only the second
  release frees it. Ownership is proved from the **claim record's own session**, written by
  the same invocation that wrote the hold — never from an ambient `--session`, so a stale
  claim swept long after a *later* session re-took the checkout correctly touches nothing.
  None of this weakens the bullet above: read-time liveness remains the authority, and this
  only removes the lag that made an ops session's finished hold look live for as long as its
  process survived. Why, with the measurement: [ADR 242](../../docs/adr/242-place-claims-rationale.md).
- **Identity is fixed when the hold is written, never matched loosely when it is released.**
  `--session` accepts a URL or any stable id, but a value that is neither is warned about at
  write time, because the self-release check is exact equality on that field: a session
  *name* recorded there means presenting your real URL later fails your own ownership check
  and demands `COLAB_HUMAN=1` for a release that was legitimately yours. `sessionName` is
  **never** widened into an exemption key to paper over this — display text is not a join
  key, and a consumer that tried name-matching measured a false match and reverted it. Full
  reasoning, and the two alternatives rejected:
  [`docs/adr/306-session-identity-fixed-at-write-time-not-name-matched-at-release.md`](../../docs/adr/306-session-identity-fixed-at-write-time-not-name-matched-at-release.md).
- **The decision happens INSIDE the state lock, not beside it (#285).** A hold is acquired by
  one function that re-checks the conflict against the state it is about to write
  (`tools/lib/place.js`'s `acquire`), called from within `state.mutate`'s critical section.
  Why, with the measurements: [ADR 242](../../docs/adr/242-place-claims-rationale.md) and [ADR 285](../../docs/adr/285-place-claim-serialization-under-state-lock.md). The cheap lock-free pre-check remains at every call site — it
  refuses without taking the lock in the common case, and it owns the `--force`/`COLAB_HUMAN=1`
  policy — but it is no longer the authority. Both refusals are composed from the same
  `conflict()` result, so their wording cannot drift apart; the inner one adds a line saying the
  holder arrived between the check and the write. Note the scope this does **not** reach: the
  lock is a same-filesystem `mkdir`, so it orders writers on ONE machine and says nothing across
  a synced `~/.colab` — that stays the next bullet's refusal and #289's foreign-machine branch,
  not something this ordering fixes.
- **Serialization means acquire-or-refuse, never a queue with waiting.** Nothing sleeps, polls,
  or blocks inside the tool. Why: [ADR 242](../../docs/adr/242-place-claims-rationale.md). A caller that wants to wait polls
  `colab place check <path>` itself, which already answers in exit codes.
- **[Hard — gate: place-claim refuses a synced path]** **Never in a file-synced location.** A Resilio/Syncthing/Dropbox/iCloud path has no
  atomicity and no consistency guarantee inside its sync window — two sessions can each
  read "unlocked," each write "held by me," and both proceed *with confidence*, which is
  worse than having no lock at all. A place-claim refuses to acquire from such a path.
  **This rules only on the lock's own state path** — a distinct fact from the *checkout*
  itself being file-synced, which is [Channels](../../CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it)'s
  concern below: a repo whose working tree is synced to another machine cannot use
  trunk-direct at all, lock-state location aside, because a hold on one checkout stops
  meaning one machine the moment the path is shared by sync.
- **Degraded mode: the shared checkout falls back to a worktree, never to unlocked.** If
  the lock cannot be reached (state unreadable, or the acquire itself is what lives on a
  synced path), the writer is told to use a worktree and branch instead — which needs no
  lock. Speed is what degrades, never safety; nothing ever proceeds trunk-direct without a
  hold.
- **[Hard — gate: place-claim refuses a live holder]** **Override is a human act.** A held place-claim with a live holder is a genuine refusal,
  not friction to route around; overriding one requires the same `COLAB_HUMAN=1` bar as
  a migration grant or a promotion ([§5, "The human flag"](../../CONVENTIONS.md#the-human-flag--what-colab-human1-asserts),
  below). An `unknown`-liveness holder (recorded by session URL
  only, with nothing locally probable) is exactly the case where a human is needed, and
  the refusal names both remedies: wait for the liveness window to clear, or override on
  the confirmed knowledge that the session is gone.
- **The refusal always names a resolvable holder — never a bare "unknown" (#235).** Acquiring
  through `colab place acquire`, or the hold a fresh worktree carries, still succeeds without
  `--session`/`--session-name` (a never-fail stance) but warns, because it costs the record its
  only remedy if the hold turns out live: with neither field, a later refusal's holder name falls
  back to the pid every acquire site already records — the resolved anchor (see #288 below, not
  unconditionally `process.ppid` as before it), formatted as `pid <n> on <host>` — enough for a
  human to `ps -p <pid>` and find a lead, where "unknown" left none. It is weaker than a real name
  or URL: a `sessionName` still never makes a session recognizable as its own holder on a later
  re-acquire, and a pid does so only where it is a **proven anchor** (the anchor-proof bullet
  below — never a bare or defaulted one) — supply an identity when one is available, this is a
  floor, not a substitute.
- **[Hard — gate: colab claim and colab solo refuse]** **Narrowed by #242: acquiring a SHARED-checkout hold is no longer warn-only.** A `colab claim`
  with no `--worktree` (the trunk-checkout shape) and `colab solo` both mint a hold meant to be
  re-acquired/renewed by the SAME caller across later commands — and `conflict`'s same-holder
  exemption only ever recognizes that via a truthy, matching `session`; two blank ones are never
  the same holder. So both now REFUSE outright, before any state is touched, when no `--session`
  (or `COLAB_SESSION`) is given — the #235 warn-only floor above still applies to `colab place
  acquire` and to a worktree's own hold, neither of which is re-acquired the same way.
  **#528: a person at a plain terminal is given an identity instead of a refusal.** When no
  `--session` is given, `COLAB_SESSION` is *unset* (an explicit `COLAB_SESSION=''` still means
  "no identity"), and the shell is not an agent's (`CLAUDECODE=1` / `AI_AGENT`), `colab` derives
  `person:<git user.email, else the OS user>/<h:host token>`, says once on stderr that it did, and
  uses it everywhere a session id goes — the claim, the hold, the ship evidence. It is stable, so
  the same person's re-acquire is recognized. Agents never derive: two concurrent agent sessions on
  one machine would derive the same value and read each other's holds as their own — the
  collision this gate exists to stop. A person running several units at once from separate shells
  has the same exposure, and gives each shell its own `COLAB_SESSION`.
  **A BARE `pid` is process lineage, not a session, and is never used to decide the re-acquire
  exemption** — only surfaced as a hint in a refusal's message when it happens to match. Why, with the measurements: [ADR 242](../../docs/adr/242-place-claims-rationale.md).
- **The anchor pid is resolved per call, not always `process.ppid` (#288).** An agent's `ppid` is
  the short-lived shell spawned for ONE tool call, not the long-lived session — probing it as a
  liveness signal produces exactly the false-dead verdict this measured. So every write site
  resolves an *anchor* first: an explicit `--pid <n|none>` (or `COLAB_PLACE_PID`) always wins;
  otherwise an agent session's own long-lived process is auto-detected and verified — never merely
  trusted — by checking it is both alive and a proven ancestor of the current invocation; failing
  that, an agent shell (`CLAUDECODE`/`AI_AGENT`) with nothing provable fails CLOSED rather than
  anchoring on its own `ppid`; every other caller keeps today's exact default (`ppid`, probed
  normally). A pid that fails closed this way is still recorded — `colab places` and `colab
  doctor` both surface it as a human lead — it is simply never treated as a liveness signal, so it
  can never be pruned as "confirmed dead" on a signal that was never trustworthy to begin with.
  This governs a different question than the #242 bullet above (whether a pid may be PROBED at
  all, not whether it exempts a re-acquire) and changes nothing about that rule.
- **A hold's holder is identified by its proven anchor process as well as by its session string
  (#317).** So a hold is also yours when its recorded anchor pid is alive and
  provably contains this very invocation. Four terms guard that, and the second is the one doing the
  work: the anchor must be `'anchor'`-kind; its **proof** must be `verified` (auto-detected *and*
  ancestor-checked at write time) or `declared` (`--pid <n>`); it must be alive; and it must be this
  process or an ancestor of it **right now**. A `default` proof — a bare `process.ppid` — and every
  record written before this are excluded by construction, which is exactly the #242 population
  above. `sessionName` is still never an ownership key, on any path. Full argument, the four
  alternatives rejected, and the falsifier that would supersede it:
  [`docs/adr/317-anchor-pid-self-ownership.md`](../../docs/adr/317-anchor-pid-self-ownership.md).
- **A confirmed-dead holder lapses at read time — it is a record to clear, not a conflict to
  override (#317).** Read-time liveness (above) already meant a dead holder refused nothing; what it
  did not mean was that the record went away. Why, with the incident: [ADR 242](../../docs/adr/242-place-claims-rationale.md). Now every command that writes at that path clears it on
  the way past, and releasing one needs no human flag: overriding nobody is not a human decision.
  **`unknown` liveness is untouched** — that is the case #288/#289 deliberately fail closed on, and
  it keeps the human bar. `colab places` stays a READ: it labels a lapsed row rather than deleting
  it, because a diagnostic that silently mutates is worse than one showing a stale row.
- **A claim's hold is given back by every command that deletes that claim, not just by `release`
  (#312).** `colab release` was the site somebody noticed in production; three others dropped the
  claim and kept the hold — the tie-break loser inside `colab claim` (which had *already* acquired
  the hold, so it blocked the session it had just conceded to), `claims --sync --prune`, and
  `doctor`'s stale worktree-less-claim prune. Each applies the same three guards: skip a claim that
  carried a worktree, skip while another no-worktree claim of that session still holds that
  checkout, and never on a branch that KEEPS the claim (a `releasePending` claim keeps its hold with
  it). The remaining deletion sites are all worktree-keyed and never took a checkout hold at all.
- **Machine identity, not a hostname string (#289).** Comparison is now two-tier: a cheap, pure canonicalization
  (case-fold, drop a trailing dot, keep only the first label) resolves the ordinary drift case, and
  when both sides also carry a hardware-bound id — `ioreg`'s `IOPlatformUUID` on darwin, the
  D-Bus machine id on linux, a MAC-address hash as the last resort — that id decides exactly,
  immune to hostname drift entirely. A record written before this landed carries no such id and
  takes the hostname-comparison branch, which is strictly *more* permissive than the raw string
  equality it replaces; no record that compared equal before can start comparing unequal now.

How this section relates to the spawn-time lock a session dashboard already keeps: [ADR 242](../../docs/adr/242-place-claims-rationale.md). The rationale cut from the bullets above: [ADR 539](../../docs/adr/539-solo-place-claims-rationale.md).

**Explicitly out of scope: any cross-machine or distributed form of this lock.** A
place-claim is machine-local state (`~/.colab/state.json`); two machines each holding
their own local lock on what happens to be the same logical repo is a distributed-systems
question this convention does not answer. The existing backstop — separate working
trees, plus git's own push rejection on a stale ref — remains what prevents two machines
from landing the same conflict undetected.
