'use strict';
/**
 * CODEC (#499, epic #496): two markers for trackers that LACK a native field this toolkit relies
 * on — a parent/child relation (native sub-issues) and a close reason (completed vs not planned).
 * Pure and synchronous. No writer uses them yet: they are designed from documented tracker
 * capabilities, so an adapter for such a tracker has one agreed spelling to write and read.
 *
 * PARENT. Written into the CHILD's body, in two forms:
 *   comment  `<!-- colab:parent issue=<ref> -->`   invisible, the machine-readable form
 *   line     `Parent: <ref>`                        visible fallback, at the start of a line, for a
 *                                                   tracker (or an editor) that strips HTML comments
 * `<ref>` is `#<n>` (same repo) or `<owner>/<repo>#<n>`. An adapter writes both; a reader prefers
 * the comment and falls back to the line (`readParent`).
 *
 * A parent is NEVER encoded as a dependency edge ("child blocks epic"): the conventions forbid an
 * edge pointing at an epic (CONVENTIONS.md §5, *Epics*) — readiness would read every epic as
 * blocked by its own children, which is the wrong question. Containment and dependency stay two
 * different facts, on two different wires.
 *
 * CLOSE REASON. Also two forms, carried by a COMMENT posted when the item is closed:
 *   comment  `<!-- colab:close-reason reason=<completed|not-planned> -->`
 *   line     `Close reason: <completed|not-planned>`
 * It is read for CLOSED items only (`readCloseReason`): on an open item — closed once, then
 * reopened — an old marker describes a close that no longer stands, so it reads as nothing. The
 * newest marker wins, so close → reopen → close reads the last close.
 */

// ── parent ───────────────────────────────────────────────────────────────────────────────────

const PARENT_REF_RE = /^(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([1-9][0-9]*)$/;
const PARENT_COMMENT_RE = /^<!-- colab:parent issue=(\S+) -->$/;
const PARENT_LINE_RE = /^Parent: (\S+)$/;

/** `{repo?, number}` → `#N` / `owner/repo#N`. */
function encodeParentRef({ repo, number } = {}) { return `${repo || ''}#${number}`; }
/** `#N` / `owner/repo#N` → `{repo, number}` (`repo` null for same-repo), or null. */
function decodeParentRef(ref) {
  const m = PARENT_REF_RE.exec(String(ref == null ? '' : ref));
  return m ? { repo: m[1] || null, number: Number(m[2]) } : null;
}

/** `{repo?, number, form: 'comment'|'line'}` → the marker. */
function encodeParent({ repo, number, form = 'comment' } = {}) {
  const ref = encodeParentRef({ repo, number });
  if (form === 'comment') return `<!-- colab:parent issue=${ref} -->`;
  if (form === 'line') return `Parent: ${ref}`;
  throw new TypeError(`encodeParent: unknown form ${JSON.stringify(form)}`);
}

/** ONE marker (comment or line, whole) → `{repo, number, form}`, or null. */
function decodeParent(marker) {
  const s = String(marker == null ? '' : marker).trim();
  for (const [form, re] of [['comment', PARENT_COMMENT_RE], ['line', PARENT_LINE_RE]]) {
    const m = re.exec(s);
    if (!m) continue;
    const ref = decodeParentRef(m[1]);
    return ref ? { ...ref, form } : null;
  }
  return null;
}

/**
 * The parent a child's BODY declares → `{repo, number, form, conflict}`, or null. Each line is
 * tried as a marker (a line form counts only at the start of a line; an indented one is quoted
 * text). The comment form wins over the line form; `conflict` is true when the body carries more
 * than one distinct parent, which a reader should report rather than silently pick.
 */
function readParent(body) {
  const found = [];
  for (const line of String(body == null ? '' : body).replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s/.test(line)) continue;
    const p = decodeParent(line);
    if (p) found.push(p);
  }
  if (!found.length) return null;
  const pick = found.find((p) => p.form === 'comment') || found[0];
  const key = (p) => `${p.repo || ''}#${p.number}`;
  return { ...pick, conflict: new Set(found.map(key)).size > 1 };
}

/** The child-body block an adapter writes: the comment, then the visible line. */
function encodeParentBlock({ repo, number } = {}) {
  return `${encodeParent({ repo, number, form: 'comment' })}\n${encodeParent({ repo, number, form: 'line' })}`;
}

// ── close reason ─────────────────────────────────────────────────────────────────────────────

const CLOSE_REASONS = Object.freeze(['completed', 'not-planned']);
const CLOSE_REASON_COMMENT_RE = /^<!-- colab:close-reason reason=(\S+) -->$/;
const CLOSE_REASON_LINE_RE = /^Close reason: (\S+)$/;

/** `{reason, form: 'comment'|'line'}` → the marker. Throws on a reason outside the closed set. */
function encodeCloseReason({ reason, form = 'comment' } = {}) {
  if (!CLOSE_REASONS.includes(reason)) throw new TypeError(`encodeCloseReason: unknown reason ${JSON.stringify(reason)}`);
  if (form === 'comment') return `<!-- colab:close-reason reason=${reason} -->`;
  if (form === 'line') return `Close reason: ${reason}`;
  throw new TypeError(`encodeCloseReason: unknown form ${JSON.stringify(form)}`);
}

/** ONE marker (whole) → `{reason, form}`, or null — including for a reason outside the closed set. */
function decodeCloseReason(marker) {
  const s = String(marker == null ? '' : marker).trim();
  for (const [form, re] of [['comment', CLOSE_REASON_COMMENT_RE], ['line', CLOSE_REASON_LINE_RE]]) {
    const m = re.exec(s);
    if (m) return CLOSE_REASONS.includes(m[1]) ? { reason: m[1], form } : null;
  }
  return null;
}

/** The close-reason block an adapter posts: the comment, then the visible line. */
function encodeCloseReasonBlock(reason) {
  return `${encodeCloseReason({ reason, form: 'comment' })}\n${encodeCloseReason({ reason, form: 'line' })}`;
}

/**
 * The close reason of an item → `'completed' | 'not-planned'`, or null. `state` is the item's state
 * now; anything but `closed` (case-insensitive) reads null whatever the comments say. Otherwise the
 * NEWEST comment (by `createdAt`) carrying a valid marker on one of its lines decides; within one
 * comment the comment form wins over the line form.
 */
function readCloseReason({ state, comments } = {}) {
  if (String(state || '').toLowerCase() !== 'closed') return null;
  const sorted = [...(Array.isArray(comments) ? comments : [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const c of sorted) {
    const found = String((c && c.body) || '').replace(/\r\n/g, '\n').split('\n')
      .filter((l) => !/^\s/.test(l)).map(decodeCloseReason).filter(Boolean);
    if (found.length) return (found.find((f) => f.form === 'comment') || found[0]).reason;
  }
  return null;
}

module.exports = {
  PARENT_COMMENT_RE, PARENT_LINE_RE,
  encodeParentRef, decodeParentRef, encodeParent, decodeParent, readParent, encodeParentBlock,
  CLOSE_REASONS, CLOSE_REASON_COMMENT_RE, CLOSE_REASON_LINE_RE,
  encodeCloseReason, decodeCloseReason, encodeCloseReasonBlock, readCloseReason,
};
