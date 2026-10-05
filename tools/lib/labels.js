'use strict';
/**
 * The label vocabulary moved to tools/lib/codec/labels.js (#497, epic #496) — that file is now the
 * one place the conventions' labels are defined, and the history of every entry lives there.
 *
 * This module stays so no caller breaks: it re-exports exactly the names it exported before the
 * move, nothing added and nothing renamed. New code reads the codec (`require('./codec')`) —
 * including the encode/decode pair this shim deliberately does not surface.
 */
const codec = require('./codec/labels');

const NAMES = [
  'CONVENTION_LABELS', 'conventionLabelNames', 'missingConventionLabels', 'staleConventionDescriptions',
  'MINIMAL_LABEL_NAMES', 'minimalConventionLabels',
  'READINESS_LABEL', 'readinessLabelArgs', 'readinessMissingLabelHint', 'readinessMarkedMessage',
  'TRACKING_LABEL',
  'MECHANICAL_READINESS_LABEL', 'mechanicalReadinessLabelArgs',
  'MIGRATION_GRANT_LABEL', 'migrationGrantLabelArgs', 'migrationGrantMissingLabelHint',
  'CI_GRANT_LABEL', 'ciGrantLabelArgs', 'ciGrantMissingLabelHint',
  'NEEDS_DECISION_LABEL', 'DECISION_RECORDED_LABEL', 'decisionRecordedMissingLabelHint',
  'GROUP_LABEL_PREFIX', 'isGroupLabel', 'groupLabelNames',
  'DELIVERY_LABEL_PREFIX', 'DELIVERY_TYPES', 'CODE_LANE_DELIVERY_TYPES', 'NON_CODE_DELIVERY_TYPES',
  'deliveryType', 'isRouteNotStart',
  'DEFERRED_LABEL_PREFIX', 'DEFERRED_KINDS', 'deferredKind', 'isDeferred',
  'REVIEW_BY_LABEL_PREFIX', 'isReviewByLabel', 'reviewByLabelNames', 'parseReviewByDate',
];

module.exports = Object.fromEntries(NAMES.map((n) => [n, codec[n]]));
