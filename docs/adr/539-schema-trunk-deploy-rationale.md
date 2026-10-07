# `trunk`, `deploy` and `runbook`: why, with the measurements

Moved from [`project.schema.md`, *`trunk`*](../../project.schema.md#trunk--required) and [*`deploy`*](../../project.schema.md#deploy--required) and [*`runbook`*](../../project.schema.md#runbook--required-when-an-out-of-ci-deploy-has-no-workflow) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a Tier C trunk is a declared setting (#205)

It answered the question the same way `dev` would have.

because there either is no second branch at all, or the tag itself already marks the release
boundary

Only the one-gate shape (Tier C) has a second branch whose *existence*, not its *spelling*,
is what the model measures.

## Why the two-branch split earns its keep on a hand-deployed repo

and the shape earns its keep there rather than being ceremony: `main` is **what is currently
running on the host**, `dev` is where sessions land, and the `dev` → `main` promotion is the
deliberate "I am about to deploy" act. Without automation, that merge is the only record of
what shipped and when — collapsing the two branches would erase it

## Why Tier C keeps the same split

for the identical reason

There `main` is literally what is live — the promotion deploys it — so collapsing the
branches would remove the only moment at which anyone decides to ship.

## Why a tag-gated Tier A may run a single trunk

The tier is defined by the promotion **gate** — a version tag — not by the trunk **name**.

## Why `push-main` is not a bad mechanism

`push-main` describes a real mechanism truthfully: for the repos using it, pushing `main`
really does deploy.

## When retiering to `C` became an option

This is the option that did not exist when the finding was first written.

## Why a tag ritual nobody honours is worse than none

A tag ritual nobody honours is worse than no tag ritual: it puts a gate in the
docs and not in the pipeline, and then people trust the docs.

## Why `manual` exists

`manual` exists because the alternatives were both false. A hand-deployed live
repo declaring `deploy: tag` fails the deploy-workflow rule; declaring `tier: B`
forces `production: null`, which states that a live product does not exist. A
repo whose documentation lies is the outcome this handbook exists to prevent
([§8](../../CONVENTIONS.md#8-conformance-and-reconciliation)), so the vocabulary has
to cover the case honestly.

## Why a runbook is required

It is required because an out-of-CI deploy nobody wrote down is how a repo ends up with
exactly one person — or one poller nobody can find — able to ship it. Automated in-repo
deploys document themselves in the workflow file; anything else has to be written down or it
is not knowledge, it is folklore.
