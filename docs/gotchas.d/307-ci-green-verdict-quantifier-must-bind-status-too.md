# A CI-green verdict computed over sibling workflow rows must quantify over `status` as well as `conclusion` — otherwise the same workflow is gating when red and invisible when merely unfinished

`gh run list` returns one row per workflow at a sha. Any check that folds those rows
into a single green/red verdict has **two** fields to quantify over, and getting the
quantifier right on only one of them is not a partial fix — it is a check that reports
green on a commit whose gating suite has not run yet.

## What happened

`tools/lib/git.js`'s `ghRunForCommit` applied the ALL-quantifier to `conclusion` only.
Its `notGreen` scan correctly refused to let a passing sibling mask a `failure` /
`timed_out` / `action_required` one (#146/#162/#165) — but it tested
`x.status === 'completed' && x.conclusion !== 'success' …`, so it said nothing at all
about a sibling that had not reached `completed` yet. The success pick immediately
below then took the **first** completed+success row it found and returned green for the
whole sha, stamping `runCount` — the full sibling count — onto a verdict that had
inspected exactly one row.

Measured on a repo with three workflows gating one push:

| workflow | status | conclusion |
|---|---|---|
| `build` | completed | success |
| `linter` | completed | success |
| `tests` (self-hosted legs) | **in_progress** | — |

`colab ship --dry --json` reported `"trunk CI green", ok: true, "3 runs at dev@<sha>:
all success"` while `gh api repos/{o}/{r}/commits/<sha>/status` said `pending` and
`commits/<sha>/check-runs` showed three check-runs still `in_progress`. `colab ship`'s
`autonomy: auto-trunk` path trusts exactly this verdict, so the window in which a
branch could be squash-merged onto a sha whose gating suite might still fail was as
wide as the gap between the fastest and slowest workflow — tens of minutes there.

## Why the two fields drift apart

The failure family gets attention because it is *visible*: someone sees a red build get
merged past and files an issue, which is how #146 and #165 arrived. An unfinished
sibling produces no artifact to notice afterwards — if `tests` eventually passes, the
premature green was invisibly harmless, and the incident is only ever observable in the
minority of runs where it *would* have failed. So the `conclusion` quantifier gets
hardened repeatedly while the `status` one silently stays existential.

The invariant to hold, on any surface computing this: **a sibling that has not FINISHED
has not passed — it can still fail.** Green requires `forSha.every(x => x.status ===
'completed')` *and* no bad conclusion among them, never "some row succeeded".

## What NOT to reach for when fixing this shape

- **Do not make the check wait or poll.** `ghRunForCommit` reports what is true at read
  time; a still-unfinished sha falls through to the existing not-completed pick and
  `classifyCiRun` handles it as SELF_CLEARING ("retry later"), or HUMAN_GATED once
  `tools/lib/ci-verdict.js` judges the run WEDGED rather than slow. Blocking inside the
  verdict function would put a sleep in the middle of every ship precondition.
- **Do not quantify over `cancelled`.** The quantifier added here is over `status`, and
  a cancelled run *is* `completed`, so it stays inside the allowlist — blocking on it
  would re-open the `cancel-in-progress` deadlock #92 was filed to close (a cancelled
  straggler outranking a passing run on the same commit, with nothing able to clear it,
  since the branch that would produce a newer run is the one being blocked).
- **Hand the UNFINISHED row's `createdAt`/`databaseId` back**, not the passing row's.
  The wedge check ages the run it is given and reads its job count; handed a finished
  row it would age a run that already completed and could never be wedged.

Both guards are regression-tested in `tools/lib/git.test.js` (#307) — the cancelled
case passes before *and* after the fix, deliberately, so a future tightening of this
quantifier cannot silently take #92's deadlock back.
