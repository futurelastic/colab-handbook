'use strict';
/**
 * Tests for the convention-label set (tools/lib/labels.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * These are pure cases: they pin WHICH labels the conventions require and the exact
 * diff the audit uses to report a gap. The value is not the trivial set-difference — it
 * is that the list is load-bearing in three places (adoption provisions it, sync back-
 * fills it, the audit reports it missing), so a future edit that drops a label from the
 * set, or lets the diff read a label object as always-present, would silently disable the
 * very check #44 added. That is the regression this file exists to fail against.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  CONVENTION_LABELS, conventionLabelNames, missingConventionLabels,
  READINESS_LABEL, readinessLabelArgs, readinessMissingLabelHint,
  MECHANICAL_READINESS_LABEL, mechanicalReadinessLabelArgs,
  MIGRATION_GRANT_LABEL, migrationGrantLabelArgs, migrationGrantMissingLabelHint,
  CI_GRANT_LABEL, ciGrantLabelArgs, ciGrantMissingLabelHint,
  NEEDS_DECISION_LABEL, DECISION_RECORDED_LABEL, decisionRecordedMissingLabelHint,
  GROUP_LABEL_PREFIX, isGroupLabel, groupLabelNames,
  DELIVERY_LABEL_PREFIX, NON_CODE_DELIVERY_TYPES, deliveryType, isRouteNotStart,
  DEFERRED_LABEL_PREFIX, DEFERRED_KINDS, deferredKind, isDeferred,
  REVIEW_BY_LABEL_PREFIX, isReviewByLabel, reviewByLabelNames, parseReviewByDate,
} = require('./labels.js');

test('the convention set is exactly the nineteen labels §9 provisions, in canonical order', () => {
  assert.deepStrictEqual(
    conventionLabelNames(),
    ['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party'],
  );
  // Each carries what a provisioner needs — a name, a color, a description — so the audit
  // and `gh label create` cannot disagree about how the label is meant to look.
  for (const l of CONVENTION_LABELS) {
    assert.match(l.color, /^[0-9A-Fa-f]{6}$/, `${l.name} needs a 6-hex color`);
    assert.ok(l.description && l.description.length, `${l.name} needs a description`);
    // GitHub's real cap (#112: `gh label create` 422'd on a 107-char delivery:docs-only
    // description that read fine here — nothing pinned the limit before this).
    assert.ok(l.description.length <= 100, `${l.name}'s description is ${l.description.length} chars — gh label create rejects anything over 100`);
  }
});

test('a repo with every label is not flagged', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party', 'bug']),
    [],
  );
});

test('the readiness label absent is reported — the exact gap that silently un-fills the column', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'bug']),
    ['deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party'],
  );
});

test('a repo with the claim label only is missing everything else', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress']),
    ['deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party'],
  );
});

test('missing preserves canonical order regardless of the input order', () => {
  assert.deepStrictEqual(missingConventionLabels(['epic', 'agent-filed']), ['in-progress', 'deps-checked', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']);
});

test('a repo missing only epic (adopted before #78) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['epic'],
  );
});

test('a repo missing only needs-decision (renamed from needs-ruling, #75/#122) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['needs-decision'],
  );
});

test('a repo missing only decision-recorded (adopted before #121) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['decision-recorded'],
  );
});

test('a repo missing only needs-plan (adopted before #94) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['needs-plan'],
  );
});

test('a repo missing only migration-granted (adopted before #98) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['migration-granted'],
  );
});

test('a repo missing only needs-migration-grant (adopted before #230) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['needs-migration-grant'],
  );
});

test('a repo missing only ci-granted (adopted before #105) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['ci-granted'],
  );
});

test('a repo missing only low-priority (adopted before #268) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['low-priority'],
  );
});

test('a repo missing only the delivery:* set (adopted before #112, or before #274 for the fifth value) is flagged for exactly that gap', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere'],
  );
});

test('a repo with the pre-#274 delivery:* set is flagged only for the fifth value', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    ['delivery:elsewhere'],
  );
});

test('empty / null / undefined input reports the whole set (a bare repo, or unread labels)', () => {
  const all = ['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party'];
  assert.deepStrictEqual(missingConventionLabels([]), all);
  assert.deepStrictEqual(missingConventionLabels(null), all);
  assert.deepStrictEqual(missingConventionLabels(undefined), all);
});

test('the readiness marker name is one of the convention labels, not a second literal', () => {
  // `colab readiness`, the audit and the provisioner must all target the SAME string; if this
  // name ever drifts from the set, a readiness write lands a label the audit never checks.
  assert.equal(READINESS_LABEL, 'deps-checked');
  assert.ok(conventionLabelNames().includes(READINESS_LABEL));
});

test('readinessLabelArgs maps set⇒add and clear⇒remove against the one marker name', () => {
  assert.deepStrictEqual(readinessLabelArgs(), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({}), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({ clear: false }), ['--add-label', 'deps-checked']);
  assert.deepStrictEqual(readinessLabelArgs({ clear: true }), ['--remove-label', 'deps-checked']);
});

test('label OBJECTS count as present, not as always-missing', () => {
  // gh can return {name,...}; the diff must read the name, or it flags labels that exist.
  const present = [
    { name: 'in-progress' }, { name: 'deps-checked' }, { name: 'agent-filed' },
    { name: 'epic' }, { name: 'needs-decision' }, { name: 'decision-recorded' }, { name: 'needs-plan' }, { name: 'migration-granted' },
    { name: 'needs-migration-grant' }, { name: 'ci-granted' }, { name: 'low-priority' },
    { name: 'delivery:code' }, { name: 'delivery:content' }, { name: 'delivery:ops' }, { name: 'delivery:docs-only' },
    { name: 'delivery:elsewhere' },
    { name: 'deferred:date' }, { name: 'deferred:measurement' }, { name: 'deferred:external-party' },
  ];
  assert.deepStrictEqual(missingConventionLabels(present), []);
});

test('readinessMissingLabelHint fires exactly when the repo lacks deps-checked (#49)', () => {
  // The whole point of #49: a readiness ADD that fails because the label was never back-filled
  // must be diagnosed, not passed off as gh's raw "not found". So when the label is absent, the
  // hint names the label and the fix (handbook-sync); when it is present, there is no hint.
  const hint = readinessMissingLabelHint(['in-progress', 'bug']);
  assert.match(hint, /deps-checked/);
  assert.match(hint, /handbook-sync/);
  assert.equal(readinessMissingLabelHint(['in-progress', 'deps-checked', 'agent-filed']), null);
  // Objects, not just strings — gh label reads can arrive either shape (mirrors the test above).
  assert.equal(readinessMissingLabelHint([{ name: 'deps-checked' }]), null);
});

test('readinessMissingLabelHint returns null when the label set could not be READ', () => {
  // null present ≠ empty set. A read we did not get (no gh, no remote, network) must fall back to
  // the generic gh error, NEVER assert "the label is missing" — that would misdiagnose every
  // offline failure as an adoption gap. Distinct from [] / bare repo, which genuinely lacks it.
  assert.equal(readinessMissingLabelHint(null), null);
  assert.equal(readinessMissingLabelHint(undefined), null);
  assert.match(readinessMissingLabelHint([]), /deps-checked/);
});

// #82 — colab ship's B4 group-label teardown: once every member of a group:<key> label is
// closed, the label OBJECT is deleted (gh label delete). These two functions are the pure half
// of that: which label names on an issue are group markers, and — unioned across a branch's
// issues — which ones colab ship should even bother checking membership for.

test('isGroupLabel matches only the prefixed shape, never the bare prefix or an unrelated label', () => {
  assert.equal(isGroupLabel('group:import-fixes'), true);
  assert.equal(isGroupLabel('group:x'), true);
  assert.equal(isGroupLabel(GROUP_LABEL_PREFIX), false); // "group:" with no key names no group
  assert.equal(isGroupLabel('in-progress'), false);
  assert.equal(isGroupLabel('grouped'), false); // prefix-ish but not the prefix
  assert.equal(isGroupLabel(''), false);
  assert.equal(isGroupLabel(null), false);
  assert.equal(isGroupLabel(undefined), false);
});

test('groupLabelNames extracts group markers from a label list, ignoring everything else', () => {
  assert.deepStrictEqual(
    groupLabelNames(['in-progress', 'group:import-fixes', 'deps-checked']),
    ['group:import-fixes'],
  );
  assert.deepStrictEqual(groupLabelNames(['in-progress', 'bug']), []);
});

test('groupLabelNames accepts label OBJECTS — the shape gh issue view actually returns', () => {
  const present = [{ name: 'in-progress' }, { name: 'group:aging-buckets' }];
  assert.deepStrictEqual(groupLabelNames(present), ['group:aging-buckets']);
});

test('groupLabelNames dedupes and preserves first-seen order — a branch unions several issues', () => {
  assert.deepStrictEqual(
    groupLabelNames(['group:b', 'group:a', 'group:b']),
    ['group:b', 'group:a'],
  );
});

test('groupLabelNames tolerates empty / null / undefined the same way missingConventionLabels does', () => {
  assert.deepStrictEqual(groupLabelNames([]), []);
  assert.deepStrictEqual(groupLabelNames(null), []);
  assert.deepStrictEqual(groupLabelNames(undefined), []);
});

// --- mechanical readiness marker (#69) ---------------------------------------
// `graph-empty` is a deliberately SEPARATE, weaker claim from `deps-checked` — see
// CONVENTIONS.md §5 "Mechanical readiness". These tests pin that it stays out of the set an
// unattended adoption/sync/audit provisions (opt-in, like `tracking`), and that its write helper
// never shares a name or a code path with `readinessLabelArgs`.

test('graph-empty is not one of the provisioned convention labels', () => {
  assert.equal(MECHANICAL_READINESS_LABEL, 'graph-empty');
  assert.ok(!conventionLabelNames().includes(MECHANICAL_READINESS_LABEL),
    'a mechanical-only check must stay opt-in — forcing it defeats the point of a cheaper lane');
});

test('a repo missing graph-empty is never reported by missingConventionLabels — it is not in the set', () => {
  assert.deepStrictEqual(
    missingConventionLabels(['in-progress', 'deps-checked', 'agent-filed', 'epic', 'needs-decision', 'decision-recorded', 'needs-plan', 'migration-granted', 'needs-migration-grant', 'ci-granted', 'low-priority', 'delivery:code', 'delivery:content', 'delivery:ops', 'delivery:docs-only', 'delivery:elsewhere', 'deferred:date', 'deferred:measurement', 'deferred:external-party']),
    [],
  );
});

test('mechanicalReadinessLabelArgs maps set⇒add and clear⇒remove against its OWN marker name', () => {
  assert.deepStrictEqual(mechanicalReadinessLabelArgs(), ['--add-label', 'graph-empty']);
  assert.deepStrictEqual(mechanicalReadinessLabelArgs({}), ['--add-label', 'graph-empty']);
  assert.deepStrictEqual(mechanicalReadinessLabelArgs({ clear: true }), ['--remove-label', 'graph-empty']);
  // And never the other marker's name — the two writers must not be interchangeable.
  assert.notDeepStrictEqual(mechanicalReadinessLabelArgs(), readinessLabelArgs());
});

// --- migration-grant marker (#98) ---------------------------------------------------------
// `migration-granted` IS one of the provisioned convention labels (unlike `tracking` /
// `graph-empty` above) — see the doc comment in labels.js for why its absence fails malignantly
// rather than benignly. These tests pin that it is provisioned, and that its write helper never
// shares a name or a code path with the other markers'.

test('migration-granted IS one of the provisioned convention labels', () => {
  assert.equal(MIGRATION_GRANT_LABEL, 'migration-granted');
  assert.ok(conventionLabelNames().includes(MIGRATION_GRANT_LABEL),
    'unlike tracking/graph-empty, an unexempted repo silently cannot ever grant — provision it');
});

test('migrationGrantLabelArgs maps set⇒add and clear⇒remove against its OWN marker name', () => {
  assert.deepStrictEqual(migrationGrantLabelArgs(), ['--add-label', 'migration-granted']);
  assert.deepStrictEqual(migrationGrantLabelArgs({}), ['--add-label', 'migration-granted']);
  assert.deepStrictEqual(migrationGrantLabelArgs({ clear: false }), ['--add-label', 'migration-granted']);
  assert.deepStrictEqual(migrationGrantLabelArgs({ clear: true }), ['--remove-label', 'migration-granted']);
  // Never the other markers' names — the writers must not be interchangeable.
  assert.notDeepStrictEqual(migrationGrantLabelArgs(), readinessLabelArgs());
  assert.notDeepStrictEqual(migrationGrantLabelArgs(), mechanicalReadinessLabelArgs());
});

test('migrationGrantMissingLabelHint fires exactly when the repo lacks migration-granted', () => {
  const hint = migrationGrantMissingLabelHint(['in-progress', 'bug']);
  assert.match(hint, /migration-granted/);
  assert.match(hint, /handbook-sync/);
  assert.equal(migrationGrantMissingLabelHint(['in-progress', 'deps-checked', 'migration-granted']), null);
  // Objects, not just strings.
  assert.equal(migrationGrantMissingLabelHint([{ name: 'migration-granted' }]), null);
});

test('migrationGrantMissingLabelHint returns null when the label set could not be READ', () => {
  // Same contract as readinessMissingLabelHint: null present ≠ empty set.
  assert.equal(migrationGrantMissingLabelHint(null), null);
  assert.equal(migrationGrantMissingLabelHint(undefined), null);
  assert.match(migrationGrantMissingLabelHint([]), /migration-granted/);
});

// --- ci-grant marker (#105) ----------------------------------------------------------------
// `ci-granted` IS one of the provisioned convention labels, for the identical
// malignant-absence reason `migration-granted` is (see the doc comment in labels.js). These
// tests pin that it is provisioned, and that its write helper never shares a name or a code
// path with migration-granted's — the two grants must never be interchangeable, since they
// authorize different (and differently dangerous) exemptions.

test('ci-granted IS one of the provisioned convention labels', () => {
  assert.equal(CI_GRANT_LABEL, 'ci-granted');
  assert.ok(conventionLabelNames().includes(CI_GRANT_LABEL),
    'unlike tracking/graph-empty, an unexempted repo silently cannot ever grant — provision it');
});

test('ciGrantLabelArgs maps set⇒add and clear⇒remove against its OWN marker name', () => {
  assert.deepStrictEqual(ciGrantLabelArgs(), ['--add-label', 'ci-granted']);
  assert.deepStrictEqual(ciGrantLabelArgs({}), ['--add-label', 'ci-granted']);
  assert.deepStrictEqual(ciGrantLabelArgs({ clear: false }), ['--add-label', 'ci-granted']);
  assert.deepStrictEqual(ciGrantLabelArgs({ clear: true }), ['--remove-label', 'ci-granted']);
  // Never the other markers' names — the writers must not be interchangeable, migration-grant
  // included: a bad CI grant merges into a repo whose test suite is known-failing, a bad
  // migration grant does not, so the two must never share a write path.
  assert.notDeepStrictEqual(ciGrantLabelArgs(), readinessLabelArgs());
  assert.notDeepStrictEqual(ciGrantLabelArgs(), mechanicalReadinessLabelArgs());
  assert.notDeepStrictEqual(ciGrantLabelArgs(), migrationGrantLabelArgs());
});

test('ciGrantMissingLabelHint fires exactly when the repo lacks ci-granted', () => {
  const hint = ciGrantMissingLabelHint(['in-progress', 'bug']);
  assert.match(hint, /ci-granted/);
  assert.match(hint, /handbook-sync/);
  assert.equal(ciGrantMissingLabelHint(['in-progress', 'deps-checked', 'ci-granted']), null);
  // Objects, not just strings.
  assert.equal(ciGrantMissingLabelHint([{ name: 'ci-granted' }]), null);
});

test('ciGrantMissingLabelHint returns null when the label set could not be READ', () => {
  // Same contract as migrationGrantMissingLabelHint: null present ≠ empty set.
  assert.equal(ciGrantMissingLabelHint(null), null);
  assert.equal(ciGrantMissingLabelHint(undefined), null);
  assert.match(ciGrantMissingLabelHint([]), /ci-granted/);
});

// --- decision gate + decision-recorded marker (#75, renamed/paired #121-#122) ----------------
// `needs-decision` is the renamed, widened `needs-ruling`; `decision-recorded` is new (#121) —
// the positive marker that makes recording an answer a machine-readable act, never just the
// gate's absence. Both are provisioned, unlike tracking/graph-empty, for the same
// malignant-absence reason migration-granted/ci-granted are.

test('needs-decision and decision-recorded ARE two of the provisioned convention labels', () => {
  assert.equal(NEEDS_DECISION_LABEL, 'needs-decision');
  assert.equal(DECISION_RECORDED_LABEL, 'decision-recorded');
  assert.ok(conventionLabelNames().includes(NEEDS_DECISION_LABEL));
  assert.ok(conventionLabelNames().includes(DECISION_RECORDED_LABEL));
});

test('decisionRecordedMissingLabelHint fires exactly when the repo lacks decision-recorded', () => {
  const hint = decisionRecordedMissingLabelHint(['in-progress', 'bug']);
  assert.match(hint, /decision-recorded/);
  assert.match(hint, /handbook-sync/);
  assert.equal(decisionRecordedMissingLabelHint(['in-progress', 'deps-checked', 'decision-recorded']), null);
  // Objects, not just strings.
  assert.equal(decisionRecordedMissingLabelHint([{ name: 'decision-recorded' }]), null);
});

test('decisionRecordedMissingLabelHint returns null when the label set could not be READ', () => {
  // Same contract as migrationGrantMissingLabelHint: null present ≠ empty set.
  assert.equal(decisionRecordedMissingLabelHint(null), null);
  assert.equal(decisionRecordedMissingLabelHint(undefined), null);
  assert.match(decisionRecordedMissingLabelHint([]), /decision-recorded/);
});

// --- delivery type classifier (#112, widened #274) --------------------------------------------
// Three-valued by design (CONVENTIONS.md §5, *Delivery type*): "not asked" must never collapse
// into "non-code", or the start gate freezes the day this label set lands on an unlabelled
// tracker. These tests pin all five label values and the null/absent case.

test('deliveryType is null — NOT ASKED — when no delivery:* label is present', () => {
  assert.equal(deliveryType([]), null);
  assert.equal(deliveryType(null), null);
  assert.equal(deliveryType(undefined), null);
  assert.equal(deliveryType(['in-progress', 'bug']), null);
});

test('deliveryType reads each of the five explicit values', () => {
  assert.equal(deliveryType(['delivery:code']), 'code');
  assert.equal(deliveryType(['delivery:content']), 'content');
  assert.equal(deliveryType(['delivery:ops']), 'ops');
  assert.equal(deliveryType(['delivery:docs-only']), 'docs-only');
  assert.equal(deliveryType(['delivery:elsewhere']), 'elsewhere');
});

test('deliveryType accepts label OBJECTS, the shape gh issue view actually returns', () => {
  assert.equal(deliveryType([{ name: 'delivery:content' }]), 'content');
});

test('isRouteNotStart is false for NOT ASKED and for delivery:code — only the four non-code types route', () => {
  assert.equal(isRouteNotStart([]), false);
  assert.equal(isRouteNotStart(['delivery:code']), false);
  assert.equal(isRouteNotStart(['delivery:content']), true);
  assert.equal(isRouteNotStart(['delivery:ops']), true);
  assert.equal(isRouteNotStart(['delivery:docs-only']), true);
  assert.equal(isRouteNotStart(['delivery:elsewhere']), true);
});

// #274 — an issue explicitly labelled delivery:elsewhere is byte-identical, before this fix, to
// one nobody ever labelled: deliveryType returned null for it and isRouteNotStart read false, so
// code-triage reported it startable — exactly the mis-routing the label was applied to prevent.
test('#274 regression: delivery:elsewhere is NOT confused with "not asked" — it routes, does not start', () => {
  assert.notEqual(deliveryType(['delivery:elsewhere']), null);
  assert.equal(isRouteNotStart(['delivery:elsewhere']), true);
  assert.equal(isRouteNotStart(['deps-checked', 'delivery:elsewhere']), true);
});

test('NON_CODE_DELIVERY_TYPES excludes code and DELIVERY_LABEL_PREFIX matches the label set', () => {
  assert.deepStrictEqual(NON_CODE_DELIVERY_TYPES, ['content', 'ops', 'docs-only', 'elsewhere']);
  assert.equal(DELIVERY_LABEL_PREFIX, 'delivery:');
  for (const type of NON_CODE_DELIVERY_TYPES) {
    assert.ok(conventionLabelNames().includes(`${DELIVERY_LABEL_PREFIX}${type}`));
  }
  assert.ok(conventionLabelNames().includes('delivery:code'));
});

// --- deferred-kind classifier (#279, Disposition) -----------------------------------------
// Same shape as the delivery classifier above, deliberately: NOT ASKED must read as `null`,
// never collapse into any one kind, and every provisioned kind must round-trip through
// CONVENTION_LABELS — the assertion that would have caught #274's class of bug applied here.

test('deferredKind is null — NOT ASKED — when no deferred:* label is present', () => {
  assert.equal(deferredKind([]), null);
  assert.equal(deferredKind(null), null);
  assert.equal(deferredKind(undefined), null);
  assert.equal(deferredKind(['in-progress', 'bug']), null);
});

test('deferredKind reads each of the three provisioned kinds', () => {
  assert.equal(deferredKind(['deferred:date']), 'date');
  assert.equal(deferredKind(['deferred:measurement']), 'measurement');
  assert.equal(deferredKind(['deferred:external-party']), 'external-party');
});

test('deferredKind accepts label OBJECTS, the shape gh issue view actually returns', () => {
  assert.equal(deferredKind([{ name: 'deferred:measurement' }]), 'measurement');
});

test('isDeferred is false for NOT ASKED and true for each provisioned kind', () => {
  assert.equal(isDeferred([]), false);
  assert.equal(isDeferred(['in-progress']), false);
  assert.equal(isDeferred(['deferred:date']), true);
  assert.equal(isDeferred(['deferred:measurement']), true);
  assert.equal(isDeferred(['deferred:external-party']), true);
});

test('DEFERRED_KINDS / DEFERRED_LABEL_PREFIX are consistent with the provisioned set', () => {
  // The analogue of the delivery-type consistency test above (line 415) — this is the
  // assertion that would have caught #274's class of bug if it had existed for deferred:*.
  assert.deepStrictEqual(DEFERRED_KINDS, ['date', 'measurement', 'external-party']);
  assert.equal(DEFERRED_LABEL_PREFIX, 'deferred:');
  for (const kind of DEFERRED_KINDS) {
    assert.ok(conventionLabelNames().includes(`${DEFERRED_LABEL_PREFIX}${kind}`));
  }
});

// --- review-by:<date> (#279, Disposition) — created on demand, like group:<key> --------------
// Deliberately NOT provisioned: the date varies per issue, so there is no fixed set. These
// tests mirror the isGroupLabel/groupLabelNames block above, plus parseReviewByDate's strict
// calendar-date validation (never lenient `Date` parsing — see the doc comment in labels.js).

test('isReviewByLabel matches only the prefixed shape, never the bare prefix or an unrelated label', () => {
  assert.equal(isReviewByLabel('review-by:2026-09-01'), true);
  assert.equal(isReviewByLabel(REVIEW_BY_LABEL_PREFIX), false); // bare prefix names no date
  assert.equal(isReviewByLabel('in-progress'), false);
  assert.equal(isReviewByLabel('review-byte'), false); // prefix-ish but not the prefix
  assert.equal(isReviewByLabel(''), false);
  assert.equal(isReviewByLabel(null), false);
  assert.equal(isReviewByLabel(undefined), false);
});

test('reviewByLabelNames extracts review-by markers from a label list, ignoring everything else', () => {
  assert.deepStrictEqual(
    reviewByLabelNames(['in-progress', 'review-by:2026-09-01', 'deferred:date']),
    ['review-by:2026-09-01'],
  );
  assert.deepStrictEqual(reviewByLabelNames(['in-progress', 'bug']), []);
});

test('reviewByLabelNames accepts label OBJECTS — the shape gh issue view actually returns', () => {
  const present = [{ name: 'in-progress' }, { name: 'review-by:2026-10-15' }];
  assert.deepStrictEqual(reviewByLabelNames(present), ['review-by:2026-10-15']);
});

test('reviewByLabelNames dedupes and preserves first-seen order', () => {
  assert.deepStrictEqual(
    reviewByLabelNames(['review-by:2026-09-01', 'review-by:2026-10-01', 'review-by:2026-09-01']),
    ['review-by:2026-09-01', 'review-by:2026-10-01'],
  );
});

test('reviewByLabelNames tolerates empty / null / undefined', () => {
  assert.deepStrictEqual(reviewByLabelNames([]), []);
  assert.deepStrictEqual(reviewByLabelNames(null), []);
  assert.deepStrictEqual(reviewByLabelNames(undefined), []);
});

test('review-by: is deliberately absent from conventionLabelNames() — it is created on demand', () => {
  // The analogue of the graph-empty test above: pins the on-demand decision so a later edit
  // cannot quietly promote review-by:<date> into the provisioned set.
  assert.ok(!conventionLabelNames().some((n) => isReviewByLabel(n)));
});

test('parseReviewByDate returns the date string for a valid calendar day', () => {
  assert.equal(parseReviewByDate('review-by:2026-09-01'), '2026-09-01');
  assert.equal(parseReviewByDate({ name: 'review-by:2026-09-01' }), '2026-09-01');
});

test('parseReviewByDate rejects anything that is not a real calendar date, without lenient Date parsing', () => {
  // `new Date('2026-02-30')` does not throw — it rolls over to March 2nd — and `Date.parse`
  // accepts two-digit years and unpadded months/days this label must reject. Each case below
  // is a plausible-looking value a lenient implementation would silently accept.
  assert.equal(parseReviewByDate('review-by:2026-13-01'), null); // month 13
  assert.equal(parseReviewByDate('review-by:2026-02-30'), null); // Feb 30 rolls to March 2
  assert.equal(parseReviewByDate('review-by:26-01-01'), null);   // two-digit year
  assert.equal(parseReviewByDate('review-by:2026-1-1'), null);   // unpadded
  assert.equal(parseReviewByDate('review-by:soon'), null);
  assert.equal(parseReviewByDate(REVIEW_BY_LABEL_PREFIX), null); // bare prefix
  assert.equal(parseReviewByDate('deferred:date'), null);        // not a review-by label at all
  assert.equal(parseReviewByDate(null), null);
  assert.equal(parseReviewByDate(undefined), null);
});
