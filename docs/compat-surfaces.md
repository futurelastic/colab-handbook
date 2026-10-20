# Compatibility list — the handbook's public surfaces

Adopters' code, instruction files and skills name this handbook's surfaces: links into
`CONVENTIONS.md` sections, skill names, `colab` commands, `project.yml` keys, label and marker
strings, package paths, engine confs and template paths. Each one listed below is a promise.
`scripts/check-compat.mjs` holds the tree to it in CI and in `scripts/smoke.sh`.

## What may change, and what the check refuses

| Surface | Compatible change | Breaking change the check refuses |
|---|---|---|
| a `CONVENTIONS.md` section number or heading anchor | the section moves; its heading stays with a short stub (the rule in one line + where the mechanics went) | the heading or number disappears, or sections are renumbered |
| a skill name | the skill becomes a thin alias that loads its replacement guide, same name and triggers | the folder disappears, or its `SKILL.md` loses the name or the description |
| a `colab` command | it keeps working, or answers with the exact command that replaces it, for at least one minor release | it disappears silently |
| a `project.yml` key | its meaning is documented differently | renamed or removed |
| a label, marker or codec string | documented in the binding as it is | changed |
| a package path | re-exported from its new place | removed |
| `engines/` conf names | prose says "agent runtime" | renamed |
| a template path a stamped repo copies | the file stays, with a header naming its new home | removed |

Every kind except package paths is **closed**: the check enumerates the tree, and a surface of
that kind that is not listed here fails too — register it in the same commit that adds it
(`node scripts/check-compat.mjs --list` prints every block in this file's format). Package paths
are **declared**: only the paths listed are public; every other `tools/lib` module is internal and
may move without a stub.

A codec line pins its value (`NAME = "value"`; an array is pinned joined with `,`, the label
vocabulary as its names). Regular expressions are pinned by `tools/lib/codec/samples.json`'s
round-trip instead.

## Retiring a surface

A surface is retired only in a minor (or major) release whose notes name it, after a measured
search of known adopters shows nothing still uses it. In this file that is one line in the
`compat retired` block, replacing the surface's line in its own block:

    <kind> <name> — vX.Y.0 — <the adopter search and what it found>

The check refuses a removal from any block that has no retired line (it compares this file
with its copy at `--base`), a retired version with a non-zero patch number, a newly retired
surface whose version is already tagged, and a line with no evidence.

## The list

```compat heading
engineering-conventions
1-the-model-in-one-picture
why-the-split-exists-at-all
hard-rules-and-defaults
glossary
2-tiers
room--who-else-is-here
exposure--what-consumes-a-merge-here
ceremony--narration-follows-the-room-recoverability-follows-exposure
recovery--what-must-exist-to-undo-a-merge
writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory
writes-direct--declared-today-runtime-deferred-283
phase-a--phase-b-under-direct---ruled-284-the-merge-goes-the-evidence-stays
autonomy--the-docs-only-exception-345
autonomy--the-tuning-only-class-561
autonomy--the-human-door-525
core-paths--a-pr-and-a-non-author-approval-before-landing-350
contention--what-may-run-at-once-636
solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard
place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not
channels--by-what-path-does-code-reach-the-thing-that-runs-it
3-githubprojectyml--the-marker
boot-recipe--an-entry-point-the-repo-owns-not-a-table-a-consumer-keeps
4-branches-and-commits
branch-ci--the-candidates-own-run-read-as-a-class-314
docs-only--no-ci-wait-606
who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409
batch-landing--one-combined-run-then-a-fast-forward-373
is-a-shipped-half-actually-shippable--the-mechanical-gate-is-not-the-judgement-call-263
has-it-landed--the-one-rule-because-the-obvious-one-is-wrong
5-claiming-work--how-to-say-im-on-this
who-holds-this
record-of-a-claim--the-branch-on-the-remote
mirror-for-people--github
fast-path--local-cache
rules
tracking-issues--claimed-but-referenced-not-closed
human-verify--a-person-only-check-closes-the-issue-and-becomes-one-row-491
who-decided-it-should-exist
provenance--who-decided-the-work-should-exist
ask--the-filer-declares-the-ask-class-89
what-may-start
readiness--open-and-unclaimed-is-not-enough
readiness-is-not-a-boolean--read-the-blockers-state-not-just-its-existence
mechanical-readiness--a-weaker-honest-claim-for-the-empty-case-69
disposition--a-park-must-name-its-wake-condition-279
holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360
the-wake-vocabulary--a-wake-a-scheduler-can-check-382
the-shape-field--what-the-owner-is-asked-for-569
disposition--the-marker-the-seven-kinds-and-who-may-apply-one-315
who-may-apply-one--a-table-over-measurable-inputs-never-a-judgement-call
decision-gate--a-human-must-answer-first-122
decision-options--what-a-ruling-chooses-between-126
design-approval-ask--the-mockup-line-379
an-ask-is-said-once--a-later-pass-reports-that-it-is-still-waiting-489
an-ask-the-human-must-answer-can-be-raised-once-in-a-decision-box-490
the-human-flag--what-colab_human1-asserts
migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402
a-red-trunk-with-no-patch--never-parked-in-silence-390
red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105
cure-rule--the-machine-checkable-door-through-trunk-ci-green-281
scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person
grouping--issues-that-change-the-same-logic-share-one-branch
scope--diagnosing-across-repos-is-not-license-to-act-in-them
epics--a-container-is-not-a-start-candidate
switched-epics--concurrent-unfinished-features-336
delivery-type--route-not-start-112
priority--a-throttle-not-a-veto-268
how-a-decision-is-recorded
planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94
writing-a-conclusion-down--the-decision-and-the-document-are-two-units
design-conclusions-are-three-units-not-two
design-exploration-files-its-issue-first--before-the-first-mockup-not-after
6-releases
distribution--one-install-surface-npx-442
services-over-npx--init-update-rollback-465
7-ci-and-toolchain
what-ship-reads--the-ci-contract-607
two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607
integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610
ci--what-it-is-follows-the-units-shape-how-much-follows-exposure
ci-artifacts--your-own-store-not-the-allowance-601
self-hosted-runners--capacity-is-the-agent-count-not-the-machine-355
toolchain-versions--strict-precedence
test-fixtures--neutralise-ambient-machine-state-dont-inherit-it
8-conformance-and-reconciliation
how-repos-find-out-when-the-handbook-changes
labels-reconcile-too--not-just-stamped-files
local-policy--a-repo-refines-a-skill-without-forking-it-520
upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362
refusals-name-the-next-command-532
the-fleet-registry-is-private
9-adopting-this
any-repo-first-time-adoption
going-live-tier-b--tier-c-or-tier-a
tier-c--tier-a--when-the-site-earns-a-release-ritual
working-in-a-repo-you-dont-own
a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449
fixtures-and-examples-use-invented-values
10-anti-patterns
11-quick-reference
```

```compat skill
code-plan
code-ship
code-start
code-sweep
code-triage
code-wrap
handbook-sync
migration-review
release-rung
```

```compat command
claim
release
issue-filed
close
gate-recorded
gate-hermetic
solo
place
places
readiness
blocked
migration-grant
owner-policy
decision
ci-grant
claims
port
ports
worktree
worktrees
ship
landed
batch-stats
ci-profile
thresholds
trunk-ci
ci-wait
holders
instruction-files
promote
deliver
doctor
release-notes
release-status
template
adopt
update
register
labels
config
```

```compat key
tier
trunk
production
deploy
runbook
stack
integration
releaseBranch
owner
ports
worktreePorts
autonomy
ship-batch
ship-batch-wait
ship-batch-steps
ci-wait-factor
thresholds
migrations
migration-grant
ci-grant
trust-humans
room
branchPrefix
holds
exposure
channels
distribution
ceremony
writes
contention
promotion
release
generated
live-env
tree-reuse
ci-docs-skip
docs-only-paths
instruction-files
ship-gate-workflows
ship-ignore-workflows
integration-profile
heavy-workflow
gate
node
php
python
```

```compat codec
MINIMAL_LABEL_NAMES = "in-progress,deps-checked,agent-filed,epic"
READINESS_LABEL = "deps-checked"
TRACKING_LABEL = "tracking"
MECHANICAL_READINESS_LABEL = "graph-empty"
MIGRATION_GRANT_LABEL = "migration-granted"
CI_GRANT_LABEL = "ci-granted"
NEEDS_DECISION_LABEL = "needs-decision"
DECISION_RECORDED_LABEL = "decision-recorded"
GROUP_LABEL_PREFIX = "group:"
DELIVERY_LABEL_PREFIX = "delivery:"
DELIVERY_TYPES = "code,content,ops,docs-only,elsewhere,design"
CODE_LANE_DELIVERY_TYPES = "code,docs-only"
NON_CODE_DELIVERY_TYPES = "content,ops,elsewhere,design"
DEFERRED_LABEL_PREFIX = "deferred:"
DEFERRED_KINDS = "date,measurement,external-party"
REVIEW_BY_LABEL_PREFIX = "review-by:"
CLAIM_MARK = "🔒 Claimed"
RELEASE_MARK = "✅ Released"
MIGRATION_GRANT_MARK = "🛢 Migration grant"
MIGRATION_REVOKE_MARK = "🚫 Migration grant revoked"
REVIEW_GRANT_MARK = "🔎 Migration review grant"
REVIEWER_ROLE = "migration-reviewer"
REVIEW_RECORD_FENCE = "migration-review"
REVIEW_RECORD_VERSION = "1"
REVIEW_GRANT_TAIL = " — bound to this HEAD: any new commit voids it; expires when this issue closes."
REVIEW_GRANT_CONTENT_TAIL = " — bound to the reviewed migration content: a change to any migration file voids it; expires when this issue closes."
CI_GRANT_MARK = "🚨 Red-trunk CI grant"
CI_REVOKE_MARK = "🧯 Red-trunk CI grant revoked"
CI_REVIEW_GRANT_MARK = "🩹 Red-trunk CI review grant"
CI_REVIEWER_ROLE = "ci-reviewer"
CI_REVIEW_RECORD_FENCE = "ci-review"
CI_REVIEW_RECORD_VERSION = "1"
CI_CURES_SEPARATOR = ";"
DECISION_MARK = "⚖ Decision recorded"
REOPEN_MARK = "↩ Decision reopened"
WAKE_KINDS = "review-by,edge,ruling,issueClosed,branchLanded,trunkAt,labelPresent,after"
CHECKABLE_KINDS = "issueClosed,branchLanded,trunkAt,labelPresent,after"
WAKE_KINDS_TEXT = "review-by:<date> · #N · ruling · issueClosed:<n|owner/repo#n> · branchLanded:<ref> · trunkAt:<sha> · labelPresent:<label> · after:<date>"
HOLD_SHAPES = "ask,task,wait"
CLOSE_REASONS = "completed,not-planned"
CONVENTION_LABELS = "in-progress,deps-checked,agent-filed,epic,needs-decision,decision-recorded,needs-plan,migration-granted,needs-migration-grant,ci-granted,low-priority,priority:now,priority:high,delivery:code,delivery:content,delivery:ops,delivery:docs-only,delivery:elsewhere,delivery:design,deferred:date,deferred:measurement,deferred:external-party,release-hold"
```

```compat export
tools/lib/codec/index.js
tools/lib/codec/index.d.ts
tools/lib/codec/labels.js
tools/lib/codec/labels.d.ts
tools/lib/codec/claim.js
tools/lib/codec/claim.d.ts
tools/lib/codec/grants.js
tools/lib/codec/grants.d.ts
tools/lib/codec/decision.js
tools/lib/codec/decision.d.ts
tools/lib/codec/hold.js
tools/lib/codec/hold.d.ts
tools/lib/codec/release.js
tools/lib/codec/release.d.ts
tools/lib/codec/markers.js
tools/lib/codec/markers.d.ts
tools/lib/codec/samples.json
tools/lib/migration-grant.js
tools/colab
audit/audit.mjs
```
```compat engine
claude
codex
generic
```

```compat template
templates/README.md
templates/adr-README.md
templates/branch-name.yml
templates/ci-laravel-heavy.yml
templates/ci-laravel.yml
templates/ci-node-heavy.yml
templates/ci-node.yml
templates/ci-python-heavy.yml
templates/ci-python.yml
templates/deploy-adapter-portainer.mjs
templates/deploy-container-run.mjs
templates/deploy-container.yml
templates/deploy-xserver.yml
templates/dist-refs.yml
templates/docs-lint.mjs
templates/docs-lint.yml
templates/gotchas-d-README.md
templates/identity-vocabulary.example
templates/instruction-files.yml
templates/npx-launcher.mjs
templates/npx-service.mjs
templates/pre-commit-dispatch
templates/pre-commit-identity
templates/pre-commit-instruction-files
templates/pre-push-guard
templates/release-auto.yml
templates/release-tag.yml
templates/repo-CLAUDE-block.md
```

```compat retired
# <kind> <name> — vX.Y.0 — <evidence>
```
