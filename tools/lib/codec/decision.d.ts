// Types for tools/lib/codec/decision.js (#498) — see index.d.ts.

export const DECISION_MARK: '⚖ Decision recorded';
export const REOPEN_MARK: '↩ Decision reopened';
export const DECISION_RE: RegExp;
export const REOPEN_RE: RegExp;

export interface DecodedDecision {
  /** The human whose call it is — never the typist. */
  ruledBy: string;
  /** The options block this answers, or `-`. */
  answers: string;
  host: string; at: string;
  /** Rest of the marker line; null = canonical (nothing). */
  tail: string | null;
  /** The ruling prose after one blank line, or null. */
  body: string | null;
}
export function encodeDecision(d?: Partial<DecodedDecision>): string;
export function decodeDecision(text: string | null | undefined): DecodedDecision | null;

export interface DecodedReopen { ruledBy: string; host: string; at: string; tail: string | null; body: string | null; }
export function encodeReopen(r?: Partial<DecodedReopen>): string;
export function decodeReopen(text: string | null | undefined): DecodedReopen | null;

export const OPTIONS_RE: RegExp;
export const MOCKUP_RE: RegExp;
export function encodeMockup(url: string): string;
export function mockupUrls(body: unknown): string[];

/** An ask record a dashboard that tracks asks wrote (#582) — read-only to colab. */
export interface AskRecord { ns: string; id: string; version: number; index: number; }
/** An answer record naming an ask by id (#582). */
export interface AnswerRecord { ns: string; ask: string; version: number | null; index: number; }
export function askRecords(text: unknown): AskRecord[];
export function answerRecords(text: unknown): AnswerRecord[];
