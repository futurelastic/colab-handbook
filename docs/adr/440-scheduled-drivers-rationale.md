# Scheduled drivers: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Scheduled drivers*](../../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Release workflow runners (#453)

On a private (or internal) repo GitHub-hosted minutes
are billed, and a billing refusal stops a hosted job before it starts — measured twice in a row on
one adopting repo, the release workflow being the only one on its trunk still on hosted runners.

## Promotion cell (#440)

This is the one cell where a scheduled caller may promote, and it
is safe there for the reason the field already gives: on `deploy: tag` a promotion only runs the
heavy suite on `main` and deploys nothing.
