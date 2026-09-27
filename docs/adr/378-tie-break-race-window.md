# The claim tie-break only counts claims inside a 10-minute race window

## Context

The claim tie-break (`tools/lib/claim-comments.js`, `tieBreakVerdict`) settles a
*simultaneous* claim: two sessions pass the refusal gate in the same instant, both post
`🔒 Claimed`, and the earlier comment wins. Before #378 "earlier" had no bound. Any live
claim that predated ours won, however old it was.

#375 fixed one way a claim stayed live by mistake: a plain `✅ Released` from any account
now cancels it. One way was left. A claim that nobody ever released **with the marker**
stays live forever, because the comment layer has nothing to cancel it with. That covers
a session that crashed or was abandoned, and a claim released only in prose ("Claim
released — …"). Measured on this repo: an issue's claim was released in prose only. The
issue carried no `in-progress` and no assignee, so a fresh claim weeks later passed the
refusal gate. It then lost the tie-break to the old claim and yielded free work.

## Decision

`tieBreakVerdict` ignores a rival live claim posted more than `RACE_WINDOW_MS` (10
minutes) before our own earliest live claim. Within the window the rule is unchanged.

- The window is a named constant with its rationale beside it. Racers post within
  seconds of each other, so 10 minutes is deliberately generous: a slow `gh` call never
  splits a real race.
- It reads comment timestamps only. The verdict stays a pure function of the comment
  list, so every racer reading the same comments reaches the same verdict. That is the
  convergence property #375's ADR protects.
- The window lives in the tie-break only. `liveClaimComments` is unchanged, so the
  refusal paths that read the live set (the label-side half-claim check and #325's
  other-machine check) see exactly what they saw before.

## Alternatives weighed

- **Close as a duplicate of #375 and leave the never-released claim to stale-claim
  repair.** Rejected: the repair runs later, if at all, and the tie-break already
  yielded by then. The measured case had no label, so no stale-claim check would have
  flagged it.
- **Count tracker state (no `in-progress`, no assignee) in the verdict.** Rejected, as
  in #375's ADR: label state changes while the race is running, so two racers could read
  different states and reach different verdicts.

## Consequences

- **A claim that is genuinely still held is not protected by the tie-break after 10
  minutes.** It is protected earlier, by the refusal gate (`in-progress` + assignee, and
  the other-machine check), which runs before any claim comment is posted. A held claim
  whose label and assignee were both removed is already a broken claim (`CONVENTIONS.md`
  §5), not a race.
- **Two claims more than 10 minutes apart both survive the tie-break.** Neither yields.
  The later one only reaches the tie-break if the refusal gate let it through, which
  means the earlier one had no label and no assignee left. That is the case this
  decision exists for.
