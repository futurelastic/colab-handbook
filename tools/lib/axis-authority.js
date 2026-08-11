'use strict';
/**
 * tools/lib/axis-authority.js — the precedence ladder behind #144's authority flip.
 *
 * Before this unit, `tier` alone counted the gates between a merge and users. `exposure`
 * (#132) landed as a strictly additive, optional key answering the same question in a
 * strictly more precise vocabulary — but `tier` stayed authoritative, on purpose, until this
 * unit existed to cut the weld safely. This module IS that cut: given a parsed
 * `.github/project.yml`, it says which key is the axis of record for gate count, and what
 * exposure value that resolves to.
 *
 * `tier -> exposure` is a FUNCTION, not a BIJECTION. `A -> released` holds; `released -> A`
 * does not, because `released` covers two legal shapes — a tag deploying to a live server
 * (the historical `tier: A` shape), and adopters copying files out of a tag with no server at
 * all (this handbook's own shape: `tier: B`, `exposure: released`, `production: null`). A
 * descriptor that answers with `exposure` is therefore answering a STRICTLY MORE PRECISE
 * question than one that only ever answered with `tier`, which is why the ladder below trusts
 * `exposure` first and reads `tier` only when nothing more precise is on record.
 *
 * CommonJS, matching stamp.js: `audit/audit.mjs` (ESM) consumes this through `createRequire`,
 * exactly as it already does for stamp.js and labels.js; `tools/colab` (CJS) can `require` it
 * directly. One implementation, not two, for the identical reason stamp reading lives in one
 * place — two readings of "which axis governs" disagreeing is the two-places-drift disease
 * this handbook exists to kill.
 */

// The one exposure value each LEGACY tier maps to, when no `exposure` key is present at all.
// `B -> null` is the load-bearing entry, not an oversight: a bare `tier: B` descriptor carries
// no derivable opinion about what consumes it. `none`, `self` and `released` are all measured
// under `B` in this very fleet (the 5-5 split #144's plan cites, plus this repo's own shape),
// so nothing here may GUESS which one a bare `B` means — that guess is exactly the naive flip
// this module exists to avoid writing. The `null` is the code-level reason phase 3 of the epic
// (ten repos answering the exposure question by hand) still has to happen: it is what a lossy
// legacy read looks like, in the type system, for the one tier where the mapping is genuinely
// unknown rather than merely unwritten.
const LEGACY = Object.freeze({ A: 'released', C: 'live', B: null });

// The one exposure value each tier is CONSISTENT with, used only when both keys are declared
// and might disagree. `B` is deliberately absent: per LEGACY.B above, `tier: B` carries no
// opinion, so no exposure value declared alongside it can ever contradict it — `tier: B` +
// `exposure: live` is `B` contradicting nothing, not `B` agreeing with `live`.
const CONSISTENT_WITH = Object.freeze({ A: 'released', C: 'live' });

// Gate count a resolved exposure value implies — additive `--json` reporting only in this
// unit (#144's oracle: "`--json`: `tier` continues to report the DECLARED letter... New keys
// are additive"). `self` is 0, the same as `none`: both describe a consumer set with no
// external gate to guard, `self` merely a non-empty one bounded by the room.
const GATE_COUNT = Object.freeze({ none: 0, self: 0, live: 1, released: 2 });

/**
 * Which key is the axis of record for `cfg` (a parsed `.github/project.yml`, possibly
 * null/undefined for an unparseable or missing file — treated the same as an empty object),
 * and what exposure value it resolves to. Returns exactly one of:
 *
 *   { source: 'exposure',    tier, exposure }  — `exposure` was declared; it wins outright,
 *                                                 `tier` (declared or not) is carried through
 *                                                 unread by this function's own logic.
 *   { source: 'tier-legacy', tier, exposure }  — only `tier` was declared; `exposure` is
 *                                                 DERIVED via LEGACY (`null` for `tier: B`).
 *   { source: 'none',        tier: null, exposure: null } — neither key was declared: no
 *                                                 axis of record at all.
 */
function axisOfRecord(cfg) {
  const c = cfg || {};
  const hasExposure = 'exposure' in c && c.exposure !== null && c.exposure !== undefined;
  const hasTier = 'tier' in c && c.tier !== null && c.tier !== undefined;
  if (hasExposure) {
    return { source: 'exposure', tier: hasTier ? c.tier : null, exposure: c.exposure };
  }
  if (hasTier) {
    const exposure = Object.prototype.hasOwnProperty.call(LEGACY, c.tier) ? LEGACY[c.tier] : null;
    return { source: 'tier-legacy', tier: c.tier, exposure };
  }
  return { source: 'none', tier: null, exposure: null };
}

/**
 * When BOTH `tier` and `exposure` are declared, do they disagree about gate count? Returns a
 * finding string — the one disagreement `fail` #144's plan calls for — or `null` when they
 * agree, INCLUDING every `tier: B` pairing (see CONSISTENT_WITH above: `B` contradicts
 * nothing). Silent, not merely non-failing, on an invalid `tier` — the enum check elsewhere
 * already reports that; this function only ever compares two values it can compare.
 */
function contradiction(tier, exposure) {
  if (!tier || !exposure) return null;
  if (!(tier in CONSISTENT_WITH)) return null; // tier B (contradicts nothing) or an invalid tier
  const want = CONSISTENT_WITH[tier];
  if (want === exposure) return null;
  return (
    `tier: ${tier} and exposure: ${exposure} disagree about how many gates stand between a ` +
    `merge and users — tier ${tier} means exposure: ${want}. Fix whichever is stale, or drop ` +
    `it: exposure is now the axis of record (CONVENTIONS.md §2)`
  );
}

module.exports = { LEGACY, CONSISTENT_WITH, GATE_COUNT, axisOfRecord, contradiction };
