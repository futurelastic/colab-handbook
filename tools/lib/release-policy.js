'use strict';
/**
 * tools/lib/release-policy.js — the `release:` block of `.github/project.yml` (#337, #421).
 *
 * CONVENTIONS.md §6's release routes (#420, superseding the #330 rung) decide, from `exposure` +
 * `deploy`, whether candidate tags are cut automatically and whether a candidate's final tag is
 * automatic. This module is the one executable version of that table, plus the block a repo may
 * declare to CHOOSE a route its row permits and to NARROW it:
 *
 *   release:
 *     route: public-tool      # none | rapid-app | public-tool | library-fast | deploy-tag | live
 *     candidates: auto        # auto | off
 *     candidates-per-day: 1   # positive integer, never above the route's own cap
 *     test-period: 3d         # <N>d, never below the route's 3 days
 *     final: auto             # auto | human
 *     guard-run: <command>    # #422 — a breaking-change detector `release cut --auto` runs
 *     guard-result: <path>    # #422 — or the file an earlier CI step wrote its result to
 *     exports: <path>         # #422 — a committed list of public symbols, one per line
 *
 * Two layers. The descriptor's ROW (exposure + deploy + production) is a fact about the repo; the
 * ROUTE is how releases run on it. A row permits a fixed set of routes (ROW_ROUTES) and derives one
 * when `route:` is absent. A declared route outside its row's set — `public-tool` on a repo whose
 * tag deploys production, `deploy-tag` on one where nothing deploys — is a FAILURE: the route would
 * misdescribe the repo, and on a deploying tag would hand its final to a machine.
 *
 * The narrowing keys may narrow the route, never widen it. `final: auto` where the route says
 * human, `candidates: auto` where it cuts none, a test period shorter than the route's and more
 * candidates per day than its cap are validation FAILURES, not overrides — "nothing in project.yml
 * lowers that" (§6) is enforced here, not promised.
 *
 * Shared by `audit/audit.mjs` (ESM, through createRequire — the exposure-shape.js precedent) and,
 * later, `colab release cut` (#338). One reading of the rung, not two: a CLI that cut a tag the
 * audit would have called a widening is exactly the two-places drift this repo exists to kill.
 *
 * Fail closed: anything the routes table does not name (undeclared or unknown exposure, a bare
 * legacy `tier: B`, a `released` repo whose deploy/production match no row) derives no route,
 * `candidates: off` + `final: human`, and permits only `route: none` — so no declaration can
 * widen it into automatic tagging.
 */

const axisAuthority = require('./axis-authority.js');

const KEYS = Object.freeze(['route', 'candidates', 'candidates-per-day', 'test-period', 'final', 'guard-run', 'guard-result', 'exports']);
// #422: the bump inputs `release cut --auto` reads. Not a narrowing or a widening — they add evidence
// to the computed number, never permission — so they only have to be non-empty strings. One of
// guard-run / guard-result, never both: two detectors answering one question is two readings.
const INPUT_KEYS = Object.freeze(['guard-run', 'guard-result', 'exports']);
const CANDIDATES = Object.freeze(['auto', 'off']);
const FINAL = Object.freeze(['auto', 'human']);
// The routes' own test period (CONVENTIONS.md §6: "The test period is 3 days"). A floor, not a
// suggestion: a declared period may be longer, never shorter.
const TEST_PERIOD_DAYS = 3;

/**
 * Each route's own policy — CONVENTIONS.md §6, *Release routes*, row for row.
 *   candidates        'auto' | 'off'   — are candidate tags vX.Y.Z-rc.N cut automatically?
 *   candidatesPerDay  number | null    — the cap on automatic candidates per day (null = uncapped)
 *   testPeriodDays    number | null    — a candidate's test period (null = the route has none)
 *   final             'auto' | 'human' — is the final vX.Y.Z automatic?
 *   finalize          how a final is reached: 'none' (no tags), 'after-test-period' (each clean
 *                     candidate on its own clock), 'newest-clean' (the newest candidate clean for
 *                     the period; a newer candidate does not restart an older one's clock),
 *                     'on-tag' (the tag itself triggers the publish; no candidate), 'human-click'.
 */
const ROUTE_POLICY = Object.freeze({
  'none': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'none', why: 'nothing consumes a tag here, so no tags are cut' }),
  'rapid-app': Object.freeze({ candidates: 'auto', candidatesPerDay: 1, testPeriodDays: TEST_PERIOD_DAYS, final: 'auto', finalize: 'newest-clean', why: 'a fast-moving app with few installers: at most one candidate a day, and the newest clean candidate finalizes automatically' }),
  'public-tool': Object.freeze({ candidates: 'auto', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'auto', finalize: 'after-test-period', why: 'adopters install it and nothing deploys, so the final tag is automatic after a clean test period' }),
  'library-fast': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: null, final: 'auto', finalize: 'on-tag', why: 'a library released per merge and pinned by its consumers: no candidates, the tag triggers the publish and the route\'s checks still apply' }),
  'deploy-tag': Object.freeze({ candidates: 'auto', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'human-click', why: 'the tag deploys production, so the final tag is a human act' }),
  'live': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'none', why: 'the promotion is the deploy and stays human; no automatic tags' }),
});
const ROUTES = Object.freeze(Object.keys(ROUTE_POLICY));

/**
 * Which routes each descriptor row permits — the first is the one derived when `route:` is
 * absent. `none` is permitted everywhere: turning releases off is always a narrowing. An
 * `unmatched` row derives no route at all (fail closed) and permits only `none`.
 */
const ROW_ROUTES = Object.freeze({
  'no-tags': Object.freeze(['none']),
  'live': Object.freeze(['live', 'none']),
  'released-no-production': Object.freeze(['public-tool', 'rapid-app', 'library-fast', 'none']),
  'released-tag': Object.freeze(['deploy-tag', 'none']),
  'released-manual': Object.freeze(['deploy-tag', 'none']),
  'unmatched': Object.freeze(['none']),
});

/**
 * The rung row `cfg` (a parsed project.yml, possibly null) falls on, and the policy it derives.
 * Returns { row, route, axis, candidates, candidatesPerDay, testPeriodDays, final, finalize, why }
 * where `row` is one of 'no-tags' | 'live' | 'released-no-production' | 'released-tag' |
 * 'released-manual' | 'unmatched', `route` is the route that row derives (null on 'unmatched' —
 * fail closed), `axis` is a human label for the finding text, and `why` says what the row means.
 * The policy fields are the derived route's own; `deploy: manual` takes `deploy-tag` because a
 * person deploys from that tag — §6's one human gate covers both.
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
  const onRoute = (row, why) => {
    const route = ROW_ROUTES[row][0];
    const { why: _routeWhy, ...p } = ROUTE_POLICY[route];
    return { axis, row, route, ...p, why: why || ROUTE_POLICY[route].why };
  };

  if (exposure === 'none' || exposure === 'self') return onRoute('no-tags');
  if (exposure === 'live') return onRoute('live');
  if (exposure === 'released') {
    if (deploy === 'tag') return onRoute('released-tag');
    if (deploy === 'manual') return onRoute('released-manual', 'a person deploys from the tag, so the final tag is a human act');
    if (deploy === 'none' && production === null) return onRoute('released-no-production');
  }
  return {
    axis, row: 'unmatched', route: null,
    candidates: 'off', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'none',
    why: 'no release route names this descriptor, so it fails closed — a human tags',
  };
}

/** A route's policy as an effective-shaped object (no `why`). */
function routePolicy(route) {
  const p = ROUTE_POLICY[route];
  return p ? { route, candidates: p.candidates, candidatesPerDay: p.candidatesPerDay, testPeriodDays: p.testPeriodDays, final: p.final, finalize: p.finalize } : null;
}

function parseTestPeriod(v) {
  const m = typeof v === 'string' ? /^([0-9]+)d$/.exec(v.trim()) : null;
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Validate the declared `release:` block against the derived default.
 * Returns { declared, derived, effective, findings } — `declared` is the raw block (null when
 * absent), `effective` is what a tool acts on: { route, candidates, candidatesPerDay,
 * testPeriodDays, final, finalize } — the declared route when its row permits it, else the
 * derived one, narrowed by every VALID declared key. An invalid or widening key never reaches
 * `effective`; it is a finding instead. `findings` are { level: 'fail', text } — every problem
 * here is a failure: a block that could widen silently would make the routes a suggestion.
 */
function evaluateRelease(cfg) {
  const c = cfg || {};
  const derived = deriveDefault(c);
  const fromDerived = () => ({
    route: derived.route, candidates: derived.candidates, candidatesPerDay: derived.candidatesPerDay,
    testPeriodDays: derived.testPeriodDays, final: derived.final, finalize: derived.finalize,
  });
  let effective = fromDerived();
  const findings = [];
  const fail = (text) => findings.push({ level: 'fail', text });
  const raw = Object.prototype.hasOwnProperty.call(c, 'release') ? c.release : undefined;

  // Absent, or an empty `release:` with nothing under it — both mean the default.
  if (raw === undefined || raw === null) return { declared: null, derived, effective, findings };

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`release is ${JSON.stringify(raw)}, expected a block of route / candidates / candidates-per-day / test-period / final / guard-run / guard-result / exports (omit it for the default ${derived.axis} derives)`);
    return { declared: raw, derived, effective, findings };
  }

  const routes = 'CONVENTIONS.md §6, Release routes';
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) fail(`release.${key} is not a release: key — expected one of: ${KEYS.join(', ')}`);
  }

  for (const key of INPUT_KEYS) {
    if (key in raw && (typeof raw[key] !== 'string' || !raw[key].trim())) fail(`release.${key} is ${JSON.stringify(raw[key])}, expected a non-empty string`);
  }
  if ('guard-run' in raw && 'guard-result' in raw) fail('release.guard-run and release.guard-result are both declared — one detector answers whether the release breaks, so declare one');

  // 1. The route — chosen among the ones this descriptor's row permits.
  let why = derived.why;
  if ('route' in raw) {
    const v = raw.route;
    const allowed = ROW_ROUTES[derived.row];
    if (!ROUTES.includes(v)) fail(`release.route is ${JSON.stringify(v)}, expected one of: ${ROUTES.join(', ')}`);
    else if (!allowed.includes(v)) {
      fail(`release.route: ${v} does not fit ${derived.axis} — that descriptor permits ${allowed.join(' or ')} (${routes}). ` +
        'A route is chosen among the ones exposure + deploy permit; change those first if the repo really changed');
    } else {
      effective = routePolicy(v);
      why = ROUTE_POLICY[v].why;
    }
  }

  // 2. The narrowing keys — against the route now in effect.
  const route = effective.route === null ? 'no route (fail closed)' : `route ${effective.route}`;
  const widen = (key, value, text) => fail(
    `release.${key}: ${value} widens the release route — on ${derived.axis}, ${route}: ${text} (${routes}). ` +
    'The release: block may narrow its route, never widen it',
  );

  if ('candidates' in raw) {
    const v = raw.candidates;
    if (!CANDIDATES.includes(v)) fail(`release.candidates is ${JSON.stringify(v)}, expected "auto" or "off"`);
    else if (v === 'auto' && effective.candidates === 'off') widen('candidates', v, `${why}. Remove the key or set candidates: off`);
    else effective.candidates = v;
  }

  if ('candidates-per-day' in raw) {
    const v = raw['candidates-per-day'];
    const cap = effective.candidatesPerDay;
    if (!Number.isInteger(v) || v < 1) fail(`release.candidates-per-day is ${JSON.stringify(v)}, expected a positive whole number`);
    else if (effective.candidates === 'off') fail(`release.candidates-per-day: ${v} has nothing to cap — candidates are off on ${route}. Remove the key`);
    else if (cap !== null && v > cap) widen('candidates-per-day', v, `at most ${cap} a day. Set ${cap} or fewer`);
    else effective.candidatesPerDay = v;
  }

  if ('final' in raw) {
    const v = raw.final;
    if (!FINAL.includes(v)) fail(`release.final is ${JSON.stringify(v)}, expected "auto" or "human"`);
    else if (v === 'auto' && effective.final === 'human') widen('final', v, `${why}. Remove the key or set final: human`);
    else {
      if (v === 'human' && effective.final === 'auto') effective.finalize = effective.finalize === 'on-tag' ? 'on-tag' : 'human-click';
      effective.final = v;
    }
  }

  if ('test-period' in raw) {
    const v = raw['test-period'];
    const days = parseTestPeriod(v);
    if (days === null) fail(`release.test-period is ${JSON.stringify(v)}, expected a whole number of days like "${TEST_PERIOD_DAYS}d"`);
    else if (effective.testPeriodDays === null) fail(`release.test-period: ${v} has no period to set — ${route} finalizes on the tag itself, with no candidate. Remove the key`);
    else if (days < effective.testPeriodDays) {
      widen('test-period', v, `the test period is ${effective.testPeriodDays}d, and a shorter one finalizes a candidate before the route's own window has passed. Set ${effective.testPeriodDays}d or longer`);
    } else effective.testPeriodDays = days;
  }

  return { declared: raw, derived, effective, findings };
}

module.exports = {
  KEYS, INPUT_KEYS, CANDIDATES, FINAL, TEST_PERIOD_DAYS, ROUTES, ROUTE_POLICY, ROW_ROUTES,
  deriveDefault, evaluateRelease, parseTestPeriod, routePolicy,
};
