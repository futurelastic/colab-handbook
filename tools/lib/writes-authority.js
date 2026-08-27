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

// #283: the three spellings the WIZARD offers and `writesMode` (below) resolves TOWARD —
// replacing the retired 3-method vocabulary with names that describe what a repo PERMITS, not a
// mechanism it once selected. `direct` is new: declared, stored, and honestly reported today
// (deriveConsequences, --json, the wizard), but its RUNTIME is deferred — see CONVENTIONS.md
// §2, "writes: direct — declared today, runtime deferred (#283)". `trunkDirectVetoed` (below)
// is unaffected: only the exact string 'isolated' ever vetoes, under either vocabulary.
const WRITES_CURRENT = Object.freeze(['free', 'direct', 'isolated']);
const WRITES_CURRENT_SET = new Set(WRITES_CURRENT);

// The three pre-#283 spellings (#208's original 3-method split), ALL of which `writesMode` now
// folds toward `free` — distinct from `WRITES_LEGACY` above (the `serial` alias, which
// `resolveWrites` still parses toward `serial-direct`, unchanged): this is the wider set
// `writesMode` needs to recognise every spelling that predates this vocabulary, `serial`
// included, in one pass.
const WRITES_LEGACY_FREE = Object.freeze(['serial', 'serial-direct', 'serial-gated']);
const WRITES_LEGACY_FREE_SET = new Set(WRITES_LEGACY_FREE);

// Everything the audit accepts as a value (current vocabulary + every legacy spelling) — an
// enum check, not a resolution. `colab adopt --writes` also accepts this set, so an existing
// script or muscle-memory invocation using `--writes serial` (or `serial-direct`/`serial-gated`)
// keeps working, and `--writes direct` is now legal too (subject to `writesGateVerdict` in
// tools/lib/adopt.js).
const WRITES_ACCEPTED_SET = new Set([
  ...WRITES_DECLARED, ...Object.keys(WRITES_LEGACY), ...WRITES_CURRENT, ...WRITES_LEGACY_FREE,
]);

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
 *
 * DEPRECATED-INTERNAL as of #283: this resolver's OWN job (parse the `serial` alias toward
 * `serial-direct`, report `source`) is unchanged and still correct — nothing here is wrong — but
 * nothing outside `writes-authority.js` should read its 3-way `.value` as deciding anything any
 * longer, for the identical trap `trunkDirectVetoed`'s docstring below has always warned about.
 * `tools/lib/adopt.js`'s `deriveConsequences` reads `writesMode(raw)` instead, which is a TOTAL
 * function onto exactly `free` / `direct` / `isolated` and cannot produce that trap in the first
 * place. `resolveWrites` stays exported, unchanged, and fully tested for whatever legacy-alias
 * bookkeeping still needs its 3-way parse — it is retired from being read as a method choice,
 * not retired outright.
 */
function resolveWrites(raw) {
  if (WRITES_DECLARED_SET.has(raw)) return { value: raw, source: 'declared' };
  if (Object.prototype.hasOwnProperty.call(WRITES_LEGACY, raw)) {
    return { value: WRITES_LEGACY[raw], source: 'legacy' };
  }
  return { value: 'isolated', source: raw === null || raw === undefined ? 'default' : 'unrecognised' };
}

/**
 * #283: the TOTAL reading `deriveConsequences` uses instead of `resolveWrites` — maps EVERY
 * possible input (undefined/null, any of the three current spellings, any of the three legacy
 * spellings, or an unrecognised string) onto exactly one of `free` / `direct` / `isolated`, with
 * a `source` naming which bucket it came from. "Total" is the point: there is no input this
 * function fails to classify, which is what makes "writesResolved disagrees with trunkDirect"
 * (#282) structurally unreachable — see `tools/lib/adopt.js`'s `deriveConsequences`.
 *
 * Fails toward `free` on anything unrecognised — the same posture `trunkDirectVetoed` already
 * takes (only an exact, correctly-spelled `isolated` ever restricts anything); the audit's own
 * enum check (`isAcceptedWritesValue`) is what catches a typo, not this function.
 *
 *   { mode: 'free',            source: 'default' }       — undefined/null (the key is absent).
 *   { mode: 'free',            source: 'legacy' }         — one of WRITES_LEGACY_FREE.
 *   { mode: <one of WRITES_CURRENT>, source: 'declared' } — raw is exactly free/direct/isolated.
 *   { mode: 'free',            source: 'unrecognised' }   — anything else; fails closed to free,
 *                                                            never toward isolated or direct.
 */
function writesMode(raw) {
  if (raw === null || raw === undefined) return { mode: 'free', source: 'default' };
  if (WRITES_CURRENT_SET.has(raw)) return { mode: raw, source: 'declared' };
  if (WRITES_LEGACY_FREE_SET.has(raw)) return { mode: 'free', source: 'legacy' };
  return { mode: 'free', source: 'unrecognised' };
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

/**
 * #239: the sync announcement for ⚖ #233 (CONVENTIONS.md §2, "Writes" — the four-row table).
 * Four shapes, keyed on the RAW declared value exactly like `trunkDirectVetoed` (never the
 * 3-way `resolveWrites` parse, for the identical trap that function's own docstring warns
 * about — reading `.value` would call an absent key "isolated").
 *
 * This text is the ONE source for the announcement — the audit's sync-path warn quotes it
 * verbatim (audit/audit.mjs, gated by tools/lib/stamp.js's `writesRulingKnownAt`), and it is
 * meant to double as the "writes" bullet in whichever tag's release notes ship #237/⚖ #233 —
 * written once, so the two copies cannot drift apart the way a hand-restated pair always does.
 */
function writesSyncAdvisory(raw) {
  // #283: `free`/`direct` branches, added for totality now that `writesMode` widens the enum —
  // near-dead code today, same as the four branches below: `writesRulingKnownAt` (stamp.js)
  // gates this whole call site on a repo's stamp predating ⚖ #237, and no repo can predate #237
  // while already declaring #283's vocabulary. Added for completeness, not reach.
  if (raw === 'free') {
    return 'writes: free is the ⚖ #233/#283 spelling of coexistence — identical to omitting the '
      + 'key, or to any of the legacy serial* spellings (CONVENTIONS.md §2, Writes)';
  }
  if (raw === 'direct') {
    return 'writes: direct declares that an attended human may commit straight to trunk — the '
      + 'SAME runtime permission as free/absence today (declared, not yet enforced — #283); see '
      + 'CONVENTIONS.md §2, "writes: direct — declared today, runtime deferred (#283)"';
  }
  if (raw === 'isolated') {
    return 'writes: isolated changed meaning under ⚖ #233 — it no longer describes a default, '
      + 'it now VETOES trunk-direct outright, human or not. If this repo runs many concurrent '
      + 'units and declared isolated only to describe that shape (not to forbid trunk-direct), '
      + 'confirm with the repo\'s owner whether the veto is actually intended (CONVENTIONS.md '
      + '§2, Writes)';
  }
  if (raw === 'serial-gated') {
    return 'writes: serial-gated is inert under ⚖ #233 — coexistence is the default regardless. '
      + 'Its one real assertion, a pre-merge gate exists here, moved to the axis that owns '
      + 'gating: declare it there instead (a trunk-gating CI workflow, or branch protection), '
      + 'not via writes (CONVENTIONS.md §2, Writes)';
  }
  if (raw === 'serial' || raw === 'serial-direct') {
    return `writes: ${raw} is inert under ⚖ #233 — identical to omitting the key; coexistence `
      + 'is the default regardless. The line may be removed (CONVENTIONS.md §2, Writes)';
  }
  // raw === null/undefined, or an unrecognised string — both coexist by the same reading
  // trunkDirectVetoed gives them, so both get the "silent majority" message (#239's own name
  // for this case: the only channel that reaches a repo declaring nothing).
  return 'writes is undeclared — as of ⚖ #233 this now means COEXISTENCE: a worktree session '
    + 'and an attended human trunk-direct session (COLAB_HUMAN=1) may both write to this repo\'s '
    + 'trunk, side by side. If that is not intended, declare writes: isolated to veto trunk-direct '
    + 'outright (CONVENTIONS.md §2, Writes)';
}

module.exports = {
  WRITES_DECLARED,
  WRITES_LEGACY,
  WRITES_CURRENT,
  WRITES_LEGACY_FREE,
  WRITES_ACCEPTED_SET,
  resolveWrites,
  writesMode,
  isAcceptedWritesValue,
  trunkDirectVetoed,
  writesSyncAdvisory,
};
