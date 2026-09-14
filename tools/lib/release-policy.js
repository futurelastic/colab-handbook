'use strict';
/**
 * tools/lib/release-policy.js — the `release:` block of `.github/project.yml` (#337).
 *
 * CONVENTIONS.md §6's release rung (#330, #335) decides, from `exposure` + `deploy`, whether an
 * agent may cut a candidate tag and whether a candidate's final tag is automatic. This module is
 * the one executable version of that table, plus the block a repo may declare to NARROW it:
 *
 *   release:
 *     candidates: auto      # auto | off
 *     test-period: 3d       # <N>d, never below the rung's 3 days
 *     final: auto           # auto | human
 *
 * The block may narrow, never widen. `final: auto` where the rung says human, `candidates: auto`
 * where the rung cuts no tags, and a test period shorter than the rung's are validation FAILURES,
 * not overrides — "nothing in project.yml lowers that" (§6) is enforced here, not promised.
 *
 * Shared by `audit/audit.mjs` (ESM, through createRequire — the exposure-shape.js precedent) and,
 * later, `colab release cut` (#338). One reading of the rung, not two: a CLI that cut a tag the
 * audit would have called a widening is exactly the two-places drift this repo exists to kill.
 *
 * Fail closed: anything the rung does not name (undeclared or unknown exposure, a bare legacy
 * `tier: B`, a `released` repo whose deploy/production match no row) derives
 * `candidates: off` + `final: human`, so no declaration can widen it into automatic tagging.
 */

const axisAuthority = require('./axis-authority.js');

const KEYS = Object.freeze(['candidates', 'test-period', 'final']);
const CANDIDATES = Object.freeze(['auto', 'off']);
const FINAL = Object.freeze(['auto', 'human']);
// The rung's own test period (CONVENTIONS.md §6: "The test period is 3 days"). A floor, not a
// suggestion: a declared period may be longer, never shorter.
const TEST_PERIOD_DAYS = 3;

/**
 * The rung row `cfg` (a parsed project.yml, possibly null) falls on, and the policy it derives.
 * Returns { row, axis, candidates, testPeriodDays, final, why } where `row` is one of
 * 'no-tags' | 'live' | 'released-no-production' | 'released-tag' | 'released-manual' |
 * 'unmatched', `axis` is a human label for the finding text, and `why` says what the row means.
 */
function deriveDefault(cfg) {
  const c = cfg || {};
  const rec = axisAuthority.axisOfRecord(c);
  const exposure = rec.exposure;
  const axis = rec.source === 'tier-legacy'
    ? `tier: ${rec.tier} (read as exposure: ${exposure === null ? 'undeclared' : exposure})`
    : rec.source === 'exposure' ? `exposure: ${exposure}` : 'no exposure or tier';
  const deploy = c.deploy === undefined || c.deploy === null ? 'none' : c.deploy;
  const production = c.production === undefined || c.production === '' ? null : c.production;
  const base = { axis, testPeriodDays: TEST_PERIOD_DAYS };
  const closed = (row, why) => ({ ...base, row, candidates: 'off', final: 'human', why });

  if (exposure === 'none' || exposure === 'self') return closed('no-tags', 'nothing consumes a tag here, so no tags are cut');
  if (exposure === 'live') return closed('live', 'the promotion is the deploy and stays human; no automatic tags');
  if (exposure === 'released') {
    if (deploy === 'tag') {
      return { ...base, row: 'released-tag', candidates: 'auto', final: 'human', why: 'the tag deploys production, so the final tag is a human act' };
    }
    if (deploy === 'manual') {
      return { ...base, row: 'released-manual', candidates: 'auto', final: 'human', why: 'a person deploys from the tag, so the final tag is a human act' };
    }
    if (deploy === 'none' && production === null) {
      return { ...base, row: 'released-no-production', candidates: 'auto', final: 'auto', why: 'adopters install it and nothing deploys, so the final tag is automatic after a clean test period' };
    }
  }
  return closed('unmatched', 'no row of the release rung names this descriptor, so it fails closed — a human tags');
}

function parseTestPeriod(v) {
  const m = typeof v === 'string' ? /^([0-9]+)d$/.exec(v.trim()) : null;
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Validate the declared `release:` block against the derived default.
 * Returns { declared, derived, effective, findings } — `declared` is the raw block (null when
 * absent), `effective` is what a tool acts on: the derived default, narrowed by every VALID
 * declared key. An invalid or widening key never reaches `effective`; it is a finding instead.
 * `findings` are { level: 'fail', text } — every problem here is a failure: a block that could
 * widen silently would make the rung a suggestion.
 */
function evaluateRelease(cfg) {
  const c = cfg || {};
  const derived = deriveDefault(c);
  const effective = { candidates: derived.candidates, testPeriodDays: derived.testPeriodDays, final: derived.final };
  const findings = [];
  const fail = (text) => findings.push({ level: 'fail', text });
  const raw = Object.prototype.hasOwnProperty.call(c, 'release') ? c.release : undefined;

  // Absent, or an empty `release:` with nothing under it — both mean the default.
  if (raw === undefined || raw === null) return { declared: null, derived, effective, findings };

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`release is ${JSON.stringify(raw)}, expected a block of candidates / test-period / final (omit it for the default ${derived.axis} derives)`);
    return { declared: raw, derived, effective, findings };
  }

  const rung = 'CONVENTIONS.md §6, The release rung';
  const widen = (key, value, text) => fail(
    `release.${key}: ${value} widens the release rung — on ${derived.axis} ${text} (${rung}). ` +
    'The release: block may narrow its default, never widen it',
  );

  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) fail(`release.${key} is not a release: key — expected one of: ${KEYS.join(', ')}`);
  }

  if ('candidates' in raw) {
    const v = raw.candidates;
    if (!CANDIDATES.includes(v)) fail(`release.candidates is ${JSON.stringify(v)}, expected "auto" or "off"`);
    else if (v === 'auto' && derived.candidates === 'off') widen('candidates', v, `${derived.why}. Remove the key or set candidates: off`);
    else effective.candidates = v;
  }

  if ('final' in raw) {
    const v = raw.final;
    if (!FINAL.includes(v)) fail(`release.final is ${JSON.stringify(v)}, expected "auto" or "human"`);
    else if (v === 'auto' && derived.final === 'human') widen('final', v, `${derived.why}. Remove the key or set final: human`);
    else effective.final = v;
  }

  if ('test-period' in raw) {
    const v = raw['test-period'];
    const days = parseTestPeriod(v);
    if (days === null) fail(`release.test-period is ${JSON.stringify(v)}, expected a whole number of days like "${TEST_PERIOD_DAYS}d"`);
    else if (days < derived.testPeriodDays) {
      widen('test-period', v, `the test period is ${derived.testPeriodDays}d, and a shorter one finalizes a candidate before the rung's own window has passed. Set ${derived.testPeriodDays}d or longer`);
    } else effective.testPeriodDays = days;
  }

  return { declared: raw, derived, effective, findings };
}

module.exports = { KEYS, CANDIDATES, FINAL, TEST_PERIOD_DAYS, deriveDefault, evaluateRelease, parseTestPeriod };
