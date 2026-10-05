'use strict';
/**
 * CODEC (#498, epic #496): the HOLD wire format — the two-line comment that parks an issue
 * (CONVENTIONS.md §5, *Holds*):
 *
 *   Hold: <label> — owner: <who clears it> — wake: <condition>[, <condition>…]
 *   Because: <what is left>
 *
 * — and the closed `wake:` vocabulary that line's last field is drawn from (#382). Pure and
 * synchronous: no I/O, no clock, no requires. EVALUATING a wake against facts stays in
 * tools/lib/wake.js, which re-exports the parsers below under the names it always had.
 *
 * Nothing in this toolkit writes a `Hold:` line yet; whoever parks the issue does, and code-triage
 * reads it. The pair exists so every reader parses ONE shape. A line in a looser shape (commas
 * instead of ` — `, a capitalised `Wake:`) is not decoded — it names no machine-readable owner or
 * wake, which is exactly the finding triage reports as a stall. Never loosen the decoder to accept
 * it: a guessed owner or wake is worse than none.
 *
 * ONE SPELLING, NOT TWO (from #382). The checkable wake kinds are spelled name for name the way the
 * one adopting scheduler that already evaluates wakes spells them, argument rules included.
 * wake.test.js pins the list. A line with one unparseable condition is refused WHOLE, never read as
 * its parseable rest — that would wake the hold early on part of its condition.
 */

// ── the wake vocabulary ──────────────────────────────────────────────────────────────────────

// A cross-repo issue ref: `<owner>/<repo>#<n>`. Same character class the scheduler uses.
const QUALIFIED_ISSUE_RE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(arg) {
  if (!ISO_DATE_RE.test(arg)) return false;
  const t = Date.parse(`${arg}T00:00:00Z`);
  // Date.parse rolls 2026-02-31 over to March; round-trip it so an impossible date is refused.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === arg;
}

/** The checkable kinds, each with its argument validator. Frozen: this list is the vocabulary. */
const CHECKABLE = Object.freeze({
  // Bare `<n>` (this repo's own issue) OR qualified `<owner>/<repo>#<n>` (another repo's).
  issueClosed: (arg) => /^\d+$/.test(arg) || QUALIFIED_ISSUE_RE.test(arg),
  branchLanded: (arg) => arg.length > 0 && !/\s/.test(arg),
  trunkAt: (arg) => /^[0-9a-f]{7,40}$/i.test(arg),
  labelPresent: (arg) => arg.length > 0,
  // Epoch-ms digits OR anything Date.parse accepts — permissive on FORMAT only, because this is
  // the one argument a human chooses; the kind itself is still closed.
  after: (arg) => /^\d+$/.test(arg) || !Number.isNaN(Date.parse(arg)),
});

/** The handbook's own three forms, older than the checkable ones and unchanged by #382. */
const NATIVE = Object.freeze(['review-by', 'edge', 'ruling']);
/** Every kind a `wake:` may carry, in the order CONVENTIONS lists them. */
const WAKE_KINDS = Object.freeze([...NATIVE, ...Object.keys(CHECKABLE)]);
const CHECKABLE_KINDS = Object.freeze(Object.keys(CHECKABLE));

const WAKE_KINDS_TEXT = 'review-by:<date> · #N · ruling · issueClosed:<n|owner/repo#n> · ' +
  'branchLanded:<ref> · trunkAt:<sha> · labelPresent:<label> · after:<date>';

/**
 * Parse ONE wake condition → `{kind, arg, raw}`, or `null` for anything outside the closed
 * vocabulary or whose argument fails its kind's validator. A caller treats `null` as "this line
 * names no wake", never as "skip this piece".
 */
function parseWake(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;
  if (s === 'ruling') return { kind: 'ruling', arg: null, raw: s };
  const edge = /^#(\d+)$/.exec(s);
  if (edge) return { kind: 'edge', arg: edge[1], raw: s };
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  const kind = s.slice(0, idx);
  const arg = s.slice(idx + 1);
  if (arg === '') return null;
  if (kind === 'review-by') return isIsoDate(arg) ? { kind, arg, raw: s } : null;
  const validate = Object.prototype.hasOwnProperty.call(CHECKABLE, kind) ? CHECKABLE[kind] : null;
  if (!validate || !validate(arg)) return null;
  return { kind, arg, raw: s };
}

/**
 * Parse the value of a `wake:` field — one condition, or several separated by commas, ANDed.
 * Accepts the string as written on the `Hold:` line, or an array of condition strings.
 * @returns {{ok:true, conditions:Array<{kind,arg,raw}>}|{ok:false, error:string}}
 */
function parseWakeLine(value) {
  const parts = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : null);
  if (!parts) return { ok: false, error: 'wake: is missing' };
  const pieces = parts.map((p) => (typeof p === 'string' ? p.trim() : p)).filter((p) => p !== '');
  if (pieces.length === 0) return { ok: false, error: 'wake: is empty — a hold must name what ends it' };
  const conditions = [];
  for (const p of pieces) {
    const c = parseWake(p);
    if (!c) {
      return {
        ok: false,
        error: `wake condition ${JSON.stringify(p)} is not in the closed vocabulary — ${WAKE_KINDS_TEXT}. ` +
          'A wait with no checkable form stays prose in Because: and carries review-by:<date>.',
      };
    }
    conditions.push(c);
  }
  return { ok: true, conditions };
}

/** `<owner>/<repo>#<n>` → `{slug, number}`, or null. */
function parseQualifiedIssueRef(arg) {
  const m = QUALIFIED_ISSUE_RE.exec(String(arg));
  return m ? { slug: m[1], number: Number(m[2]) } : null;
}

// ── the Hold: / Because: lines ───────────────────────────────────────────────────────────────

const HOLD_RE = /^Hold: (\S+) — owner: (.+?) — wake: (.+)$/;
const BECAUSE_RE = /^Because: (.*)$/;

/**
 * `{label, owner, wake, because?}` → the hold comment. `wake` is the field as written (conditions
 * joined by `, `); pass an array to have it joined. `because` null/absent → the `Hold:` line alone.
 * The codec writes what it is given — checking `wake` against the vocabulary is `parseWakeLine`'s job.
 */
function encodeHold({ label, owner, wake, because } = {}) {
  const w = Array.isArray(wake) ? wake.join(', ') : wake;
  const line = `Hold: ${label} — owner: ${owner} — wake: ${w}`;
  return because == null ? line : `${line}\nBecause: ${because}`;
}

/**
 * A hold comment → `{label, owner, wake, because}`, or null when its FIRST line is not a `Hold:`
 * line in the canonical shape. `because` is the second line's text when that line is `Because: …`
 * and nothing follows it; anything else after the `Hold:` line makes the comment not a hold record
 * (null) rather than a partially-read one. `wake` is the raw field — `parseWakeLine(wake)` decides
 * whether it names a wake at all.
 */
function decodeHold(body) {
  const lines = String(body == null ? '' : body).replace(/\r\n/g, '\n').trim().split('\n');
  const h = HOLD_RE.exec(lines[0]);
  if (!h) return null;
  if (lines.length === 1) return { label: h[1], owner: h[2], wake: h[3], because: null };
  const b = lines.length === 2 ? BECAUSE_RE.exec(lines[1]) : null;
  if (!b) return null;
  return { label: h[1], owner: h[2], wake: h[3], because: b[1] };
}

module.exports = {
  WAKE_KINDS, CHECKABLE_KINDS, WAKE_KINDS_TEXT,
  parseWake, parseWakeLine, parseQualifiedIssueRef,
  HOLD_RE, BECAUSE_RE, encodeHold, decodeHold,
};
