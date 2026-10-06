# Human verify: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Human verify — a person-only check closes the issue and becomes one row (#491)*](../../CONVENTIONS.md#human-verify--a-person-only-check-closes-the-issue-and-becomes-one-row-491) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## The maintainer's ruling

`--refs` + a hold was built for an issue with work still left in it. It does not fit an
issue whose code is all on trunk and whose only leftover is a check only a person can run:
clicking through a UI, a look on a real device, an end-to-end run against a live account.
Parking each of those separately puts one stop per finished issue in front of the person.
In one adopted desktop-app repo, five finished issues sat open for days that way. Each was
parked as `deferred:measurement` with a `review-by:` date, so the board read as a wait on
an outside party, and the maintainer never saw that the wait was his. The maintainer's
ruling: collect the checks in one place instead of stopping after every small UI change.

