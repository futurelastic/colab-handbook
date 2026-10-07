'use strict';
/**
 * tools/lib/thresholds.js — repo-declared values for the ADVISORY thresholds (#560, epic #558).
 *
 * Before this module each of these numbers was one fleet-wide constant, written into a skill's
 * prose or a tool's source. The ruling on #560: today's value stays as the documented default, and
 * a repo may override it in `.github/project.yml`:
 *
 *   thresholds:
 *     hot-file-count: 4
 *     hold-stale-days: 45
 *
 * Nothing changes for a repo that declares nothing. Only ADVISORY thresholds live here — a number
 * that decides what gets flagged, ranked or warned about. Safety limits (a cap a repo may only
 * tighten) and protocol counts are out of scope (epic #558) and keep their own fields.
 *
 * Every value is a whole number with a per-key floor, and the unit is in the key's name. That keeps
 * the CI templates' shell copy of this rule (the descriptor check, #416) small enough to be held to
 * this table by tools/lib/ci-template-descriptor-check.test.js.
 *
 * A malformed value — a typo'd key, a non-number, a number under the floor — falls back to the
 * default and is reported; the audit and the descriptor check fail it. A typo'd key is a problem,
 * not an ignored extra: silently reverting to the default is exactly the failure #416 measured.
 *
 * Pure: a parsed descriptor in, values out. Both YAML readers feed it — the CLI's (numbers come
 * through as numbers) and the audit's (they come through as digit strings) — so it accepts both.
 */

const KEY = 'thresholds';

/**
 * key → { def, min, what, where }. `where` names the one place that reads the value.
 * Order is the order `colab thresholds` prints.
 */
const SPEC = Object.freeze({
  'hot-file-count': { def: 3, min: 2, what: 'waiting issues on one path before triage files HOT FILE', where: 'skills/code-triage/3-hot-file.md' },
  'dependents-count': { def: 3, min: 1, what: 'open issues blocked_by one issue before triage ranks it as leverage', where: 'skills/code-triage/4-order.md' },
  'hold-stale-days': { def: 30, min: 1, what: 'days a hold\'s wake condition may stand unmoved before a human confirms it', where: 'tools/lib/disposition.js' },
  'smoke-minutes': { def: 3, min: 1, what: 'target run time of gate.smoke', where: 'skills/code-wrap/SKILL.md' },
  'claude-md-kb': { def: 40, min: 1, what: 'authored KB of CLAUDE.md plus its @-imports before the audit warns', where: 'audit/audit.mjs' },
  'claude-md-line-multiple': { def: 6, min: 2, what: 'longest line as a multiple of the file\'s median line before the audit warns', where: 'audit/audit.mjs' },
  'claude-md-line-floor-bytes': { def: 2048, min: 0, what: 'a line under this many bytes is never flagged on the multiple alone', where: 'audit/audit.mjs' },
  'transitional-days': { def: 180, min: 1, what: 'days a transitional descriptor value holds before the audit says how long', where: 'audit/audit.mjs' },
  'doc-budget-slack': { def: 100, min: 0, what: 'lines under a doc budget before check-doc-budget asks to lower it', where: 'scripts/check-doc-budget.mjs' },
});

const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k, s.def])));

/** At most nine digits — the CI templates' shell check compares with `[ -ge ]`, which must not overflow. */
const MAX_VALUE = 999999999;

function wholeNumber(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw <= MAX_VALUE ? raw : NaN;
  if (typeof raw === 'string' && /^\s*[0-9]{1,9}\s*$/.test(raw)) return Number(raw);
  return NaN;
}

/**
 * `doc` → `{ values, declared, problems }`. `values` always carries every key (the default where
 * nothing valid was declared); `declared` names the keys whose declared value is in force;
 * `problems` is one sentence per malformed entry, each ending with the default it fell back to.
 */
function parseThresholds(doc) {
  const values = Object.assign({}, DEFAULTS);
  const declared = {};
  const problems = [];
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, KEY);
  const raw = has ? doc[KEY] : undefined;
  if (raw === undefined || raw === null || raw === '') return { values, declared, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${KEY} must be a map of "name: whole number" pairs, got ${JSON.stringify(raw)} — every threshold keeps its default`);
    return { values, declared, problems };
  }
  for (const [k, v] of Object.entries(raw)) {
    const spec = SPEC[k];
    if (!spec) {
      problems.push(`${KEY}.${k} is not a known threshold (known: ${Object.keys(SPEC).join(', ')}) — ignored`);
      continue;
    }
    if (v === null || v === undefined || v === '') continue; // an empty entry declares nothing
    const n = wholeNumber(v);
    if (!Number.isFinite(n) || n < spec.min) {
      problems.push(`${KEY}.${k} must be a whole number ≥ ${spec.min}, got ${JSON.stringify(v)} — using the default ${spec.def}`);
      continue;
    }
    values[k] = n;
    declared[k] = true;
  }
  return { values, declared, problems };
}

/** The resolved value of one key — the convenience a single consumer wants. */
function thresholdValue(doc, key) {
  if (!SPEC[key]) throw new Error(`unknown threshold ${key}`);
  return parseThresholds(doc).values[key];
}

module.exports = { KEY, SPEC, DEFAULTS, MAX_VALUE, parseThresholds, thresholdValue };
