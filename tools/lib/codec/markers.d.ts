// Types for tools/lib/codec/markers.js (#499) — see index.d.ts.

export type MarkerForm = 'comment' | 'line';

// ── parent ───────────────────────────────────────────────────────────────────────────────────

export const PARENT_COMMENT_RE: RegExp;
export const PARENT_LINE_RE: RegExp;
export interface ParentRef {
  /** `owner/repo` for a cross-repo parent, null for the same repo. */
  repo: string | null;
  number: number;
}
export function encodeParentRef(ref?: { repo?: string | null; number: number }): string;
export function decodeParentRef(ref: string | null | undefined): ParentRef | null;
export function encodeParent(p?: { repo?: string | null; number: number; form?: MarkerForm }): string;
export function decodeParent(marker: string | null | undefined): (ParentRef & { form: MarkerForm }) | null;
/** The comment form wins; `conflict` = more than one distinct parent declared. */
export function readParent(body: string | null | undefined): (ParentRef & { form: MarkerForm; conflict: boolean }) | null;
export function encodeParentBlock(ref?: { repo?: string | null; number: number }): string;

// ── close reason ─────────────────────────────────────────────────────────────────────────────

export type CloseReason = 'completed' | 'not-planned';
export const CLOSE_REASONS: ReadonlyArray<CloseReason>;
export const CLOSE_REASON_COMMENT_RE: RegExp;
export const CLOSE_REASON_LINE_RE: RegExp;
export function encodeCloseReason(c?: { reason: CloseReason; form?: MarkerForm }): string;
export function decodeCloseReason(marker: string | null | undefined): { reason: CloseReason; form: MarkerForm } | null;
export function encodeCloseReasonBlock(reason: CloseReason): string;
/** Null unless `state` is closed; then the newest comment carrying a valid marker decides. */
export function readCloseReason(item?: {
  state?: string;
  comments?: Array<{ body?: string | null; createdAt?: string }>;
}): CloseReason | null;
