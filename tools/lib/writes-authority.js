'use strict';
/**
 * tools/lib/writes-authority.js — the precedence ladder behind #208's `writes` split.
 *
 * Same shape as tools/lib/axis-authority.js's tier -> exposure ladder, deliberately: one
 * frozen LEGACY map, one resolve function, a `source` tag naming which path answered. Not a
 * new mechanism — the ruling on #208 asked for the EXISTING one, reused for a second axis,
 * rather than a bespoke second way of reading a legacy value.
 *
 * Before this unit, `writes` had two declarable values — `isolated` (default) and `serial` —
 * covering THREE coherent methods (CONVENTIONS.md §2, "Writes"): `serial` collapsed the
 * trunk-direct and gated cells into one spelling, so a descriptor could not say which a repo
 * actually ran, and a reader answering "may this repo be granted `autonomy: auto-trunk`?" had
 * to piece the answer together from three separate passages (#208's measured defect). This
 * module is the read side of the fix: given a declared `writes:` value, it says which of the
 * three CURRENT methods is in force, and how it got there.
 *
 * `serial -> serial-direct` is the LEGACY resolution, and it is deliberately the one that
 * changes nothing observable for a repo that has not opted into the split — the identical
 * reasoning axis-authority.js gives for its own LEGACY map ("reproduces pre-#144 behaviour
 * byte for byte"). It rested on two reasons; #224 retired the second, so the first now
 * carries the resolution alone:
 *
 *   - Every repo declaring bare `serial` today is solo-flow eligible
 *     (`soloEligibility`, tools/lib/solo.js) — including this handbook's own descriptor,
 *     whose comment states outright that `writes: serial` "is what lets solo flow's entry
 *     gate open here". Resolving the alias to `serial-gated` instead would silently revoke
 *     that for every such repo the moment this unit lands. Still true, and sufficient on
 *     its own.
 *   - RETIRED (#224): this used to also cite the constraint matrix's `auto-trunk` cell,
 *     which read `forbidden` for `serial-direct` and `allowed` for `serial-gated` —
 *     resolving toward `serial-gated` looked like it would move a repo into a cell nobody
 *     had re-examined. #224 corrected that cell to `allowed` for both methods
 *     (CONVENTIONS.md §2 "Writes"; project.schema.md "writes — optional"): `auto-trunk`
 *     was never actually gated on `serial-direct` vs `serial-gated`, only on whether a
 *     branch exists for `colab ship` to act on. Resolving toward `serial-gated` no longer
 *     changes a repo's `auto-trunk` posture at all, so this reason no longer applies — the
 *     first reason above is what protects the alias now.
 *
 * Reclassifying an EXISTING repo's descriptor to `serial-gated` stays a human's call, never
 * inferred by this resolver — #208's migration note is explicit that reclassification is a
 * per-repo decision, not an automatic one, and this module's job is only to answer "what does
 * an unexamined `serial` mean today", not "what should it mean going forward".
 *
 * #237 (the ⚖ Decision on #233): the three-method reading above is RETIRED. `writes` no longer
 * selects a write-conflict prevention method — it is a two-state VETO. `writes: isolated` means
 * exactly one thing: no trunk-direct in this repo, human or not. Absence, and every other value
 * (including both `serial-*` spellings and the `serial` alias), means COEXISTENCE: automated
 * sessions work in worktrees, a human may take the trunk checkout and commit directly, and the
 * two run side by side. `resolveWrites` below is UNCHANGED — it still parses the declared value
 * and resolves the legacy alias, exactly as before — because nothing about that job is wrong,
 * only what callers may DO with its answer. The three-method resolution it still performs is now
 * inert either way: `serial-direct` and `serial-gated` both mean coexistence, so the alias
 * question this file's banner spends 30 lines on ("does `serial` mean `serial-direct` or
 * `serial-gated`?") no longer changes any repo's observable behaviour — both branches land on
 * the same veto answer. See `trunkDirectVetoed` below for the one function that now decides
 * anything.
 */

// The three current, declarable methods (CONVENTIONS.md §2, "Writes" — the four-row table).
// `isolated` is the schema default (omission = isolated); the other two are only meaningful
// when declared.
const WRITES_DECLARED = Object.freeze(['isolated', 'serial-direct', 'serial-gated']);
const WRITES_DECLARED_SET = new Set(WRITES_DECLARED);

// The one method the legacy spelling resolves to. See the file banner for why serial-direct,
// not serial-gated.
const WRITES_LEGACY = Object.freeze({ serial: 'serial-direct' });

// Everything the audit accepts as a value (current vocabulary + the legacy alias) — an enum
// check, not a resolution. `colab adopt --writes` also accepts this set, so an existing
// script or muscle-memory invocation using `--writes serial` keeps working.
const WRITES_ACCEPTED_SET = new Set([...WRITES_DECLARED, ...Object.keys(WRITES_LEGACY)]);

/**
 * Resolve a declared `writes:` value (possibly undefined/null/unrecognised) to one of the
 * three current methods. Returns `{ value, source }`:
 *
 *   { value: <one of WRITES_DECLARED>, source: 'declared' }      — current vocabulary, as-is.
 *   { value: 'serial-direct',          source: 'legacy' }        — the `serial` alias.
 *   { value: 'isolated',               source: 'default' }       — omitted entirely.
 *   { value: 'isolated',               source: 'unrecognised' }  — some other string; fails
 *                                                                   closed to isolated, never
 *                                                                   toward a serial reading.
 */
function resolveWrites(raw) {
  if (WRITES_DECLARED_SET.has(raw)) return { value: raw, source: 'declared' };
  if (Object.prototype.hasOwnProperty.call(WRITES_LEGACY, raw)) {
    return { value: WRITES_LEGACY[raw], source: 'legacy' };
  }
  return { value: 'isolated', source: raw === null || raw === undefined ? 'default' : 'unrecognised' };
}

/** Is `raw` a value the audit accepts — current vocabulary, the legacy alias, or omitted? */
function isAcceptedWritesValue(raw) {
  return raw === null || raw === undefined || WRITES_ACCEPTED_SET.has(raw);
}

/**
 * #237: does this descriptor's `writes:` VETO trunk-direct? The one two-state reading that
 * decides anything now (CONVENTIONS.md §2, "Writes"). `writes: isolated` vetoes trunk-direct
 * for every session, human or not; absence and every other declared value (both `serial-*`
 * spellings, the `serial` alias, and any unrecognised string) mean coexistence — no veto.
 *
 * Deliberately reads the RAW declared value, never `resolveWrites(raw).value` — that function's
 * `value` reads `'isolated'` on BOTH `source: 'declared'` (a real `writes: isolated` line) AND
 * `source: 'default'` (the key is simply absent). Testing `resolveWrites(raw).value ===
 * 'isolated'` would therefore veto every repo with no `writes:` key at all — the exact opposite
 * of the ruling ("Absence — and every other value — means coexistence"). Only an EXPLICIT,
 * exactly-spelled `writes: isolated` vetoes; everything else, including a typo'd or unrecognised
 * string, coexists (the audit's own enum check is what catches a typo — see
 * `isAcceptedWritesValue` above — a silent non-veto here is not an unattended-write risk, because
 * every path that non-veto opens still requires a human at the keyboard: `COLAB_HUMAN=1`).
 */
function trunkDirectVetoed(raw) {
  return raw === 'isolated';
}

module.exports = {
  WRITES_DECLARED,
  WRITES_LEGACY,
  WRITES_ACCEPTED_SET,
  resolveWrites,
  isAcceptedWritesValue,
  trunkDirectVetoed,
};
