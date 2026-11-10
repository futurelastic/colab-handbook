# Core paths and a fork's inherited `CODEOWNERS`: the measurement

Moved verbatim from [`CONVENTIONS.md` §2, *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Measured: a fork with an inherited CODEOWNERS

Measured: a fork with `auto-trunk` and an inherited
`* @<upstream-org>/…` paused two docs-only branches in a row, every path read as core.

## A fork the clone cannot see (#702)

The fork test reads a remote named `upstream`, and a remote belongs to one clone, not to the repo.
Measured: a private fork detached from its upstream (the forge reports it as no fork at all), with
the upstream's `CODEOWNERS` kept unchanged and every rule owned by `@<upstream-org>/…` teams. The
same branch read `inert` on a clone that had the fetch-only `upstream` remote, and paused on a PR
for a non-author approval no account in the fork could ever give on a clone that did not. Adding the
remote flipped the verdict with no other change.

`instruction-files: upstream` (#658) already gives every clone the same signal, so the fix is to
make its absence visible rather than to guess fork status. Guessing it from the file alone would be
wrong in the other direction: a repo can legitimately be owned by another org's teams. So the note
fires only in the shape that gives a fork away (not read as a fork, the repo's own owner known,
every owner in the file a team of some other org), and only explains the verdict. A login, an email
or a team of the repo's own org anywhere in the file means someone here can review, and silences it.
