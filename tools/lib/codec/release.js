'use strict';
/**
 * CODEC (#498, epic #496): the RELEASE-RUNG markers `colab release finalize` writes to a tracker
 * (CONVENTIONS.md §6, *The release rung*), as encode/decode pairs. Pure and synchronous.
 *
 *   tracking marker  — `<!-- colab:release version=vX.Y.Z -->`, the first line of a tracking
 *                      issue's body. Only the marker identifies the version, never the title.
 *   event marker     — `<!-- colab:release-event k=v … -->`, one per thing announced on the
 *                      tracking issue, keys in the order written. Its exact presence is what makes
 *                      a re-run post nothing twice, so key order is part of the wire format.
 *   released comment — the event marker `released=vX.Y.Z` plus one visible line, posted once on
 *                      each issue a release carried.
 *
 * Deciding which candidate, which period, and whether to finalize stays in
 * tools/lib/release-finalize.js, which re-exports these under the names it always had.
 */

const VERSION_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const TRACKING_MARKER_RE = /<!--\s*colab:release\s+version=(v[0-9]+\.[0-9]+\.[0-9]+)\s*-->/;
const RELEASE_EVENT_RE = /^<!-- colab:release-event((?: [^\s=]+=\S*)+) -->$/;
const RELEASED_COMMENT_RE = /^<!-- colab:release-event released=(\S+) -->\nReleased in \*\*(\S+)\*\* \(`([^`]*)`\)\.$/;

/** `vX.Y.Z` → the tracking marker. */
function encodeTrackingMarker(version) { return `<!-- colab:release version=${version} -->`; }

/** The version a body's tracking marker declares, or null — a marker naming a non-canonical
 *  version (a leading zero) declares nothing. */
function decodeTrackingMarker(body) {
  const m = TRACKING_MARKER_RE.exec(String(body || ''));
  return m && VERSION_RE.test(m[1]) ? m[1] : null;
}

/** `{k: v, …}` → `<!-- colab:release-event k=v … -->`, keys in the order given. */
function encodeReleaseEvent(fields) {
  return `<!-- colab:release-event ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')} -->`;
}

/** An event marker (the whole string) → its fields as strings, in written order; null if not one. */
function decodeReleaseEvent(marker) {
  const m = RELEASE_EVENT_RE.exec(String(marker == null ? '' : marker).trim());
  if (!m) return null;
  const out = {};
  for (const pair of m[1].trim().split(' ')) {
    const i = pair.indexOf('=');
    const k = pair.slice(0, i);
    if (Object.prototype.hasOwnProperty.call(out, k)) return null; // a repeated key cannot round-trip
    out[k] = pair.slice(i + 1);
  }
  return out;
}

/** `{version, sha}` → the "released in" comment; `sha` is shortened to 7 characters. */
function encodeReleasedComment({ version, sha } = {}) {
  return `${encodeReleaseEvent({ released: version })}\nReleased in **${version}** (\`${String(sha || '').slice(0, 7)}\`).`;
}

/** A "released in" comment → `{version, sha}` (sha as written, 7 characters), or null. */
function decodeReleasedComment(body) {
  const m = RELEASED_COMMENT_RE.exec(String(body == null ? '' : body).replace(/\r\n/g, '\n').trim());
  if (!m || m[1] !== m[2]) return null;
  return { version: m[1], sha: m[3] };
}

module.exports = {
  VERSION_RE, TRACKING_MARKER_RE, RELEASE_EVENT_RE,
  encodeTrackingMarker, decodeTrackingMarker,
  encodeReleaseEvent, decodeReleaseEvent,
  encodeReleasedComment, decodeReleasedComment,
};
