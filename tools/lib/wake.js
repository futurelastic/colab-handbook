'use strict';
/**
 * tools/lib/wake.js — the closed `wake:` vocabulary of a `Hold:` line, parsed and evaluated once
 * (CONVENTIONS.md §5, *Holds*, #382).
 *
 * WHY THIS EXISTS. A hold used to name its wake as one of three forms — `review-by:<date>`, `#N`
 * (a `blocked_by` edge), or `ruling`. Anything else ("until the fix is deployed", "when some
 * capability lands") could only be prose in the `Because:` line, backed by a date. Nobody reads
 * that prose before the date. Measured across adopting repos, 2026-09-25 → 26: four holds whose
 * condition had already come true sat parked for hours to days, one of them waiting on another
 * repo's issue number that did not exist. Every one was right when set. What failed was
 * RELEASE: the condition came true and nothing noticed, because the only machine-readable part
 * was the date. So the vocabulary is widened to forms a scheduler can evaluate every beat, and
 * it stays CLOSED — no free text is ever evaluated.
 *
 * ONE SPELLING, NOT TWO. The checkable forms below are spelled name for name the way the one
 * adopting scheduler that already evaluates wakes spells them, argument rules included. That
 * scheduler accepts two more kinds (a claim released, a session gone) that describe a live
 * session, not a tracker fact a hold on an issue can wait on; they are deliberately not adopted
 * here. The rule is one-directional: every name in this file is one that scheduler accepts, and
 * no consumer invents a second spelling for any of them. `wake.test.js` pins the list.
 *
 * PURE BY CONSTRUCTION: strings in, verdicts out. No git, no network, no `gh`. `evaluate()` takes
 * facts a caller already gathered — the same posture as readiness.js and disposition.js — so a
 * consumer outside this repo reaches the same verdict from facts it collected its own way.
 *
 * WHICH DIRECTION THIS FAILS IN. Towards "not met" and towards "not a wake". A condition whose
 * fact is absent evaluates to `null` (unmeasured), never to `true`, so a hold never wakes on a
 * guess. A line with one unparseable piece is refused whole, never read as its parseable rest:
 * reading `issueClosed:o/r#12, until it is deployed` as just the first half would wake the hold
 * early on part of its condition, which rule 1 forbids.
 */

// A cross-repo issue ref: `<owner>/<repo>#<n>`. Same character class the scheduler uses.
const QUALIFIED_ISSUE_RE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(arg) {
  if (!ISO_DATE_RE.test(arg)) return false;
  const t = Date.parse(`${arg}T00:00:00Z`);
  // Date.parse rolls 2026-02-31 over to March; round-trip it so an impossible date is refused.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === arg;
}

/**
 * The checkable kinds, each with its argument validator — spelled and validated exactly as the
 * adopting scheduler does (see the header). Frozen: this list is the vocabulary.
 */
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

const WAKE_KINDS_TEXT = 'review-by:<date> · #N · ruling · issueClosed:<n|owner/repo#n> · ' +
  'branchLanded:<ref> · trunkAt:<sha> · labelPresent:<label> · after:<date>';

/**
 * Parse ONE wake condition. `null` for anything outside the closed vocabulary, or whose argument
 * fails its kind's validator — the caller treats `null` as "this line names no wake", never as
 * "skip this piece".
 * @returns {{kind:string, arg:string|null, raw:string}|null}
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

/**
 * The facts that decide each kind, as a caller gathers them. Every key optional:
 *   now          — epoch ms (for review-by / after); absent ⇒ dates unmeasured.
 *   issueClosed  — { "<n>" | "<owner/repo#n>": true|false }   (an edge's issue too, by number)
 *   branchLanded — { "<ref>": true|false }   (ref is an ancestor of trunk)
 *   trunkAt      — { "<sha>": true|false }   (trunk contains sha)
 *   labels       — string[] the held issue carries now
 *
 * `review-by:` and `after:` are met on or after their date (UTC midnight for a bare date).
 * Returns `true` (met), `false` (measured, not met) or `null` (unmeasured — never guessed).
 * `ruling` is always `null`: it waits on the owner's act, and the owner's act IS removing the
 * label, so no fact could ever make it "met" before the hold is already gone.
 */
function evaluateWake(cond, facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const lookup = (map, key) => {
    if (!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, key)) return null;
    return typeof map[key] === 'boolean' ? map[key] : null;
  };
  switch (cond && cond.kind) {
    case 'review-by':
      return Number.isFinite(f.now) ? f.now >= Date.parse(`${cond.arg}T00:00:00Z`) : null;
    case 'after': {
      if (!Number.isFinite(f.now)) return null;
      const t = /^\d+$/.test(cond.arg) ? Number(cond.arg) : Date.parse(cond.arg);
      return Number.isNaN(t) ? null : f.now >= t;
    }
    case 'edge':
    case 'issueClosed':
      return lookup(f.issueClosed, cond.arg);
    case 'branchLanded':
      return lookup(f.branchLanded, cond.arg);
    case 'trunkAt':
      return lookup(f.trunkAt, cond.arg);
    case 'labelPresent':
      return Array.isArray(f.labels) ? f.labels.includes(cond.arg) : null;
    case 'ruling':
    default:
      return null;
  }
}

/**
 * AND over a parsed line: `true` only when EVERY condition is measured met; `false` as soon as
 * one is measured not met; otherwise `null`. A hold never wakes early on part of its condition.
 */
function evaluateWakeLine(conditions, facts) {
  if (!Array.isArray(conditions) || conditions.length === 0) return null;
  let unmeasured = false;
  for (const c of conditions) {
    const v = evaluateWake(c, facts);
    if (v === false) return false;
    if (v !== true) unmeasured = true;
  }
  return unmeasured ? null : true;
}

module.exports = {
  WAKE_KINDS,
  CHECKABLE_KINDS: Object.freeze(Object.keys(CHECKABLE)),
  parseWake,
  parseWakeLine,
  evaluateWake,
  evaluateWakeLine,
  parseQualifiedIssueRef(arg) {
    const m = QUALIFIED_ISSUE_RE.exec(String(arg));
    return m ? { slug: m[1], number: Number(m[2]) } : null;
  },
};
