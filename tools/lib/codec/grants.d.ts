// Types for tools/lib/codec/grants.js (#498) — see index.d.ts.
// `tail` on every decoded grant: null = the canonical sentence this toolkit writes; any other string
// is kept literally so a hand-edited comment re-encodes byte for byte.

// ── human migration grant / revoke ───────────────────────────────────────────────────────────

export const MIGRATION_GRANT_MARK: '🛢 Migration grant';
export const MIGRATION_REVOKE_MARK: '🚫 Migration grant revoked';
export const MIGRATION_GRANT_RE: RegExp;
export const MIGRATION_REVOKE_RE: RegExp;

export interface DecodedMigrationGrant { branch: string; host: string; at: string; tail: string | null; }
export function encodeMigrationGrant(g?: { branch: string; host: string; at: string; tail?: string | null }): string;
export function decodeMigrationGrant(body: string | null | undefined): DecodedMigrationGrant | null;
export function encodeMigrationRevoke(r?: { branch: string; host: string; at: string; tail?: string | null }): string;
export function decodeMigrationRevoke(body: string | null | undefined): DecodedMigrationGrant | null;

// ── reviewer migration grant ─────────────────────────────────────────────────────────────────

export const REVIEW_GRANT_MARK: '🔎 Migration review grant';
export const REVIEW_GRANT_RE: RegExp;
export const REVIEWER_ROLE: 'migration-reviewer';
export const REVIEW_RECORD_FENCE: 'migration-review';
export const REVIEW_RECORD_VERSION: '1';
export interface ReviewRecordField { key: string; required: boolean; values?: string[]; re?: RegExp; hint?: string; }
export const REVIEW_RECORD_FIELDS: ReadonlyArray<ReviewRecordField>;

export interface DecodedReviewGrant {
  role: string; reviewer: string; branch: string;
  /** Full 40-hex sha the review covers, as written (validity is the caller's check). */
  head: string;
  host: string; at: string; tail: string | null;
  /** The fenced record's `key: value` lines, or null when the comment has no record block. */
  record: Record<string, string> | null;
  /** SYNTAX findings only — never whether the review passes. */
  problems: string[];
}
export function encodeReviewGrant(g?: Partial<Omit<DecodedReviewGrant, 'problems' | 'record'>> & { record?: Record<string, unknown> }): string;
export function decodeReviewGrant(body: string | null | undefined): DecodedReviewGrant | null;

// ── red-trunk CI grant / revoke ───────────────────────────────────────────────────────────────

export const CI_GRANT_MARK: '🚨 Red-trunk CI grant';
export const CI_REVOKE_MARK: '🧯 Red-trunk CI grant revoked';
export const CI_GRANT_RE: RegExp;
export const CI_REVOKE_RE: RegExp;

export interface DecodedCiGrant {
  branch: string; trunk: string; redSha: string; evidenceSha: string; host: string; at: string; tail: string | null;
}
export function encodeCiGrant(g?: Omit<DecodedCiGrant, 'tail'> & { tail?: string | null }): string;
export function decodeCiGrant(body: string | null | undefined): DecodedCiGrant | null;
export function encodeCiRevoke(r?: { branch: string; host: string; at: string; tail?: string | null }): string;
export function decodeCiRevoke(body: string | null | undefined): DecodedMigrationGrant | null;
