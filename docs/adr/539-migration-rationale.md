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

*Superseded by the machine-level policy below (#598): the owner record is no longer read.*

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

## Machine-level reviewer policy (#598)

The #596 record is retired as a resolution rung. The policy now resolves: the repo's explicit
`migration-grant:` → this machine's value → `human`. `colab owner-policy show` still reads the old
record, read-only, and says it is not honoured; `owner-policy set` refuses.

**Why the owner record went.** It counts a marker from any `OWNER` or `MEMBER`. In a typical setup
the shared account that agent sessions post from is an org member. `COLAB_HUMAN=1` guards only
`colab owner-policy set`; one raw API call skips it, and the reader cannot tell the two apart. So
any agent session, on any machine, could switch reviewer grants on for every repo of the owner —
the class #407 named for grants. Keeping the record as a lower rung would keep that hole open on
every machine where no human has set a value.

**Why a machine-local value now, when #596 rejected one.** #596 rejected a machine-local file for
two reasons. "Another machine cannot see it" is now the intended scope: a gate run on a machine
where nobody set the value resolves to `human`, the safe direction. "Any session on that machine
can edit it" still holds, and is weighed against the owner record's reach — every repo, from
anywhere the shared account's token is.

**The record.** `policy["migration-grant"]` in the machine's colab config
(`{ value, by, at, host, machine }`), written only by `COLAB_HUMAN=1 colab config set
migration-grant <human|reviewer|unset>`. The `machine` id binds it to the machine that wrote it, so
a synced or copied config does not carry the switch; where either side has no id, the binding is
skipped. `tools/lib/grant-policy.js` holds the one precedence, and a console on the same machine
imports `effectiveGrantPolicy` from it, so it cannot compute a different answer than `colab ship`.

**Limits, stated rather than solved.** The file is user-writable and `COLAB_HOME` redirects the
read; `COLAB_HUMAN` is an environment variable. Those are the bars every human-only command has.
What this changes is reach: one machine, no remote write path, no shared account. A repo that
resolved to `reviewer` only through an owner record now resolves to `human` until a human sets the
machine value — stricter, never wider. The audit runs offline and cannot see the machine value, so
it still reports `migrationGrantSource: undeclared`.
