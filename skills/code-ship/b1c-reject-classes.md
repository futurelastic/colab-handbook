# code-ship · B1c Reject classes — decision, escalate, rework (#262, #328)

Reference for [`code-ship`](SKILL.md) B1c. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### Reject classifies further — `decision` is the default, `escalate` is the narrow exception (#262)

A stop-for-a-human on *every* reject was measured to be the wrong default for the
common case: one fleet's cheap-tier lane spent 47 attempts — 35 of them rejects, all at
the *same* worker tier — on a single issue, because nothing forced a tier change once
that tier had been shown insufficient. Why: [ADR 536](../../docs/adr/536-code-ship-b1c-reject-classes-rationale.md).
So a reject is graded into exactly one of two classes, decided **at
grading time**, never guessed from a label alone:

- **`decision`** — the default, and everything not explicitly `escalate` below. The
  oracle itself looks wrong, the ask was ambiguous, the diff drifted from scope with no
  reason recorded in the plan file, or the change touches migration, promotion,
  security, money, or anything non-undoable. **A human resolves this — no exception,
  whatever any label says.** Behaviour is exactly what "reject" already meant above:
  comment, hold every claim, stop. *Resolves* does not always mean *answers a
  question first*: when your own recommended fix already sits inside authority the
  repo has granted, the human's part is to overrule it, not to pick it (*A reject
  that already carries its answer*, below). Either way the claims stay held and
  nothing merges.
- **`escalate`** — narrow, and every condition below must hold, not just one:
  1. **The issue set carries the `mechanical-lane` label** (`code-triage`,
     *mechanical-lane*, #93). That label is the one in-repo signal that this work was
     dispatched below the fleet's default engine in the first place — which is what
     makes "a rung above exists" a fact this skill can read, not a guess it is making.
     No label on the harvested set → no `escalate` class, ever, regardless of 2 and 3.
  2. **The gap is a plain oracle-unmet**, not an oracle-is-wrong or scope-is-wrong
     finding — the diff genuinely attempted the stated task and the oracle genuinely
     still says no. Anything that reads as the oracle itself being the problem is
     `decision`, not this.
  3. **`reject-escalate` may only ever be emitted at `round=1`.** Read the issue's
     comments for a prior spend of the bound — **either** a `<!-- colab:grade
     verdict=reject-escalate ... -->` marker **or** the legacy
     `<!-- colab:reject escalate=1 -->` marker (#260 minted the former; every marker
     from before that change is the latter, and issue comments are immutable, so both
     forms exist in history permanently — read the union of the two, always, not just
     the current one). If either is already present, this reject is `decision`, full
     stop, regardless of 1 and 2 — one automatic escalation per issue set, ever. A
     second reject after that spent escalation is exactly the case a human is for.

  On `escalate`: post the same specific-gap comment `reject` always requires, with the
  `<!-- colab:grade verdict=reject-escalate round=1 -->` marker — this marker *is* the
  one-time bound now; nothing else needs to be written to record it, and condition 3
  above is how a later pass reads whether it was spent. Leave the claim held and the
  worktree in place, same as `decision` — do not tear down, do not release, do not
  merge. **This skill does not itself pick or dispatch the next rung** — which engine
  backs it, and how it is invoked, is per-fleet and deliberately out of this skill's
  scope, the same posture `mechanical-lane` itself already takes (`code-triage`).
  Report the escalation instead of a hard stop; whatever routes this fleet's mechanical
  lane (or a human, absent one) picks up the still-held claim and re-attempts, carrying
  this reject comment as that attempt's context. Re-attempting at the *same* tier with
  nobody having checked for the marker first is precisely the failure this section
  exists to close off — checking condition 3 above is not optional bookkeeping, it is
  the cap.

### A reject that already carries its answer — record the direction, don't ask for it (#328)

Why: [ADR 536](../../docs/adr/536-code-ship-b1c-reject-classes-rationale.md).

So when you reject and have a recommended route, check whether that route needs
**authority you do not already hold**. It does if it needs any of the following:

- **a new or amended ruling**, meaning any boundary, policy or `needs-decision` answer
  the repo does not already record. "The ruling already exists" means you can cite it:
  a file and line, a `⚖ Decision recorded` comment, or an issue number. A pattern you
  inferred and cannot cite counts as a new ruling.
- **a grant**: `migration-granted` (of either role — a reviewer grant is still minted
  by a human), a `decision-recorded` label, a go-ahead, or anything else this skill reads
  as a human act;
- **a migration, promotion, tag or deploy**, or anything security, money or
  non-undoable (the `decision` list above, unchanged);
- **a change of scope or oracle**, meaning a fix that stops answering the issue's
  stated ask, or changes what counts as done.

**Every option needs one of these** → ordinary `decision`, unchanged. Post the reject
comment with the options laid out and stop. A human attending the session live may be
asked there as well, but an unattended session (autopilot, a scheduled driver, any run
with nobody typing to it) never waits on an interactive prompt. The comment is where
the human will look, and a modal holds up every candidate queued behind this one.

**Your recommended route needs none of them** → still a `decision`-class reject, but
its marker is the whole token **`rework`**, not `reject-decision` (#406):
`<!-- colab:grade verdict=rework round=1 -->`. The token is what lets a rework router
(something that sends a rework verdict back to the session owning the branch) tell
"the rework is decided, go" from "this waits on a human" by equality alone. Why: [ADR 536](../../docs/adr/536-code-ship-b1c-reject-classes-rationale.md).
Everything else is unchanged:
`rework` keeps every claim held, merges nothing and never proceeds to B2. It is
**held**, never cleared, and a reader that predates it sees an unrecognised token,
which is held too. Only the comment's shape and its token change, and no prompt is
raised at all:

1. **State the route as the direction**, meaning the rework to do. Cite the ruling it
   applies, which is what makes it the author's to follow and not yours to invent.
2. **State the alternative you declined** and which authority it would need ("rule a
   4th network opening, a human act"), so a human who prefers it can overrule on the
   issue. The direction stands unless someone overrules it. Nobody has to answer before
   rework can start.
3. **End the run for this issue set, as for any reject**, and move to the next
   candidate. Picking or dispatching the rework is outside this skill, exactly as for
   `escalate`. Whatever routes rework in this fleet (or a human, when nothing does)
   picks up the held claim and carries this comment as its brief.

```sh
gh issue comment 88 -b "<!-- colab:grade verdict=rework round=1 -->
Rejected: \`lib/sync.js:41\` adds a network poll outside the three openings ruled in
\`docs/network.md:12\`.
Direction: move the refresh onto the existing daily fetch (\`lib/fetch.js:88\`) and delete
the new slot. Applies the ruling in \`docs/network.md:12\`; no boundary change.
Declined: rule a 4th network opening — a human act. Overrule here to take it instead."
```

**Bounded, and on the same marker.** `rework` may only be emitted at `round=1`: no
`colab:grade verdict=reject-*` or `verdict=rework` marker, and no legacy
`colab:reject escalate=1`, already on the harvested set. A direction-bearing reject
posted before #406 carries `reject-decision`, and the `reject-*` half of that test
already sees it. If the rework that followed a direction is rejected again, that
reject is a plain `reject-decision` and a human reads it. Two direction-bearing rejects in a row are how a coordinator
and an author loop on each other's judgement with nobody deciding. The round number
already records this, so nothing new has to be parsed.

A rejected grade, of any class, ends this skill's run for that issue set: nothing
past B1c executes on this pass. What differs is what happens next. A
`reject-decision` waits on a human who has seen the comment and said what happens
next. A `rework` waits on the rework its direction names, unless a human overrules
first. An `escalate` waits on the one bounded automatic retry the marker
records, and falls back to waiting on a human the moment that retry rejects too.
