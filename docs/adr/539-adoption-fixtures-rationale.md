# Fixtures and examples use invented values: why

Moved from [`CONVENTIONS.md` §9, *Fixtures and examples use invented values*](../../CONVENTIONS.md#fixtures-and-examples-use-invented-values) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why this is not the secret-scanning rule

This is not the secret-scanning rule wearing a different hat. A credential is a secret
and a scanner finds it; **a hostname is not a secret, so every gate you run passes it**,
and in a public repo it is published the moment it lands. Git history cannot be recalled
once anything is cloned or forked, so the only reliable control is never writing the real
value down.

## Why complying costs nothing

The cost of complying is zero — an invented value tests exactly as well as a real one,
because a fixture asserts *shape*, never provenance. We found real machine names in four
of this repo's own fixtures, one of them inside an asserted output string, with CI green
throughout and correctly so.

## Why the mechanism is pre-commit

Pre-commit, deliberately: by the time a workflow runs, the commit exists and may already be
pushed, and the only remedy left is rewriting published history.

## Why the rule stays the control

the rule is the control, and both mechanisms are backstops for the day somebody forgets it
