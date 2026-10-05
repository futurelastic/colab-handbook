// Types for tools/lib/codec/labels.js (#497) — see index.d.ts.

// ── labels ───────────────────────────────────────────────────────────────────────────────────

export interface ConventionLabel { name: string; color: string; description: string; }
/** Anything with a `name`, or a bare label name. */
export type LabelLike = string | { name: string; description?: string } | null | undefined;

export type DecodedLabel =
  | { kind: 'delivery'; value: string; known: boolean }
  | { kind: 'deferred'; value: string; known: boolean }
  | { kind: 'review-by'; value: string; known: true }
  | { kind: 'group'; value: string; known: true }
  | { kind: 'convention'; value: string; known: true }
  | { kind: 'other'; value: string; known: false };
export type LabelKind = DecodedLabel['kind'];

export function decodeLabel(name: LabelLike): DecodedLabel;
export function encodeLabel(label: { kind: LabelKind; value: string }): string;

export const CONVENTION_LABELS: ConventionLabel[];
export function conventionLabelNames(): string[];
export function missingConventionLabels(present: LabelLike[] | null | undefined): string[];
export function staleConventionDescriptions(present: LabelLike[] | null | undefined): { name: string; have: string; want: string }[];
export const MINIMAL_LABEL_NAMES: string[];
export function minimalConventionLabels(): ConventionLabel[];

export const READINESS_LABEL: 'deps-checked';
export function readinessLabelArgs(opts?: { clear?: boolean }): string[];
export function readinessMissingLabelHint(present: LabelLike[] | null | undefined): string | null;
export function readinessMarkedMessage(opts?: {
  num?: number | string; repo?: string;
  summary?: { ok: boolean; total: number; read: number; open: number; unknownState: number } | null;
}): string;
export const TRACKING_LABEL: 'tracking';
export const MECHANICAL_READINESS_LABEL: 'graph-empty';
export function mechanicalReadinessLabelArgs(opts?: { clear?: boolean }): string[];
export const MIGRATION_GRANT_LABEL: 'migration-granted';
export function migrationGrantLabelArgs(opts?: { clear?: boolean }): string[];
export function migrationGrantMissingLabelHint(present: LabelLike[] | null | undefined): string | null;
export const CI_GRANT_LABEL: 'ci-granted';
export function ciGrantLabelArgs(opts?: { clear?: boolean }): string[];
export function ciGrantMissingLabelHint(present: LabelLike[] | null | undefined): string | null;
export const NEEDS_DECISION_LABEL: 'needs-decision';
export const DECISION_RECORDED_LABEL: 'decision-recorded';
export function decisionRecordedMissingLabelHint(present: LabelLike[] | null | undefined): string | null;

export const GROUP_LABEL_PREFIX: 'group:';
export function isGroupLabel(name: unknown): boolean;
export function groupLabelNames(present: LabelLike[] | null | undefined): string[];
export const DELIVERY_LABEL_PREFIX: 'delivery:';
export const DELIVERY_TYPES: string[];
export const CODE_LANE_DELIVERY_TYPES: string[];
export const NON_CODE_DELIVERY_TYPES: string[];
export function deliveryType(present: LabelLike[] | null | undefined): string | null;
export function isRouteNotStart(present: LabelLike[] | null | undefined): boolean;
export const DEFERRED_LABEL_PREFIX: 'deferred:';
export const DEFERRED_KINDS: string[];
export function deferredKind(present: LabelLike[] | null | undefined): string | null;
export function isDeferred(present: LabelLike[] | null | undefined): boolean;
export const REVIEW_BY_LABEL_PREFIX: 'review-by:';
export function isReviewByLabel(name: unknown): boolean;
export function reviewByLabelNames(present: LabelLike[] | null | undefined): string[];
/** `review-by:YYYY-MM-DD` with a real calendar date → `YYYY-MM-DD`; anything else → null. */
export function parseReviewByDate(name: LabelLike): string | null;
