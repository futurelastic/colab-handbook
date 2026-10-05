// Types for tools/lib/codec/release.js (#498) — see index.d.ts.

export const VERSION_RE: RegExp;
export const TRACKING_MARKER_RE: RegExp;
export const RELEASE_EVENT_RE: RegExp;

export function encodeTrackingMarker(version: string): string;
/** The canonical `vX.Y.Z` a body's tracking marker declares, or null. */
export function decodeTrackingMarker(body: string | null | undefined): string | null;

/** Keys are written in the object's own order — part of the wire format. */
export function encodeReleaseEvent(fields: Record<string, string | number>): string;
export function decodeReleaseEvent(marker: string | null | undefined): Record<string, string> | null;

export function encodeReleasedComment(c?: { version: string; sha: string }): string;
/** `sha` is the 7-character form the comment carries. */
export function decodeReleasedComment(body: string | null | undefined): { version: string; sha: string } | null;
