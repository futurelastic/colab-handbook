# Cure — get a red trunk green again

A red trunk stops every landing in the repo, so it outranks all other work. A red trunk with no
patch is never parked in silence
([A red trunk with no patch](../CONVENTIONS.md#a-red-trunk-with-no-patch--never-parked-in-silence-390)).

## Is the red real?

Read the run **at trunk's head sha**.

- **Runner-side** (`red:infra`): the job never ran the code — a runner died, a quota ran out,
  several jobs on different runners failed in the same minute. One re-run, once, after
  cancelling any queued duplicate on the same sha. Red again: the operations lane, with both
  run ids. Never debug the runner from a code session.
- **The code failed** (`red:finding`): continue below. Unsure is a finding.

## Who cures it?

- **An existing diagnosis?** Adopt it; do not file a second one.
- **Only the branch carrying the fix goes first.** It syncs onto the red trunk, and may open a
  change request purely to get CI evidence for itself. Every other branch is a bystander: it
  waits and records why.
- **Two branches both claim to be the patch:** the one whose head demonstrably repairs the
  failing test.
- **No patch in sight:** a revert of the breaking commit is a patch too, and usually the
  cheapest one. Revert first, re-land fixed.

### Leaves: the red-trunk record

One issue per red, filed before anything else moves. Adopted, not duplicated.

```md
TRUNK RED: <sha> (#<issue that landed it>) fails <check>
Run:     <run id> at <sha> — class red:finding
Failing: <test or step> — <file:line where it fails>
Cure:    <patch branch | revert of <sha> | not found yet — who is looking>
Bystanders: <branches waiting on this>
```

### Leaves: the cure

The patch or revert is an ordinary change: plan, commits, report, verdict, landing. Its report
adds two lines:

```md
Cures:   TRUNK RED <sha> — <the failing check, now passing at <head sha>>
Proof:   <run id> green at <head sha>
```

## After

When trunk is green at a new sha, every landing that was held on the red re-reads its own
preconditions. Close the red-trunk record with the green run as evidence.

## Never

- Land a bystander onto an unproven red trunk, or open a change request for one.
- Re-run a finding hoping it goes away.
- Loosen or skip the failing check to turn trunk green.
