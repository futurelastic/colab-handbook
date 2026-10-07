# code-triage · §2 Held — holds, wakes, and the `FIXED` transcription

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**Held — a hold is not a start candidate (#360, `CONVENTIONS.md` [§5](../../CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360), *Holds*).**
A hold is one of the three `deferred:*` kinds, or any label the repo declares under
`holds:` in `.github/project.yml`. Read the declared list from the descriptor. Never infer
a hold from how a label is named:

```sh
HOLDS=$(awk '/^holds:/{v=$0;sub(/^holds:[ \t]*/,"",v);sub(/[ \t]+#.*$/,"",v)
  if(v~/^\[/){gsub(/[][ \t"]/,"",v);n=split(v,a,",");for(i=1;i<=n;i++)if(a[i]!="")print a[i];exit};inl=1;next}
  inl&&/^[ \t]+-/{sub(/^[ \t]+-[ \t]*/,"");sub(/[ \t]+#.*$/,"");gsub(/"/,"");if($0!="")print;next}
  inl&&/^[^ \t#]/{exit}' .github/project.yml)       # flow [a, b] or block "- a"; empty = none declared
for L in deferred:date deferred:measurement deferred:external-party $HOLDS; do
  gh issue list --state open --label "$L" --json number,labels \
    -q ".[] | select([.labels[].name]|index(\"in-progress\")|not) | \"#\(.number) $L\""
done                                                 # claimed ones were handled under Taken, above
gh issue view <N> --comments | grep -A1 '^Hold: '    # per held issue: the owner + wake record
```

Leave a held issue off the ranked list. Report it in the **blocked** bucket (§6), one line
each, built from its newest `Hold:` line for that label.

**Evaluate the wake on every pass (#382).** `wake:` comes from a closed vocabulary
(`CONVENTIONS.md` *Holds*, *The `wake:` vocabulary*); several conditions on one line are
ANDed, and a line with one piece outside the vocabulary names no wake at all.
`tools/lib/wake.js` parses and evaluates it, if you would rather call it than read the
rules. Measure each condition with facts this pass already holds, or one read each:

| Condition | Met when | Read |
|---|---|---|
| `review-by:<date>` · `after:<date>` | the date is on or before today (UTC) | none |
| `#N` | the `BY` line for this edge (§0 input 3) says `CLOSED` | none — already in hand |
| `issueClosed:<n>` | `#<n>` is not in the open set (§0 input 2) | none — already in hand |
| `issueClosed:<owner>/<repo>#<n>` | that issue's state is `CLOSED` | `gh issue view <n> -R <owner>/<repo> --json state` |
| `branchLanded:<ref>` | `git merge-base --is-ancestor <ref> origin/<trunk>` exits 0 (`<ref>` as written; exit 1 = not yet, any other exit = does not resolve) | none — local, after the fetch |
| `trunkAt:<sha>` | `git merge-base --is-ancestor <sha> origin/<trunk>` exits 0 | none — local |
| `labelPresent:<label>` | the held issue's labels (§0 input 2) include `<label>` | none — already in hand |
| `ruling` | never mechanically — the owner's act is removing the label | none |

Then print exactly one of:

- **No `Hold:` line, but the hold is already on record** → transcribe it and print `FIXED`
  (#386). A legacy hold often predates the `Hold:` shape: its reason and its date are on the
  issue, just not on one line a scheduler can read. Writing that line is a transcription,
  not a decision, so triage writes it (§0.2, write 6). All three must be there:
  1. the hold label itself;
  2. a `review-by:<date>` label on the same issue — the date the parker already chose;
  3. a **recorded reason** in the issue body or a comment, stating why the issue waits
     **and** who clears it (a login, or a role the repo's docs define).

  Post one comment in the ordinary two-line shape, then read it back:
  ```
  Hold: <label> — owner: <who the reason names> — wake: review-by:<date>
  Because: <one-sentence summary of the recorded reason> (transcribed by triage from <link to it>)
  ```
  - `wake:` is **only** the date. Conditions on one `wake:` line are ANDed, so a reason
    that says "until X, or by the date" cannot put X there as well — that would turn "or"
    into "and". X goes into `Because:`, in the reason's own words.
  - The owner comes from the recorded reason, never from who applied the label or who is
    assigned. A reason that names nobody is missing its owner, so the issue stays `STALL`.
    The same goes for a missing date or no recorded reason: a gap is a human's to fill.
  - The link in `Because:` points to where the reason was found, so the owner can check
    the summary against it.
  - `FIXED` prints with the `STALL` lines, first. Its line names the label, the owner, the
    wake and the comment just posted. From the next pass on, the issue reads as `HELD` or
    `WAKE` like any other hold. §0's fingerprint does not read comments, so it will not
    force that pass (the blind spot below).
- **No `Hold:` line and the record above is incomplete, one missing `owner:` or `wake:`, or
  a `wake:` outside the vocabulary**
  → `STALL`, listed first. A park with nobody named to clear it and no condition that ends
  it is a silent `wontfix`, so it is a finding, never ready. This includes a `deferred:*`
  label with its wake but no owner line, and a prose wait written into `wake:` instead of
  into `Because:` with a `review-by:` date.
- **A condition names an issue, branch or sha that does not resolve** → `STALL`, naming the
  reference. The park waits on nothing (*Holds*, rule 3), and a date alone would have hidden
  that until it came due.
- **Every condition measured met** → `WAKE`, listed right after the `STALL` lines: *wake
  met, lift?*, naming the condition, the evidence for it (the closing issue, the trunk sha)
  and the owner who lifts it. The issue is still held — the owner removes the label, and a
  newer `Hold:` line may have tightened the condition, so read the newest one before
  calling it met. `WAKE` changes how the line prints; the issue stays in the `blocked`
  bucket of `$CACHE`, like `STALL`.
- **Owner and wake both named, not met yet** → `HELD`, naming the label, the owner as the
  clearer, and the wake.
- **`wake: ruling`** → the `Because:` line is the ask. Quote it in the report so the
  person who clears the hold can see what they are asked, not only that something waits.

### Is the hold what it says it is? (#540)

A hold names who clears it and what ends it. Both can be wrong in a way the wake table cannot
see, and a hold that is wrong about its owner waits forever on someone who is not coming. So
before printing `WAKE`, `HELD` or an `ASKED` card that chases the owner, check two things:

- **An "external party" that is not external.** On `deferred:external-party`, read the
  `owner:` and every `wake:` reference. When one resolves to this repo — an issue here, a
  branch here, work a session in this repo could do — the wait is a dependency, not an
  external one. Print the finding `not external: <ref> — a dependency, propose blocked_by #M`
  instead of chasing the party. Triage writes nothing: correcting a human's hold is the
  owner's act, and a `blocked_by` edge for it is §4's write only once the owner agrees.
- **A `deferred:measurement` owned by a person.** That kind is for waits a machine can
  measure (`CONVENTIONS.md` §5, *Holds*). When its `owner:` is a person who has to look, and
  its `wake:` is nothing a pass can measure, it is a human wait mislabelled — print the
  finding `misfiled hold: a human wait — <owner>`, and print its blocked line as a wait on
  that person — the clearer named, asked or not — rather than as a measurement in flight. A
  repo that declares a human-wait label under `holds:` is where it belongs; triage does not
  relabel it.

**A met wake is triage's job that pass.** Every condition measured met ⇒ the `WAKE` line
prints in the pass that measured it — short-circuited passes included, through
`$CACHE.wakes` (§0) — and its *wake met, lift?* proposal goes to the owner then, never left
as `HELD` for a later pass to notice. Dispatching that proposal is not lifting the hold.

Record every `HELD` line's `wake:` value in `$CACHE.wakes` (§0.1), so a later
short-circuited ping can still see a date come due or another repo's issue close.

Triage never removes a hold, not even on a met wake. That is not one of §0.2's writes;
*wake met, lift?* is a proposal for the owner, never a lift. Triage writes a `Hold:` line
in exactly one case, the `FIXED` transcription above. It never writes one that changes
what a human recorded: no new owner, no new date, no condition that was not already
written down. Otherwise whoever parks the issue writes the line, and its owner clears it.
A repo whose descriptor declares no `holds:` still gets the `deferred:*` half of this
pass. One blind spot: a `Hold:` line posted *after* its label is a comment, and §0's
fingerprint does not read comments. A `STALL` can therefore outlive its repair until
something in the fingerprint moves.
