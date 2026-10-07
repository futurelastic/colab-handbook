# code-ship · B1b Harvest every issue the branch carried

Reference for [`code-ship`](SKILL.md) B1b. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B1b. Harvest every issue the branch carried

B2 needs the **complete** set of issue numbers at the moment it writes the squash
message. Build the set here — after the merge is pushed you can no longer add a
missing `Closes` line without amending a commit that is already on trunk.

**Primary source — git. Always works, no CLI required:**

```sh
{ git log --format=%B origin/<trunk>..<branch> | grep -oE '#[0-9]+' | tr -d '#'
  printf '%s\n' "<branch>" | grep -oE '(-[0-9]+)+$' | tr -- '-' '\n'
} | grep -E '^[0-9]+$' | sort -un
```

Commit bodies carry `#N`; branch names carry **bare** trailing digits
(`fix/import-fixes-115-114-113`) — hence the two different extractions. Anchoring
the branch half to the trailing group is deliberate: a plain `[0-9]+` sweep turns
`feat/oauth2-login-88` into issues 2 and 88. It also makes the optional
`<login>/<machine>/` prefix (§4, #348) invisible here: `ada/box-a/fix/import-fixes-115-114-113`
extracts the same three numbers.

**On a trunk-direct unit with no branch — an attended solo-flow session, legal on any
repo without the veto (⚖ #233) — the branch-name half of this extraction is empty by
construction, not a finding.** There is no `<branch>` to read a trailing number from;
the commit-body `#N` on `<trunk>` is the only source harvest has, and it is enough
(`CONVENTIONS.md`, *Solo flow*). This is the same shape `code-sweep`'s `landed
trunk-direct: <sha>` outcome names from the sweep side.

**Optional cross-check — the claims registry, if `colab` is installed:**

```sh
colab claims --json    # filter .worktree == "<name>", or .repo for a trunk session
```

Claims live in `colab claims`, **not** on the worktree record — `colab worktrees
--json` has no `issues` field (verified 2026-07-20; the table's ISSUES column is
derived by filtering claims, so don't go looking for it in the JSON).

The two sources fail in **opposite** directions, which is the point of running
both: git catches an issue worked on but never claimed; the registry catches one
claimed but never mentioned in a commit. A number in one set and not the other is
a **finding** — chase it down, don't average it away.

**Verify by code, not by commit message.** A commit saying `#88` proves only that
someone typed `#88`. Grep trunk for the thing the issue actually describes — the
column, route, UI string, function:

```sh
git log --oneline --all --grep="#88"
grep -rn "<thing the issue describes>" <paths>
```

**Sort every number into one of three buckets — none may stay unsorted:**

| Bucket | Action |
|---|---|
| **Done** | `Closes #N` in B2; confirm it actually closed; evidence in B2b. |
| **Partial** | Close it **and** open a new linked issue for the remainder. |
| **Untouched** | Leave open, with the next step written into it. |

Never close a partial issue bare — that buries the open question where nobody
will find it again. Never leave it whole either — the next session reads an
untouched issue as untouched work and redoes what you already shipped.

Why: [ADR 536](../../docs/adr/536-code-ship-b1b-harvest-rationale.md).

**This sort is now MECHANICALLY checked, not honour-system (#74), and the check
now refuses the MERGE, not just the close (#263).**
If the
issue's `## Plan` is a real GitHub checklist (`- [ ]` one line per
deliverable — CONVENTIONS.md [§4](../../CONVENTIONS.md#4-branches-and-commits), *Merging*),
`colab ship` parses it before composing the squash body and **refuses to
ship at all** for any claimed issue with an unticked box and no declared
remainder — a precondition row (`remainder declared for unticked issues`),
exactly like a red CI run, not a redirect that lets the ship proceed. Doing
B2 **by hand** (no `colab ship`, or a repo without `autonomy: auto-trunk`):
run the same check yourself before you write the commit message, and treat a
hit as a stop, not a note —

```sh
gh issue view $N --json body,comments -q '.body, (.comments[].body)' | grep -E '^\s*- \[[ ]\]|^Remainder: #'
```

any `- [ ]` line with no `Remainder: #M` anywhere in that output means **Partial**,
not **Done** — file the remainder issue and tick what shipped (B2b's evidence
template below) *before* you write `Closes #N`; do not squash-merge this issue
until you have. Ticking the remaining boxes, or an explicit, deliberate
`colab ship --refs $N`, both clear it too — **but `--refs` is only half a choice
(#385).** It keeps $N open, and once B3 releases the claim an open, unheld issue
reads as startable code work again. So in the **same step** as the ship:

- **Leftover is a check only a person can run** (a UI click-through, a look on a real
  device, a live end-to-end proof), with all the code on trunk → **do not `--refs`
  it.** Let `Closes #N` stand, and in this same step add one row to the repo's single
  open `Human verify:` issue (CONVENTIONS.md [§5](../../CONVENTIONS.md#human-verify--a-person-only-check-closes-the-issue-and-becomes-one-row-491), *Human verify*, #491):
  ```sh
  HV=$(gh issue list --state open --search 'in:title "Human verify:"' --json number -q '.[0].number')
  [ -n "$HV" ] || HV=$(gh issue create --title "Human verify: checks waiting on a person" \
    --label delivery:ops --body $'Each row is a check only a person can run. Tick it when it passes; a failed row becomes a new bug issue.\n' \
    | sed 's#.*/##')        # also add this repo's human-wait label from `holds:`, if it declares one
  gh issue comment "$HV" --body $'- [ ] #'"$N"$' — <steps to run>\n  Evidence wanted: <what the person posts back>'
  ```
  Stopping once per finished issue is what this replaces.
  Why: [ADR 536](../../docs/adr/536-code-ship-b1b-harvest-rationale.md).
- **Leftover is another non-code wait** (a measurement a machine can take, a date, an
  outside party) → park it:
  ```sh
  gh issue edit $N --add-label deferred:measurement --add-label review-by:<YYYY-MM-DD>
  gh issue comment $N --body $'Hold: deferred:measurement — owner: <who posts the proof> — wake: review-by:<YYYY-MM-DD>\nBecause: <what is left, and why no code session can produce it>'
  ```
  (`deferred:date` / `deferred:external-party` when that is what it waits on —
  CONVENTIONS.md [§5](../../CONVENTIONS.md#disposition--a-park-must-name-its-wake-condition-279), *Disposition* and *Holds*.)
- **Leftover is code** → prefer `Remainder: #M` over `--refs`, and let $N close.

`colab ship` warns when a `--refs`'d issue still has an unticked box and carries
no start-stopping label (`refsBrakeFindings` in `--dry --json`). The warning is a
reminder, not a gate; treat it as a step you skipped, not noise. A `## Plan` with no checkboxes at
all — written as prose — cannot be checked this way; that shape is itself a
finding, worth a line in the Issue, but it does not block the close (nothing
here can predate this convention and be held to it retroactively).

**Before filing the remainder issue, ask whether this half should ship at
all** (CONVENTIONS.md [§4](../../CONVENTIONS.md#4-branches-and-commits), *Is a shipped half actually
shippable?*) — **does the shipped half have its own oracle**, independent of
the unshipped remainder? If the only way to know it works is to finish the
other half first, declaring a remainder and shipping anyway is the wrong
move regardless of what the gate allows; leave the branch and finish it next
session instead.
