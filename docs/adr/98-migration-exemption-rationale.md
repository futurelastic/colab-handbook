# Migration exemption: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)*](../../CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the association class is not enough

That
class cannot tell a person from an agent that runs under **its own** account: both report
`MEMBER`. Measured in one adopting fleet, where the agents had their own login with write
access: 97 of one repo's latest 100 comments were the agent's, every one `MEMBER`.

## Why a grant binds content, not the commit

*Why:* ship's stale-base rule (#395) makes a branch merge trunk in before it ships, and on
a busy repo trunk moves inside any review window. Bound to the commit, the sync that ship
requires voided the grant that ship requires, every time, so each reviewer-granted
migration needed a second review or a human (measured on one adopting repo: a passing
review voided by a two-commit sync, then parked for hours). R still reads CI at the
shipped head, so the bytes reviewed are also the bytes tested on the new base.
