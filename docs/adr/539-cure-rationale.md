# Cure rule: wording rationale

Moved from [`CONVENTIONS.md` §5, *Cure rule — the machine-checkable door through trunk-CI-green (#281)*](../../CONVENTIONS.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why the branch must contain the red head sha

— proof the branch was built against the exact failure, not merely conflict-free with it

## What the red-set scope certifies

the rule certifies that the branch cures trunk's red, not that the branch is spotless.

## Why an unchanged red set refuses

(the prior exemption fixed nothing that stayed fixed)

## Why a new red job refuses

— trading one red for another is the loop this condition exists to break

## Why any depth counts for package.json

(the template's working directory is an adopter's edit point, and workspace runners read nested scripts)

## Why an add-only scripts change passes

the template runs more, never less — so

## Why a lifecycle hook is never admitted

— it runs inside a step that already exists and can rewrite what that step measures with no name changing

## Why the workflow carve-out exists

The repair for a CI-*infrastructure* outage is, by construction, a workflow change: when trunk goes red because the runner pool cannot reach a service container, the branch that fixes it necessarily edits `.github/workflows/**` and was therefore permanently cure-ineligible however green it was — leaving a mechanically-verifiable repair waiting on a human who may not be watching.

## Why 4c measures duration

4b proves the *steps* ran; it cannot see a step's `run:` body gutted to a no-op inside the very workflow file being carved for, and duration is the only signal that touches that.

## Why a dispatch is never waited on

— the job may take hours, and ship measures up to three times per invocation —

## Why the patch round is a PR

Condition 2 then has no other way to be measured, and the PR's merge ref includes the red trunk, so only the branch carrying the fix gets a meaningful run from it.

## Why the anti-stacking scan recognises both trailers

, so a repo that has used both doors is scanned as one continuous stacking history rather than two independent ones
