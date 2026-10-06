# code-wrap · A2 `CLAUDE.md` is a router, not an archive

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### `CLAUDE.md` is a router, not an archive

"`CLAUDE.md`" in this section means **the repo's instruction file** — `AGENTS.md` where
the repo has one, else `CLAUDE.md` — together with everything `CLAUDE.md` `@`-imports,
because that whole set is what is loaded. Where `CLAUDE.md` is a thin shell
(`@AGENTS.md` plus tool blocks — `CONVENTIONS.md` [§9](../../CONVENTIONS.md#9-adopting-this) step 5, #417), edit the prose in
`AGENTS.md`; the blocks left in `CLAUDE.md` (the Conventions block and its stamp, other
tool-managed blocks) are maintained by their tools and are never edited as prose.

It holds conventions, trunk (and the legacy tier, when that's all a repo declares),
ports, run commands, and **pointers** to the docs
that carry the depth. It is also the one file loaded in full into **every** session
before any work starts, which makes it the worst place in the repo for append-only
accretion — and currently the place accretion lands.

Measured across six repos: **~30 lines added per session, and not one commit ever
made one smaller.** The furthest along went 66 → 452 lines (39 KB, ~10-12k tokens)
in two days; every session in it — including one that only touched CSS — pays that
before doing anything, which is the opposite of code-start's whole premise.

A better destination existing is not enough: the repos that already had a
contributing/gotchas doc grew at exactly the same rate, because nothing pointed
there. So the counter-pressure has to be here:

- **If the knowledge belongs in `docs/`, the `CLAUDE.md` change is a pointer, not a
  copy.** Duplicating is worse than misfiling — whichever copy rots first, the other
  keeps being read. We found a restart procedure living in both, and three other
  rules living *only* in `CLAUDE.md`, so no after-the-fact routing rule can sort
  them: "ops → the deploy doc" silently loses a rule, "gotchas → `CLAUDE.md`"
  returns a second drifting copy.
- **Prefer editing an existing line to adding one.** If nothing already in
  `CLAUDE.md` has become wrong, the correct diff to it is often no diff at all.
- **This is not licence to distill less.** The content is worth keeping — location
  and unboundedness are what's wrong. Move it; never drop it.

This paragraph used to be enforcement-by-prose only, and that failed silently: a repo
was measured at 112,382 bytes / 197 lines — the line count read as healthy while one
"pointer" row alone had grown to 68,350 bytes (60.8% of the file), because nothing
mechanical was watching bytes. `audit/audit.mjs` now flags this — a `CLAUDE.md` over
~40 KB **counting every in-repo file it `@`-imports** (#417), or any single physical line
more than 6x its own file's median and over 2 KB — as an advisory (`audit/README.md`, #64). It is a starting-point threshold, not a hard
gate, but it means a session no longer has to catch this by eye.
