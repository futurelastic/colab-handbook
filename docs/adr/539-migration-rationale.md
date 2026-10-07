# Migration exemption: wording rationale

Moved from [`CONVENTIONS.md` §5, *Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)*](../../CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a declaration only widens the gate

; a repo keeping migrations elsewhere without declaring them is a repo whose gate reads `no new migrations ✓` on a backfill

## Why the branch is named in a comment

(labels cap at 50 chars, cannot carry a branch name)

## Why a grant covers the whole ship set

: a migration cannot be attributed to one member of a group branch

## What the trust-humans list is for

The list only stops the readers from throwing away a difference the platform already has.

## Why the policy is read from trunk

, so a branch cannot raise its own policy

## Why a workflow-editing branch cannot pass R

, because a branch must not rewrite the job that grades it

## Why needs-migration-grant is provisioned

for the same malignant-absence reason

## What needs-migration-grant is applied for

, so the grant request surfaces before `ship` ever has a reason to refuse
