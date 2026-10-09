'use strict';
/**
 * CODEC (#498, epic #496): the DECISION wire formats as encode/decode pairs — the `⚖ Decision
 * recorded` record and its `↩ Decision reopened` counterpart, plus the two question-side markers a
 * reader looks for on a `needs-decision` issue (the `<!-- decision:options` block and the `Mockup:`
 * body line). Pure and synchronous: no I/O, no clock, no requires.
 *
 * Which decisions are live, whose are trusted, and whether a label pair is an open question or an
 * interrupted write stay in tools/lib/decision-record.js, which re-exports these under its old names.
 *
 * STABLE WIRE FORMAT. The two marks lead with DIFFERENT glyphs, so a reopen can never parse as a
 * fresh decision. Round trip: a decoded record carries `tail` (rest of the marker line; null = the
 * canonical text) and `body` (the prose after one blank line; null = none), so any comment the
 * regex matches re-encodes byte for byte.
 */

const DECISION_MARK = '⚖ Decision recorded';
const REOPEN_MARK = '↩ Decision reopened';
const DECISION_RE = /^⚖ Decision recorded — ruled-by `([^`]*)` · answers `([^`]*)` · host `([^`]*)` · (\S+)/;
const REOPEN_RE = /^↩ Decision reopened — ruled-by `([^`]*)` · host `([^`]*)` · (\S+)/;
const DECISION_TAIL = '';
const REOPEN_TAIL = ' — every decision on this issue up to this point is superseded.';

/** The question-side options block (CONVENTIONS.md §5, *Decision options*, #126) — presence only. */
const OPTIONS_RE = /<!--\s*decision:options\b/;
/** The design-approval ask (#379): `Mockup: <url>` at the START of a body line, nothing after it. */
const MOCKUP_RE = /^Mockup:[ \t]*(\S+)[ \t]*$/gm;

// Split what follows the timestamp into the marker line's tail and the body after a blank line.
// Anything that is not "<line>\n\n<body>" stays whole in the tail, so nothing is ever dropped.
function splitRest(rest, canonical) {
  const m = /^([^\n]*)\n\n([\s\S]*)$/.exec(rest);
  const tail = m ? m[1] : rest;
  return { tail: tail === canonical ? null : tail, body: m ? m[2] : null };
}
function joinRest(tail, body, canonical) {
  return (tail == null ? canonical : tail) + (body != null && body !== '' ? `\n\n${body}` : '');
}

/**
 * `{ruledBy, answers, host, at, tail?, body?}` → the decision comment. `ruledBy` names the human
 * whose call it is, never the typist; `answers` is the options block this resolves, or `-`.
 */
function encodeDecision({ ruledBy, answers, host, at, tail, body } = {}) {
  return `${DECISION_MARK} — ruled-by \`${ruledBy}\` · answers \`${answers || '-'}\` · host \`${host}\` · ${at}`
    + joinRest(tail, body, DECISION_TAIL);
}
/** A decision comment → `{ruledBy, answers, host, at, tail, body}`, or null. */
function decodeDecision(text) {
  const s = String(text == null ? '' : text).trim();
  const m = s.match(DECISION_RE);
  if (!m) return null;
  return { ruledBy: m[1], answers: m[2], host: m[3], at: m[4], ...splitRest(s.slice(m[0].length), DECISION_TAIL) };
}

/** `{ruledBy, host, at, tail?, body?}` → the reopen comment; `body` is the reason, if any. */
function encodeReopen({ ruledBy, host, at, tail, body } = {}) {
  return `${REOPEN_MARK} — ruled-by \`${ruledBy}\` · host \`${host}\` · ${at}` + joinRest(tail, body, REOPEN_TAIL);
}
function decodeReopen(text) {
  const s = String(text == null ? '' : text).trim();
  const m = s.match(REOPEN_RE);
  if (!m) return null;
  return { ruledBy: m[1], host: m[2], at: m[3], ...splitRest(s.slice(m[0].length), REOPEN_TAIL) };
}

/** `url` → the `Mockup:` body line. */
function encodeMockup(url) { return `Mockup: ${url}`; }
/** Every `Mockup:` URL declared in an issue body, in order. Empty when none (or no body). */
function mockupUrls(body) {
  if (typeof body !== 'string' || body === '') return [];
  const out = [];
  for (const m of body.replace(/\r\n/g, '\n').matchAll(MOCKUP_RE)) out.push(m[1]);
  return out;
}

/**
 * ASK / ANSWER RECORDS (#582) — the structured question a dashboard that tracks asks writes onto an
 * issue, and the answer that settles it. READ-ONLY here: colab never writes either, it only needs to
 * know which asks are still open so `colab decision --record` can name the one a ruling settles.
 *
 * Wire shape, namespaced by whatever tool wrote it (the namespace is not interpreted — any tool
 * writing this shape is read the same way):
 *   `<!-- <tool>:ask id=<id> v=<n> [key=value …] -->` + the question below it
 *   `<!-- <tool>:answer ask=<id> [v=<n>] [key=value …] -->` (+ optional note)
 * and the same heads as a bare line form `<tool>:ask id=…` at the start of a line. Attribute values
 * are percent-encoded and space-separated. Other kinds naming an ask (a wait, a delegation) are not
 * answers and are not read.
 */
const RECORD_NS = '[a-z][a-z0-9_-]*';
function recordHeads(text, kind) {
  if (typeof text !== 'string' || text === '') return [];
  const heads = [];
  const markerRe = new RegExp(`<!--\\s*(${RECORD_NS}):${kind}\\s+([^>]*?)\\s*-->`, 'g');
  const lineRe = new RegExp(`^(${RECORD_NS}):${kind}\\s+([^\\n]*)$`, 'gm');
  for (const re of [markerRe, lineRe]) {
    let m;
    while ((m = re.exec(text))) {
      const attrs = parseRecordAttrs(m[2]);
      if (attrs) heads.push({ index: m.index, ns: m[1], attrs });
    }
  }
  return heads.sort((a, b) => a.index - b.index);
}
/** `k=v k2=v2` → `{k: v, k2: v2}` (values percent-decoded), or null when any token is not `k=v`. */
function parseRecordAttrs(raw) {
  const out = {};
  const toks = String(raw).trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  for (const t of toks) {
    const m = /^([a-z][a-z0-9_-]*)=(\S*)$/i.exec(t);
    if (!m) return null;
    try { out[m[1]] = decodeURIComponent(m[2]); } catch (_) { out[m[1]] = m[2]; }
  }
  return out;
}
/** Every ask record in `text`, in order: `{ns, id, version, index}`. Requires `id` and an integer `v >= 1`. */
function askRecords(text) {
  return recordHeads(text, 'ask')
    .filter((h) => h.attrs.id && /^\d+$/.test(h.attrs.v || '') && Number(h.attrs.v) >= 1)
    .map((h) => ({ ns: h.ns, id: h.attrs.id, version: Number(h.attrs.v), index: h.index }));
}
/** Every answer record in `text`, in order: `{ns, ask, version, index}` (`version` null when absent). */
function answerRecords(text) {
  return recordHeads(text, 'answer')
    .filter((h) => h.attrs.ask)
    .map((h) => ({ ns: h.ns, ask: h.attrs.ask, version: /^\d+$/.test(h.attrs.v || '') ? Number(h.attrs.v) : null, index: h.index }));
}

module.exports = {
  DECISION_MARK, REOPEN_MARK, DECISION_RE, REOPEN_RE,
  encodeDecision, decodeDecision, encodeReopen, decodeReopen,
  OPTIONS_RE, MOCKUP_RE, encodeMockup, mockupUrls,
  askRecords, answerRecords,
};
