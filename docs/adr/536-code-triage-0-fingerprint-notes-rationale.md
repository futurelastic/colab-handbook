# code-triage 0-fingerprint-notes: why, with the measurements

Moved from [`skills/code-triage/0-fingerprint-notes.md`](../../skills/code-triage/0-fingerprint-notes.md) by #536. The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the dependency-edge blindness of updatedAt is its own input

- **`updatedAt` does not see dependency edges either — measured on the live API.** Adding a
  `blocked_by` edge and removing it again left `updatedAt` byte-identical across both
  writes, while a label add/remove moved it twice in the same minute. Edges do land in the
  issue timeline (`blocked_by_added` / `blocked_by_removed`), but reading that is a call
  *per issue*; input 3 is the entire graph in one query. This is why input 3 stays a
  separate input even after input 2's narrowing above — none of `state,title,body,labels`
  sees an edge either, so dropping input 3 would go blind to precisely the data the §5
  readiness gate turns on: a new blocker would be reported as `free (checked)` forever.

## Why input 3 digests both directions: the measured inbound edge

Measured: an open issue whose
`blocking` went 0 → 1 — a consumer elsewhere declaring itself blocked by it — produced a
**byte-identical** one-directional line (`<n>:0`) before and after, and two inbound edges
once survived a full triage cycle unnoticed. Under a ping loop that means the repo
acquires an obligation (one of its issues is now on somebody's critical path) and triage
never says so. The two-way line makes the fingerprint deliberately more sensitive, on the
same reasoning input 5 already uses for pushes: what this repo *owes* changed.

## Why the connections and not the summary: the measured lag

Measured, both directions, inside a *single* response: seconds
after a `blocked_by` POST, `blockedBy(first:n){totalCount}` already read `1` while
`issueDependenciesSummary.blockedBy` still read `0`; seconds after the matching DELETE the
connections read `0` while the summary still read the pre-delete `1`. It converges within
a few seconds, so nothing is broken — but a digest built from the summary can record a
state that never existed at any instant, and a fingerprint stored from it "changes" on the
next ping for no reason.

## Why every digest needs a receipt: the missing-jq failure

Note the failure is *not* hypothetical for want of `jq`: shipped paths use
`gh`'s built-in `-q` (and the audit's `--jq`) for exactly this reason, but an external
`jq` is not universally installed — piping this query into one on a machine without it
returned that constant, silently.

## Why input 5 exists

- **Input 5 exists because §5.1 turned a branch push into a readiness signal.** A blocker
  whose code gets pushed moves a dependent from `blocked` to soft-ready — and moves none of
  inputs 1-4: trunk is untouched, the issues are untouched, the edge is untouched, and the
  claim may live on another machine. Without this the new verdict would almost never be
  discovered under a ping loop, which is the same blindness input 3 was added to fix. It
  reads refs the fetch on input 1 already updated, so it costs no call.
