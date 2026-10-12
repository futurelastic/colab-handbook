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

## Owner-level reviewer policy (#596)

Whether a bound reviewer may grant migrations is in practice decided once, by whoever runs the
repos and answers for them, not separately per repo. Per-repo opt-in meant one `project.yml`
commit per repo, and every new repo silently started at `human`. The owner ruled (2026-10-12)
that the policy is set at the owner level and that the owner takes the responsibility.

**Why a tracker record and not a file.** The value has to show a reader that a human set it.
That rules out three stores:

- A committed file, in the repo or in `<owner>/.github`: any session that can commit can edit
  it, and nothing in it names who did.
- An org-level Actions variable: reading it needs admin scope, user accounts have none, and it
  carries no setter or time.
- A machine-local file: another machine cannot see it, and any session on that machine can
  edit it.

A marker comment on a labelled issue in `<owner>/.github` (GitHub's own owner-wide-defaults
repo) carries its author, their association and a timestamp. It is the same proof class as a
human grant: `COLAB_HUMAN=1` at write, a trusted author at read, and `trust-humans` where the
judged repo has declared that a separate agent login exists.

**Why COLLABORATOR is not enough.** An outside collaborator on the owner's defaults repo does
not answer for every repo the owner runs. Only `OWNER` and `MEMBER` count.

**Why the opt-out is the repo's explicit `human`.** A repo run by another party under the same
owner must be able to refuse a policy it did not choose. The key it already has expresses that,
with no new field.

**Limits, stated rather than solved.** The bar is the grant's bar, no stronger. Where an agent
runs `gh` under the owner's own account, `COLAB_HUMAN=1` is the only thing separating them, and
`trust-humans` helps only once the agent has a login of its own. An edit to a marker comment
after posting is not detected, the same as for grant comments. The audit runs offline, so it
reports `migrationGrantSource: undeclared` rather than guessing the owner value.
