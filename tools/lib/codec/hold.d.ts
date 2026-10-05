// Types for tools/lib/codec/hold.js (#498) — see index.d.ts.

export type WakeKind = 'review-by' | 'edge' | 'ruling' | 'issueClosed' | 'branchLanded' | 'trunkAt' | 'labelPresent' | 'after';
export const WAKE_KINDS: ReadonlyArray<WakeKind>;
export const CHECKABLE_KINDS: ReadonlyArray<WakeKind>;
export const WAKE_KINDS_TEXT: string;

export interface WakeCondition { kind: WakeKind; arg: string | null; raw: string; }
export function parseWake(raw: unknown): WakeCondition | null;
export function parseWakeLine(value: string | string[] | unknown):
  | { ok: true; conditions: WakeCondition[] }
  | { ok: false; error: string };
export function parseQualifiedIssueRef(arg: unknown): { slug: string; number: number } | null;

export const HOLD_RE: RegExp;
export const BECAUSE_RE: RegExp;
export interface DecodedHold {
  label: string;
  owner: string;
  /** The `wake:` field as written — `parseWakeLine` decides whether it names a wake. */
  wake: string;
  /** The `Because:` line's text, or null when the comment is the `Hold:` line alone. */
  because: string | null;
}
export function encodeHold(h?: { label: string; owner: string; wake: string | string[]; because?: string | null }): string;
export function decodeHold(body: string | null | undefined): DecodedHold | null;
