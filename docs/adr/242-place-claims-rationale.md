# Place-claims: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §2, *Place-claims*](../../CONVENTIONS.md#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## What a place-claim is not

- **What it is not.** Three partial mechanisms already exist in this fleet and none is a
place-claim: the claim registry holds an *issue*, not a *place*; a worktree's existence
implies nothing about who is writing to it *right now* (creating one is taking it — there
is no separate act, and nothing has refused a second writer since); and a session
spawner's own trunk-lock (below) is keyed to *spawning a ship-kind session*, which cannot
answer "may I write here right now" for work that never came through a spawn.

## Release is a liveness lookup: the lock that lagged

Measured on the one such lock
already running in this fleet (a session dashboard's spawn-time trunk-lock, refusing a
second `ship`/`sweep`-kind spawn with the holder named): it releases only once a poller
*notices* the holder died, roughly a minute later — so immediately re-spawning after a
kill gets a refusal indistinguishable from a genuine conflict.

## The #305 trunk-claim hold: the 45-minute measurement

Measured: a session released its issue on GitHub cleanly and still held
the checkout 45 minutes later, blocking every sibling claim on the machine.

## #285: the decision happens inside the state lock

Before this, every shared-checkout write site was a check-then-act pair straddling that
boundary: state was loaded with no lock, `conflict` judged that snapshot, and the write then
landed unconditionally under the lock without re-checking the fact the decision rested on.
**Measured on a fixture: 8 concurrent `colab place acquire` invocations against one checkout
ALL exited 0**, and the state file ended up holding a single record belonging to whoever wrote
last — the same "each reads unlocked, each writes held by me, both proceed *with confidence*"
failure the sync-location bullet below names as worse than no lock, reached through the
check/write split instead of through a synced filesystem. It gated nothing, on any repo,
under any `writes:` value.

## Serialization means acquire-or-refuse: the two structural reasons

Two reasons, both structural rather than stylistic: the state lock
is a busy-wait spin with a fixed budget, so a blocking acquire would hold a machine-wide lock
across an unbounded wait — starving every other command, including the release it is waiting
for; and a waiter entry would be a **stored flag**, which is the one thing this module refuses
to keep (see the read-time liveness bullet above) — it would need its own liveness probe, a
second copy of the problem #288/#289 just fixed.

## #242: why a bare pid never decides the re-acquire exemption

Two
invocations sharing a parent shell share one `pid` without being one writer, and this
primitive's whole value is refusing when it cannot prove safety; a measured falsifier run found
agent tool calls do not even share a stable `pid` across separate commands, so the mandatory
identity at the two minting call sites is the fix, not a weaker match inside `conflict` itself.
⚖ #317 draws the boundary this paragraph was always about, rather than moving it: the population
it rules out — a `process.ppid`, shared by every command in one shell — is ruled out permanently,
and only a pid that was **proved** to contain the caller earns the exemption (two bullets down).

## #317: why a confirmed-dead holder lapses at read time

Only `colab doctor --prune` removed one, and only when
somebody thought to run it, so a corpse sat in `colab places` looking exactly like a hold and
`colab place release` demanded `COLAB_HUMAN=1` to clear it — which is the command a human actually
had to type at 01:35 to unstick a trunk.

## A related lock outside this convention

**A related lock already exists outside this convention, and this section describes it
rather than forking it.** A session dashboard refuses to spawn a second `ship`/`sweep`
session per repo, naming the holder. That mechanism's *semantics* — held by a session,
checked before work starts, refuses rather than warns, releases on holder death — are
what this section generalizes to any writer on any checkout, not a competing design; the
lag correction above (poller vs. read-time liveness) is the one place the generalization
is deliberately *stronger* than what it started from.
