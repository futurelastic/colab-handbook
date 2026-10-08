# code-triage · §0 Pending wakes, an unowned red trunk, and waiting on a human

Reference for [`code-triage`](SKILL.md) §0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**Then re-check the pending wakes — the one thing the five inputs cannot see move (#382).**
A hold's `wake:` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360), *Holds*) is re-checked on **every** pass, a
short-circuited one included, or a wake that came true while nothing else moved is hidden
behind a re-print that still says `HELD`. Most forms need nothing extra, because an input
above already moves when they come true:

| `wake:` form | Seen by |
|---|---|
| `#N` (an edge, either repo) | input 3 — the `BY` line carries the blocker's state |
| `issueClosed:<n>` (this repo) · `labelPresent:<label>` | input 2 — the open set and every label |
| `trunkAt:<sha>` | input 1 — trunk has to move for it to become true |
| `ruling` | nothing — it is never mechanically met (the owner's act is removing the label) |

Three forms move with **no** input: a date reached (`review-by:` / `after:`), a branch that
became an ancestor of trunk without trunk moving (`branchLanded:`, a branch reset onto
trunk), and another repo's issue closing (`issueClosed:<owner>/<repo>#<n>` with no edge).
The last full pass stored every held issue's unmet wake line in `$CACHE.wakes` (§0.1). Re-check
only those:

```sh
TODAY=$(date -u +%F)
# review-by:<date> / after:<date>  → met when <date> <= $TODAY                     (0 calls)
# branchLanded:<ref>                → git merge-base --is-ancestor "$REF" origin/<trunk>  (0 calls, the fetch in input 1 already ran)
# issueClosed:<owner>/<repo>#<n>    → one read per DISTINCT ref:
gh issue view <n> -R <owner>/<repo> --json state -q .state         # CLOSED ⇒ that condition is met
```

A stored line is **met** only when every condition on it is met (the line is ANDed). Any line
met ⇒ `§0 changed: wakes — full pass`. A cross-repo read that fails, or a ref that no longer
resolves, is **not** "unchanged": print `§0 changed: wakes (unreadable <ref>) — full pass`, so
§2 reports it (a wake waiting on nothing is a `STALL`). Cost: zero calls for a repo with no
cross-repo wakes pending, one per distinct pending ref otherwise — `lastRun.calls` records the
real number, and the outcome line below prints it rather than a fixed three.

**Then check for a red trunk that nobody owns — a state, not an input (#430).** Trunk CI is
never part of the fingerprint (*What is deliberately NOT in the fingerprint*, below), so a
trunk that goes red with no code change moves none of the five inputs. The same goes for a
diagnosis already in the backlog under the wrong title.

Why: [ADR 536](../../docs/adr/536-code-triage-0-wakes-and-red-trunk-rationale.md).

So check this on **every** pass, a short-circuited one included. The red trunk is
**owned** when either of these holds:

- an open issue's title starts with `TRUNK RED:` **and** it is **accepted**, meaning it
  does not carry `agent-filed` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#provenance--who-decided-the-work-should-exist),
  *Provenance*); or
- the stored record's `redTrunk` (§0.1) names this same sha **and** an issue that is still
  open and accepted in input 2. That is §5.2 step 3's comment on an open flake-class issue,
  which owns this red without a `TRUNK RED:` title.

```sh
TRUNK=$(git rev-parse origin/<trunk>)                              # input 1, already fetched
printf '%s\n' "$OUT2" | grep '^I ' | awk -F'\t' '$2 ~ /^TRUNK RED:/ {
  split($1, f, " "); if (("," f[4] ",") !~ /,agent-filed,/) print f[2] }'
                                                                    # owned by title: any number ⇒ stop here, 0 calls
colab trunk-ci --json                                               # 1 call, only when no title owns it
                                                                    # → { verdict, sha, … }; verdict ∈ GREEN RED PENDING WEDGED NONE UNREADABLE
```

Input 2 is already in hand, so the title test costs nothing. The CI read happens only when
no title owns the red. **The verdict is `colab ship`'s, not a rule of this skill's (#463):**
`colab trunk-ci` runs the same read ship's *trunk CI green* row does — by commit, runs from
workflows the repo does not own dropped, each workflow judged by its newest run — and prints
it without the exemption doors, since a cure or a human CI exemption lets one branch past a red trunk
without making the trunk green. Never inline a `gh run list` filter here instead: one did,
read "GREEN when any run succeeded", and a sha with `CI` green beside a red release workflow
read GREEN to triage while ship parked every candidate on it — a red nobody owned.
Check that its `sha` equals `$TRUNK`; if it does not, trunk moved between the two reads, so
re-run both. `RED`, owned by neither rule ⇒ `§0 changed: unownedRedTrunk — full pass`. The
full pass then reaches §5.2, which adopts a mis-titled or unaccepted diagnosis, or files one.
`PENDING` (a run still in flight) is not red yet, and neither is `NONE`. `WEDGED` is not red
either: it is a stuck run, and §5's *Trunk CI is alive* bullet reports it. `UNREADABLE` (exit
2, or no `colab` on this machine) is not "green": print
`§0 changed: unownedRedTrunk (unreadable) — full pass`.

The condition **re-arms only while nobody owns the red**. Once a prefixed, accepted issue
exists, or §5.2 has recorded its flake-class comment for this sha, the next ping costs
nothing extra. While trunk is red and unowned, every ping is a full pass. That is the point:
it also covers the ping that must read the driver's re-run result (§5.2 step 2), which a
short-circuit would otherwise skip. What is cached here is §5.2's act, not the CI verdict.
CI is still re-read on every pass that needs it.

**Waiting only on a human counts as unchanged (#489).** When everything left in a backlog is
an open human ask (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#an-ask-is-said-once--a-later-pass-reports-that-it-is-still-waiting-489),
*An ask is said once*), the ask gets older on every ping, but its age is not one of the five
inputs, and `wake: ruling` is never mechanically met (table above). So the pass stays
`§0 unchanged` and costs three calls. A ping never leaves the short-circuit to ask again,
to escalate, or to re-render a question because time has passed. The human's answer is
what moves an ask: a `⚖` record with the `needs-decision` swap, a hold label removed, an
issue closed. Each of these moves input 2 or 3 and ends the short-circuit normally. The
re-print (§0.1) shows each open ask as its single `ASKED` line (§6), never as the card.
