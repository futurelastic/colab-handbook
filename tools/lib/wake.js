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

// The vocabulary and its parsers — CHECKABLE's validators, `parseWake`, `parseWakeLine`, the
// qualified-ref parser — live in codec/hold.js (#498, epic #496) beside the `Hold:` line they
// belong to. Re-exported below under the names this module always had; what stays here is
// EVALUATION, which needs facts a caller gathered and so is not wire format.
const codec = require('./codec/hold');
const { WAKE_KINDS, CHECKABLE_KINDS, parseWake, parseWakeLine, parseQualifiedIssueRef } = codec;

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
  CHECKABLE_KINDS,
  parseWake,
  parseWakeLine,
  evaluateWake,
  evaluateWakeLine,
  parseQualifiedIssueRef,
};
