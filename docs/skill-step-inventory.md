# Skill step inventory — the #524 core/reference split

One section per split skill. Each records the baseline the split was measured against, the
checker's verdict, and where every section of the old single-file skill now lives. The proof
that nothing was dropped is mechanical, not this table: `scripts/check-skill-split.mjs` cuts the
old file into units (paragraph, list item, table row, fenced block, heading) and requires each
one in the core plus its reference files, and every numbered heading in the core. This table
is the human index to it — which old lines went to which file — for a reviewer and for #536,
which moves the rationale on to `docs/adr/`.

Re-run any row: `node scripts/check-skill-split.mjs --base <baseline> --skill <name>`. Lines are
the old file's, at the baseline. A range not listed under *Reference files* stayed in the core,
verbatim (intro, Principle, the tables and short command loops a run executes, Verify complete).

**#517 rides on this split.** Its fix (`code-sweep` §3 test 3: `↩️ Sent back` added to the
bookkeeping prefixes, a bare one-line signature dropped, the send-back idempotency rule and a
walk-through) landed first, in `8100a323`, on the single file. `code-sweep` was then split from
that commit, so the checker held the fixed filter to the move like any other unit; it now lives
in [`3-orphan-shippable.md`](../skills/code-sweep/3-orphan-shippable.md), and
`tools/lib/skill-size.test.js` pins it.

## `code-sweep`

- Baseline: `8100a323` · old file 1148 lines
- Checker: units 252 · found 252 · missing 0 · numbered headings not in core 0
- Core: 319 lines, 24302 bytes · reference files: 16

| old lines | section | reference file |
|---|---|---|
| 52–108 | §0 Has anything changed? | [`0-fingerprint.md`](../skills/code-sweep/0-fingerprint.md) |
| 109–182 | §0.1 Resume an interrupted sweep — and the `$CACHE` record | [`0.1-resume-and-cache.md`](../skills/code-sweep/0.1-resume-and-cache.md) |
| 215–240 | §1.2 `unrecorded` rows are candidates too | [`1.2-unrecorded-rows.md`](../skills/code-sweep/1.2-unrecorded-rows.md) |
| 241–313 | §1.3 Remote refs | [`1.3-remote-refs.md`](../skills/code-sweep/1.3-remote-refs.md) |
| 314–390 | §1.1 Scoped mode | [`1.1-scoped-mode.md`](../skills/code-sweep/1.1-scoped-mode.md) |
| 391–430 | §2 What "finished" means | [`2-finished.md`](../skills/code-sweep/2-finished.md) |
| 457–485 | §3 bucket `send-back` | [`3-send-back.md`](../skills/code-sweep/3-send-back.md) |
| 486–512 | §3 bucket `spent-remote` | [`3-spent-remote.md`](../skills/code-sweep/3-spent-remote.md) |
| 513–613 | §3 bucket `orphan-shippable` | [`3-orphan-shippable.md`](../skills/code-sweep/3-orphan-shippable.md) |
| 614–670 | §3 buckets `place-claim` and `teardown-only` | [`3-place-claim-and-teardown.md`](../skills/code-sweep/3-place-claim-and-teardown.md) |
| 671–744 | §3 buckets `unrecorded` and `unlinked`, and the teardown commands | [`3-unrecorded-and-unlinked.md`](../skills/code-sweep/3-unrecorded-and-unlinked.md) |
| 747–811 | §4.0 Order the pass by readiness | [`4.0-order.md`](../skills/code-sweep/4.0-order.md) |
| 841–890 | §4 A failure defers that candidate | [`4-failure-defers.md`](../skills/code-sweep/4-failure-defers.md) |
| 891–966 | §5 Reconcile the tracker | [`5-reconcile.md`](../skills/code-sweep/5-reconcile.md) |
| 967–1028 | §5.1 Re-derive once more before you stop | [`5.1-rederive.md`](../skills/code-sweep/5.1-rederive.md) |
| 1029–1096 | §6 Report | [`6-report.md`](../skills/code-sweep/6-report.md) |

## `code-ship`

- Baseline: `56fe48dd` · old file 1895 lines
- Checker: units 358 · found 358 · missing 0 · numbered headings not in core 0
- Core: 294 lines, 19654 bytes · reference files: 19

| old lines | section | reference file |
|---|---|---|
| 55–186 | §0 Verify the hand-off contract | [`0-handoff-contract.md`](../skills/code-ship/0-handoff-contract.md) |
| 187–262 | What counts as "a human said go" | [`go-ahead.md`](../skills/code-ship/go-ahead.md) |
| 263–306 | What a defer is for (#257) | [`defer.md`](../skills/code-ship/defer.md) |
| 307–529 | B0 Is there still cargo? Then sync `<base>` | [`b0-sync.md`](../skills/code-ship/b0-sync.md) |
| 530–573 | B0 Batch landing (#373) | [`b0-batch-landing.md`](../skills/code-ship/b0-batch-landing.md) |
| 574–609 | B1 Verify CI on `<base>` | [`b1-base-ci.md`](../skills/code-ship/b1-base-ci.md) |
| 610–679 | B1 Red trunk (#353, #354) | [`b1-red-trunk.md`](../skills/code-ship/b1-red-trunk.md) |
| 680–816 | B1a The branch's own CI | [`b1a-branch-ci.md`](../skills/code-ship/b1a-branch-ci.md) |
| 817–951 | B1b Harvest every issue the branch carried | [`b1b-harvest.md`](../skills/code-ship/b1b-harvest.md) |
| 952–990 | B1c Grade the diff against the plan (#94) | [`b1c-grade.md`](../skills/code-ship/b1c-grade.md) |
| 991–1077 | B1c UI-affecting issues and children of a switched epic | [`b1c-ui-and-switched-epics.md`](../skills/code-ship/b1c-ui-and-switched-epics.md) |
| 1078–1218 | B1c Reject classes — decision, escalate, rework (#262, #328) | [`b1c-reject-classes.md`](../skills/code-ship/b1c-reject-classes.md) |
| 1219–1310 | B2 Squash-merge with `Closes #N` | [`b2-squash.md`](../skills/code-ship/b2-squash.md) |
| 1311–1360 | B2a Read the trunk run at your squash (#374) | [`b2a-trunk-run.md`](../skills/code-ship/b2a-trunk-run.md) |
| 1361–1521 | B2b Evidence on every issue, and the grade marker | [`b2b-evidence.md`](../skills/code-ship/b2b-evidence.md) |
| 1522–1602 | B2c Update the parent epic | [`b2c-epic.md`](../skills/code-ship/b2c-epic.md) |
| 1603–1640 | B2d Tear down a spent `group:<key>` label (#82) | [`b2d-group-label.md`](../skills/code-ship/b2d-group-label.md) |
| 1641–1689 | B3 Release the claim(s) | [`b3-release-claims.md`](../skills/code-ship/b3-release-claims.md) |
| 1690–1838 | B4 Tear down the worktree, delete the plan file | [`b4-teardown.md`](../skills/code-ship/b4-teardown.md) |

## `code-wrap`

- Baseline: `56fe48dd` · old file 955 lines
- Checker: units 224 · found 224 · missing 0 · numbered headings not in core 0
- Core: 399 lines, 24807 bytes · reference files: 18

| old lines | section | reference file |
|---|---|---|
| 44–95 | Did this session open with `colab solo`? | [`0-solo-exit.md`](../skills/code-wrap/0-solo-exit.md) |
| 123–164 | A1 Filing a follow-up — agent-filed | [`a1-follow-up.md`](../skills/code-wrap/a1-follow-up.md) |
| 189–199 | A2 Every doc lands on this branch, never on trunk | [`a2-on-this-branch.md`](../skills/code-wrap/a2-on-this-branch.md) |
| 200–243 | A2 Design artifact — promote it onto this branch | [`a2-design-artifact.md`](../skills/code-wrap/a2-design-artifact.md) |
| 244–271 | A2 A comment at the call site | [`a2-call-site-comment.md`](../skills/code-wrap/a2-call-site-comment.md) |
| 272–315 | A2 Issue-keyed naming (gotchas, ADRs) | [`a2-issue-keyed-naming.md`](../skills/code-wrap/a2-issue-keyed-naming.md) |
| 316–358 | A2 `CLAUDE.md` is a router, not an archive | [`a2-claude-md-router.md`](../skills/code-wrap/a2-claude-md-router.md) |
| 359–383 | A2 A new rule is a follow-up unit | [`a2-new-rule.md`](../skills/code-wrap/a2-new-rule.md) |
| 384–402 | A2 `docs-lint` | [`a2-docs-lint.md`](../skills/code-wrap/a2-docs-lint.md) |
| 418–489 | A2b Committed strays and the ownership ladder | [`a2b-ownership-ladder.md`](../skills/code-wrap/a2b-ownership-ladder.md) |
| 545–606 | A3 The hermetic run — what it does, its verdicts, the branch-CI stand-in | [`a3-hermetic-rules.md`](../skills/code-wrap/a3-hermetic-rules.md) |
| 607–642 | A3 Read the verdict, not the transcript | [`a3-read-the-verdict.md`](../skills/code-wrap/a3-read-the-verdict.md) |
| 643–660 | A3 Notify the dashboard | [`a3-notify-dashboard.md`](../skills/code-wrap/a3-notify-dashboard.md) |
| 661–719 | A3b Request a migration grant | [`a3b-migration-grant.md`](../skills/code-wrap/a3b-migration-grant.md) |
| 737–761 | A5 Read the run the push started | [`a5-read-the-run.md`](../skills/code-wrap/a5-read-the-run.md) |
| 773–815 | A5 Reading the branch-CI class | [`a5-reading-the-class.md`](../skills/code-wrap/a5-reading-the-class.md) |
| 859–894 | Hand off — a missing plan file | [`handoff-missing-plan.md`](../skills/code-wrap/handoff-missing-plan.md) |
| 895–926 | Hand off — a partial wrap is a checkpoint | [`handoff-partial-wrap.md`](../skills/code-wrap/handoff-partial-wrap.md) |

## `code-triage`

- Baseline: `56fe48dd` · old file 2498 lines
- Checker: units 498 · found 498 · missing 0 · numbered headings not in core 0
- Core: 400 lines, 28946 bytes · reference files: 32

| old lines | section | reference file |
|---|---|---|
| 35–133 | §0 The fingerprint and the short-circuit | [`0-fingerprint.md`](../skills/code-triage/0-fingerprint.md) |
| 134–229 | §0 Pending wakes, an unowned red trunk, and waiting on a human | [`0-wakes-and-red-trunk.md`](../skills/code-triage/0-wakes-and-red-trunk.md) |
| 247–412 | §0 Why each input reads what it reads | [`0-fingerprint-notes.md`](../skills/code-triage/0-fingerprint-notes.md) |
| 414–534 | §0.1 Persist the conclusion — the required `$CACHE` record | [`0.1-conclusion-record.md`](../skills/code-triage/0.1-conclusion-record.md) |
| 570–656 | §0.2 Running this twice must change nothing — the read-before-write rules | [`0.2-idempotence.md`](../skills/code-triage/0.2-idempotence.md) |
| 658–751 | §0.3 Per-issue verdict cache | [`0.3-verdict-cache.md`](../skills/code-triage/0.3-verdict-cache.md) |
| 753–793 | §1 Gather | [`1-gather.md`](../skills/code-triage/1-gather.md) |
| 795–857 | §2 Taken, half-claims, and parked `deferred:*` claims | [`2-taken.md`](../skills/code-triage/2-taken.md) |
| 858–889 | §2 Already shipped | [`2-already-shipped.md`](../skills/code-triage/2-already-shipped.md) |
| 890–943 | §2 Containers, epic findings and release tracking issues | [`2-epics.md`](../skills/code-triage/2-epics.md) |
| 944–997 | §2 A switched epic — reading its switch | [`2-switched-epics.md`](../skills/code-triage/2-switched-epics.md) |
| 998–1036 | §2 Non-code delivery — route or design | [`2-non-code-delivery.md`](../skills/code-triage/2-non-code-delivery.md) |
| 1037–1134 | §2 Held — holds, wakes, and the `FIXED` transcription | [`2-held.md`](../skills/code-triage/2-held.md) |
| 1136–1182 | §3 Group — when issues must serialize | [`3-group.md`](../skills/code-triage/3-group.md) |
| 1184–1228 | §3 Persist the group | [`3-persist-group.md`](../skills/code-triage/3-persist-group.md) |
| 1230–1340 | §3 The one-branch question — a second live branch is a finding | [`3-one-branch.md`](../skills/code-triage/3-one-branch.md) |
| 1342–1369 | §3 Record a measured collision on `Touches:` | [`3-touches.md`](../skills/code-triage/3-touches.md) |
| 1371–1404 | §4 Order by blast radius | [`4-order.md`](../skills/code-triage/4-order.md) |
| 1406–1498 | §4 Write the dependencies down as `blocked_by` edges | [`4-dependency-edges.md`](../skills/code-triage/4-dependency-edges.md) |
| 1500–1550 | §4 Single-issue mode and the `deps-checked` marker | [`4-single-issue.md`](../skills/code-triage/4-single-issue.md) |
| 1552–1675 | §5 The readiness gate — every gate in full | [`5-gates.md`](../skills/code-triage/5-gates.md) |
| 1677–1703 | §5 Every label that affects a start | [`5-start-labels.md`](../skills/code-triage/5-start-labels.md) |
| 1705–1753 | §5.1 An open blocker is not one verdict | [`5.1-blocker-state.md`](../skills/code-triage/5.1-blocker-state.md) |
| 1755–1823 | §5.2 A red trunk with no patch yet | [`5.2-trunk-red.md`](../skills/code-triage/5.2-trunk-red.md) |
| 1825–1863 | §6 Console output, and the `DRY` block | [`6-console-and-dry.md`](../skills/code-triage/6-console-and-dry.md) |
| 1864–2027 | §6 Ready lines — `start:`, soft-ready, `mechanical:`, `priority:`, `design:` | [`6-ready-lines.md`](../skills/code-triage/6-ready-lines.md) |
| 2028–2151 | §6 Blocked, `ASKED`, taken, close, epic, route and design lines | [`6-buckets.md`](../skills/code-triage/6-buckets.md) |
| 2152–2221 | §6 Findings and the limits lines | [`6-findings.md`](../skills/code-triage/6-findings.md) |
| 2228–2274 | §6 Persist each verdict | [`6-persist-verdicts.md`](../skills/code-triage/6-persist-verdicts.md) |
| 2276–2310 | §6 Flag hard groups with `needs-plan` | [`6-needs-plan.md`](../skills/code-triage/6-needs-plan.md) |
| 2312–2369 | §6 Flag delegable groups with `mechanical-lane` | [`6-mechanical-lane.md`](../skills/code-triage/6-mechanical-lane.md) |
| 2371–2402 | §6 Rank `low-priority` groups last | [`6-low-priority.md`](../skills/code-triage/6-low-priority.md) |

## #536 — rationale moved on to `docs/adr/`

The split above moved text verbatim and left history beside the rules. #536 moved the
incident write-ups and measurements out of the reference files of all four split skills
into one ADR per reference file, `docs/adr/536-<skill>-<file>-rationale.md`, verbatim (whole
units, or a mixed unit cut at a sentence boundary), and left one `Why: [ADR 536](…)` link
where the text was. No core `SKILL.md` was touched, so every numbered heading and every
budget above is unchanged. Decision: [ADR 536](adr/536-skill-rationale-to-adrs.md).

- Baseline: `f69b9927`
- Check: `node scripts/check-doc-move.mjs --base f69b9927 --files <every reference file of
  the four skills> --into docs/adr` → `missing 0 · headings gone from their file 0 · ledger
  entries 0 (stale 0)`. Every unit of every reference file at the baseline is in the same
  file or an ADR, whole or sentence by sentence; no rewrite, so no ledger.
- `tools/lib/skill-size.test.js`: 30 of 30, including every relative link from the skills
  into `docs/adr/`.

### `code-triage` — 11 of 33 reference files lost rationale

| reference file | lines | ADR |
|---|---|---|
| [`0-fingerprint-notes.md`](../skills/code-triage/0-fingerprint-notes.md) | 171 → 144 | [`536-code-triage-0-fingerprint-notes-rationale.md`](adr/536-code-triage-0-fingerprint-notes-rationale.md) |
| [`0-fingerprint.md`](../skills/code-triage/0-fingerprint.md) | 104 → 90 | [`536-code-triage-0-fingerprint-rationale.md`](adr/536-code-triage-0-fingerprint-rationale.md) |
| [`0-wakes-and-red-trunk.md`](../skills/code-triage/0-wakes-and-red-trunk.md) | 101 → 98 | [`536-code-triage-0-wakes-and-red-trunk-rationale.md`](adr/536-code-triage-0-wakes-and-red-trunk-rationale.md) |
| [`0.2-idempotence.md`](../skills/code-triage/0.2-idempotence.md) | 100 → 100 | [`536-code-triage-0.2-idempotence-rationale.md`](adr/536-code-triage-0.2-idempotence-rationale.md) |
| [`0.3-verdict-cache.md`](../skills/code-triage/0.3-verdict-cache.md) | 99 → 98 | [`536-code-triage-0.3-verdict-cache-rationale.md`](adr/536-code-triage-0.3-verdict-cache-rationale.md) |
| [`2-non-code-delivery.md`](../skills/code-triage/2-non-code-delivery.md) | 44 → 44 | [`536-code-triage-2-non-code-delivery-rationale.md`](adr/536-code-triage-2-non-code-delivery-rationale.md) |
| [`3-group.md`](../skills/code-triage/3-group.md) | 52 → 53 | [`536-code-triage-3-group-rationale.md`](adr/536-code-triage-3-group-rationale.md) |
| [`3-touches.md`](../skills/code-triage/3-touches.md) | 33 → 31 | [`536-code-triage-3-touches-rationale.md`](adr/536-code-triage-3-touches-rationale.md) |
| [`5.1-blocker-state.md`](../skills/code-triage/5.1-blocker-state.md) | 54 → 54 | [`536-code-triage-5.1-blocker-state-rationale.md`](adr/536-code-triage-5.1-blocker-state-rationale.md) |
| [`5.2-trunk-red.md`](../skills/code-triage/5.2-trunk-red.md) | 89 → 89 | [`536-code-triage-5.2-trunk-red-rationale.md`](adr/536-code-triage-5.2-trunk-red-rationale.md) |
| [`6-console-and-dry.md`](../skills/code-triage/6-console-and-dry.md) | 44 → 43 | [`536-code-triage-6-console-and-dry-rationale.md`](adr/536-code-triage-6-console-and-dry-rationale.md) |

### `code-ship` — 12 of 19 reference files lost rationale

| reference file | lines | ADR |
|---|---|---|
| [`0-handoff-contract.md`](../skills/code-ship/0-handoff-contract.md) | 137 → 137 | [`536-code-ship-0-handoff-contract-rationale.md`](adr/536-code-ship-0-handoff-contract-rationale.md) |
| [`b0-sync.md`](../skills/code-ship/b0-sync.md) | 240 → 233 | [`536-code-ship-b0-sync-rationale.md`](adr/536-code-ship-b0-sync-rationale.md) |
| [`b1-red-trunk.md`](../skills/code-ship/b1-red-trunk.md) | 115 → 111 | [`536-code-ship-b1-red-trunk-rationale.md`](adr/536-code-ship-b1-red-trunk-rationale.md) |
| [`b1a-branch-ci.md`](../skills/code-ship/b1a-branch-ci.md) | 142 → 138 | [`536-code-ship-b1a-branch-ci-rationale.md`](adr/536-code-ship-b1a-branch-ci-rationale.md) |
| [`b1b-harvest.md`](../skills/code-ship/b1b-harvest.md) | 140 → 134 | [`536-code-ship-b1b-harvest-rationale.md`](adr/536-code-ship-b1b-harvest-rationale.md) |
| [`b1c-reject-classes.md`](../skills/code-ship/b1c-reject-classes.md) | 146 → 131 | [`536-code-ship-b1c-reject-classes-rationale.md`](adr/536-code-ship-b1c-reject-classes-rationale.md) |
| [`b2-squash.md`](../skills/code-ship/b2-squash.md) | 97 → 96 | [`536-code-ship-b2-squash-rationale.md`](adr/536-code-ship-b2-squash-rationale.md) |
| [`b2a-trunk-run.md`](../skills/code-ship/b2a-trunk-run.md) | 55 → 54 | [`536-code-ship-b2a-trunk-run-rationale.md`](adr/536-code-ship-b2a-trunk-run-rationale.md) |
| [`b2b-evidence.md`](../skills/code-ship/b2b-evidence.md) | 166 → 164 | [`536-code-ship-b2b-evidence-rationale.md`](adr/536-code-ship-b2b-evidence-rationale.md) |
| [`b2c-epic.md`](../skills/code-ship/b2c-epic.md) | 86 → 83 | [`536-code-ship-b2c-epic-rationale.md`](adr/536-code-ship-b2c-epic-rationale.md) |
| [`b4-teardown.md`](../skills/code-ship/b4-teardown.md) | 154 → 153 | [`536-code-ship-b4-teardown-rationale.md`](adr/536-code-ship-b4-teardown-rationale.md) |
| [`defer.md`](../skills/code-ship/defer.md) | 56 → 56 | [`536-code-ship-defer-rationale.md`](adr/536-code-ship-defer-rationale.md) |

### `code-sweep` — 9 of 16 reference files lost rationale

| reference file | lines | ADR |
|---|---|---|
| [`1.1-scoped-mode.md`](../skills/code-sweep/1.1-scoped-mode.md) | 82 → 82 | [`536-code-sweep-1.1-scoped-mode-rationale.md`](adr/536-code-sweep-1.1-scoped-mode-rationale.md) |
| [`1.3-remote-refs.md`](../skills/code-sweep/1.3-remote-refs.md) | 78 → 78 | [`536-code-sweep-1.3-remote-refs-rationale.md`](adr/536-code-sweep-1.3-remote-refs-rationale.md) |
| [`3-orphan-shippable.md`](../skills/code-sweep/3-orphan-shippable.md) | 106 → 93 | [`536-code-sweep-3-orphan-shippable-rationale.md`](adr/536-code-sweep-3-orphan-shippable-rationale.md) |
| [`3-spent-remote.md`](../skills/code-sweep/3-spent-remote.md) | 32 → 33 | [`536-code-sweep-3-spent-remote-rationale.md`](adr/536-code-sweep-3-spent-remote-rationale.md) |
| [`4-failure-defers.md`](../skills/code-sweep/4-failure-defers.md) | 61 → 52 | [`536-code-sweep-4-failure-defers-rationale.md`](adr/536-code-sweep-4-failure-defers-rationale.md) |
| [`4.0-order.md`](../skills/code-sweep/4.0-order.md) | 83 → 79 | [`536-code-sweep-4.0-order-rationale.md`](adr/536-code-sweep-4.0-order-rationale.md) |
| [`5-reconcile.md`](../skills/code-sweep/5-reconcile.md) | 81 → 76 | [`536-code-sweep-5-reconcile-rationale.md`](adr/536-code-sweep-5-reconcile-rationale.md) |
| [`5.1-rederive.md`](../skills/code-sweep/5.1-rederive.md) | 67 → 57 | [`536-code-sweep-5.1-rederive-rationale.md`](adr/536-code-sweep-5.1-rederive-rationale.md) |
| [`6-report.md`](../skills/code-sweep/6-report.md) | 73 → 72 | [`536-code-sweep-6-report-rationale.md`](adr/536-code-sweep-6-report-rationale.md) |

### `code-wrap` — 10 of 18 reference files lost rationale

| reference file | lines | ADR |
|---|---|---|
| [`a2-claude-md-router.md`](../skills/code-wrap/a2-claude-md-router.md) | 48 → 42 | [`536-code-wrap-a2-claude-md-router-rationale.md`](adr/536-code-wrap-a2-claude-md-router-rationale.md) |
| [`a2-issue-keyed-naming.md`](../skills/code-wrap/a2-issue-keyed-naming.md) | 49 → 42 | [`536-code-wrap-a2-issue-keyed-naming-rationale.md`](adr/536-code-wrap-a2-issue-keyed-naming-rationale.md) |
| [`a2-new-rule.md`](../skills/code-wrap/a2-new-rule.md) | 30 → 30 | [`536-code-wrap-a2-new-rule-rationale.md`](adr/536-code-wrap-a2-new-rule-rationale.md) |
| [`a2-on-this-branch.md`](../skills/code-wrap/a2-on-this-branch.md) | 16 → 12 | [`536-code-wrap-a2-on-this-branch-rationale.md`](adr/536-code-wrap-a2-on-this-branch-rationale.md) |
| [`a3-hermetic-rules.md`](../skills/code-wrap/a3-hermetic-rules.md) | 67 → 60 | [`536-code-wrap-a3-hermetic-rules-rationale.md`](adr/536-code-wrap-a3-hermetic-rules-rationale.md) |
| [`a3-read-the-verdict.md`](../skills/code-wrap/a3-read-the-verdict.md) | 41 → 34 | [`536-code-wrap-a3-read-the-verdict-rationale.md`](adr/536-code-wrap-a3-read-the-verdict-rationale.md) |
| [`a5-read-the-run.md`](../skills/code-wrap/a5-read-the-run.md) | 30 → 28 | [`536-code-wrap-a5-read-the-run-rationale.md`](adr/536-code-wrap-a5-read-the-run-rationale.md) |
| [`a5-reading-the-class.md`](../skills/code-wrap/a5-reading-the-class.md) | 48 → 48 | [`536-code-wrap-a5-reading-the-class-rationale.md`](adr/536-code-wrap-a5-reading-the-class-rationale.md) |
| [`handoff-missing-plan.md`](../skills/code-wrap/handoff-missing-plan.md) | 41 → 38 | [`536-code-wrap-handoff-missing-plan-rationale.md`](adr/536-code-wrap-handoff-missing-plan-rationale.md) |
| [`handoff-partial-wrap.md`](../skills/code-wrap/handoff-partial-wrap.md) | 37 → 34 | [`536-code-wrap-handoff-partial-wrap-rationale.md`](adr/536-code-wrap-handoff-partial-wrap-rationale.md) |

### What still says "measured", and why it stayed

The Done-when asks that every remaining measurement or incident either sit in an ADR or be
justified as rule text. What stayed falls into four kinds; the per-unit list is on #536.

- **Glued to its rule.** The measurement shares a sentence with the rule it supports
  (`code-ship` B2 *squash* "measured … 5 s before", B2d's 29 s label race, B1's
  "we once merged for 12 hours"), or the checker's sentence splitter cannot cut between
  them without a reword (`code-triage` input 2 and input 5 notes, `0.2-idempotence`'s nine
  comments). Moving it would have meant rewording a rule, which this change does not do.
- **Referred back to.** A kept sentence points at it: "measurement 1" and "all six false
  positives above" in `code-triage` `3-one-branch.md`; "the three causes" in `code-sweep`
  `0-fingerprint.md`; "see the push bullet above" in `code-ship` `0-handoff-contract.md`;
  "The re-run half" in `code-triage` `5.2-trunk-red.md`.
- **Not history.** "Measured" as the ordinary verb of a rule ("measured met", "measured
  against trunk", "say which kind of `none` you measured"), and dated lines that are example
  output of a report format.
- **Kept on doubt.** The opening "why this exists" paragraphs of `code-triage`
  `6-needs-plan.md` and `6-mechanical-lane.md` carry no measurement and read as premise. A
  later pass may move them; this one kept what it was unsure of.

## Ledger — units edited rather than moved

None. Every unit of every old file is found verbatim (after the checker's normalisation:
whitespace, heading level, and the file part of a same-file anchor). The splitter retargeted
no same-file anchor in `code-sweep` or `code-ship`; any it retargeted elsewhere changed only
the file part of a link, which the normalisation reads as unchanged.

## Known, carried over unchanged

- `code-triage` *Verify complete* says "all six gates" while §5 lists nine. That mismatch
  predates the split; the split moved text and did not fix it.
- Line-number citations of these skills elsewhere (for example `skills/code-triage/SKILL.md:261`)
  are historical and now point into the core at a different line. Section-number citations
  (`code-ship` B1b, `code-sweep` §3) are unaffected: every numbered heading stayed in the core.
