// Types for tools/lib/codec/claim.js (#497) — see index.d.ts.

// ── claim / release comments ─────────────────────────────────────────────────────────────────

export const CLAIM_MARK: '🔒 Claimed';
export const RELEASE_MARK: '✅ Released';
export const CLAIM_RE: RegExp;
export const SESSION_RE: RegExp;
export const MACHINE_RE: RegExp;
export const YIELD_RE: RegExp;

export function looksLikeSessionId(v: unknown): boolean;

export interface SessionField { session: string; sessionName: string; }
export function encodeSessionField(session?: string, sessionName?: string): string;
export function parseSessionField(body: string): SessionField;

export interface Identity { login: string; host: string; session: string; }
export function encodeIdentity(id?: { login: string; host: string; session?: string }): string;
export function parseIdentity(s: string | null | undefined): Identity | null;

export interface DecodedClaim extends SessionField {
  /** `-` when the claim names no worktree — kept literally so the pair round-trips. */
  worktree: string;
  /** `-` when the claim names no branch (#53). */
  branch: string;
  /** Raw hostname, or its `h:` token on a destination that may not name it (#369). */
  host: string;
  /** ISO timestamp as written. */
  at: string;
  /** `m:` digest (#327), or '' on a legacy comment. */
  machine: string;
}
export function encodeClaim(claim?: Partial<DecodedClaim>): string;
export function decodeClaim(body: string | null | undefined): DecodedClaim | null;

export type DecodedRelease =
  | { kind: 'release'; rest: string }
  | { kind: 'yield'; winner: string; rest: string };
export function encodeRelease(release?: { winner?: string; rest?: string }): string;
export function decodeRelease(body: string | null | undefined): DecodedRelease | null;
