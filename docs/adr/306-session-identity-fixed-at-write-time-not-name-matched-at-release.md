# Session identity is fixed at write time, never name-matched at release time

## Context

`colab claim --session` and `--session-name` are adjacent flags with near-identical
meaning. `resolveSession()` accepted any non-empty string and wrote it verbatim into
the place record, so passing the session NAME to the URL flag was a one-character
mistake that nothing caught: #11's half-identity warning fires when `sessionName` is
set and `session` is *blank*, and #242's `requirePlaceIdentity` refuses when `session`
is *blank*. Both test for absence. Neither fires on a non-blank value of the wrong
shape.

The cost lands later, somewhere else. `colab place release`'s self-release check is
exact string equality on `session` — deliberately the same comparison as
`place.conflict`'s same-holder exemption. A caller that claimed with its name and
later released with its real URL therefore failed its own ownership check and was
routed into the `COLAB_HUMAN=1` branch: a genuine owner, refused, with no way to see
why short of diffing `colab places --json` against what it had just presented.

Measured live on 2026-09-04 (coding-dashboard ops sessions #1480/#1481). The session
correctly declined to set `COLAB_HUMAN=1` for an unattended release, and the only
thing that worked was re-presenting the exact wrong string on file — which confirms
this was an identity-matching defect, not a gate doing its job.

#306 proposed two fixes and recommended the first: validate `--session` at claim time,
or make release-time matching fall back to `sessionName`.

## Decision

**Identity is fixed at write time. Release-time matching is not loosened.**

Concretely, three parts:

1. `claimIdentity.looksLikeSessionId()` is the repo's single shape rule, extracted
   from `parseSessionField` (which now calls it, with byte-identical behaviour).
2. `warnWeakIdentity()` gains a third branch: a `session` that is present but does not
   look like a session id **warns and proceeds**, naming `--session-name` and saying
   that a later `place release` with the real URL will not match. Because it lives in
   `warnWeakIdentity`, it covers `cmdClaim`, `cmdSolo`, `cmdPlace acquire`,
   `cmdWorktreeNew` and `cmdShip` with no new call sites.
3. The residual refusal explains itself: when both sides are non-blank and simply
   differ, it prints the recorded value verbatim, the value presented, and the
   recovery command. `place.holderLabel` prefers `sessionName`, so the old message
   could name the display text while never showing the field the comparison actually
   failed on — which is precisely why the live incident was undiagnosable from its own
   error message.

The gate is untouched. Its legibility is what changed.

## Alternatives rejected

**Option 2 — let `place release` fall back to matching `sessionName`.** Rejected. This
repo has already ruled against name-matching three times, in prose written *after*
somebody measured it:

- `tools/lib/place.js`, `conflict()`: "`sessionName` is likewise never an exemption key
  — it is display text a caller picks about the WORK, not a join key, and two
  concurrent sessions can plausibly choose the same one (a consumer that tried
  name-matching measured exactly this and reverted it)."
- `tools/colab`, `warnWeakIdentity()`: "Never match on the name to close the gap — a
  consumer tried and reverted after a worktree sat beside a live session with a
  near-identical name and was NOT it."
- `CONVENTIONS.md`, *Place-claims*, "Narrowed by #242".

`place release`'s `mine` test is required to be the *same* comparison as `conflict`'s
exemption. Loosening one gives the CLI two different answers to "is this hold mine";
loosening both re-introduces a defect a consumer has already measured and reverted. A
hold that refuses when it cannot prove safety is the primitive's entire value.

**Option 1 in its hard form — reject a non-URL `--session`.** Also rejected.
`requirePlaceIdentity`'s own refusal text promises `--session <url-or-any-stable-id>`,
and `place.js` and `cmdShip`'s help repeat it. A bare stable id is a documented,
blessed value; the fleet uses them, and six of this repo's own test fixtures do
(`sess-OTHER`, `sess-plan-journal-test`, …). Rejecting one would be a breaking change
to a shipped CLI on every adopter repo, in service of a mistake a warning catches.

**Canonicalizing a session URL to its `session_…` tail before comparing.** Deferred,
deliberately. It would change `conflict`'s exemption semantics — the very thing #305's
new release call is being written against — and that coupling is what triage flagged
`needs-plan` for. It is a separate decision with its own blast radius.

## Consequences

- A wrong-shape `--session` is now visible at the moment it is made, on every write
  path, instead of surfacing hours later as an unexplained refusal in a different
  command.
- The warning is a *warning*. An agent that ignores stderr still writes a wrong value.
  Two things cover the residual: #305 removes the occasion (an ops session no longer
  runs `place release` at all — its hold is released by `colab release`), and part 3
  makes the refusal self-diagnosing when it does happen.
- There is exactly one session-shape rule in the tree. A future change to it moves
  `parseSessionField` and the write-time warning together, by construction.
- `place.ownsHold()` now names the ownership comparison that was previously spelled
  out twice. Widening it to `sessionName` would reverse this decision — the test
  `ownsHold: sessionName is NEVER an exemption key` fails if anyone does, which is
  where this ADR is enforced rather than merely stated.
- A hard reject remains available as a future, adopter-visible breaking change. It
  would need its own issue and its own ruling; it is not something this decision
  leaves lying around as an easy next step.
