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
 *     route: public-tool      # none | rapid-app | public-tool | library-fast | deploy-tag | deploy-tag-fast | live
 *     candidates: auto        # auto | off
 *     candidates-per-day: 1   # positive integer — an opt-in cap; no route has one by default (#443)
 *     test-period: 3d         # <N>d, never below the route's 3 days
 *     final: auto             # auto | human
 *     guard-run: <command>    # #422 — a breaking-change detector `release cut --auto` runs
 *     guard-result: <path>    # #422 — or the file an earlier CI step wrote its result to
 *     exports: <path>         # #422 — a committed list of public symbols, one per line
 *     npm: <dir>              # #433 — publish this package directory to npm from release-auto.yml
 *     npm-gate: <command>     # #433 — the pack-allowlist gate, run before every npm publish
 *     version-source: tag     # #438 — tag | manifest: is a manifest's version checked, or derivable?
 *     final-grant: 123        # #441 — an operator's recorded decision letting deploy-tag's final be automatic
 *     health-url: https://…   # #446/#452 — deploy-tag or deploy-tag-fast (required there): the public endpoint reporting the running version
 *     rollback: auto          # #446 — deploy-tag-fast only: the deploy rolls itself back when that check fails
 *     final-spacing: 1h       # #446 — deploy-tag-fast only: minimum time between finals (<N>h | <N>d, ≥ 1h)
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

const KEYS = Object.freeze(['route', 'candidates', 'candidates-per-day', 'test-period', 'final', 'guard-run', 'guard-result', 'exports', 'npm', 'npm-gate', 'version-source', 'final-grant', 'health-url', 'rollback', 'final-spacing']);
// #438: where the version a tag names comes from. `manifest` (the default) — every declared manifest
// (VERSION, package.json, Cargo.toml, pyproject.toml) must already equal the tag, so a human bumps it
// on trunk first. `tag` — the tag is the version and the manifests are DERIVABLE: the pre-tag check
// skips them, and the repo's own release/deploy step stamps the number from the tag (on a deploy-only
// ref or at build time — never a commit on trunk). Neither widens nor narrows a route: it decides
// which file is the source of a number, never whether a tag is cut.
const VERSION_SOURCES = Object.freeze(['manifest', 'tag']);
// #441: the one route whose final may become automatic by an operator's grant, and the row it must
// sit on — `deploy: tag` only. `deploy: manual` stays human: a person runs that deploy anyway.
const GRANTABLE_ROUTE = 'deploy-tag';
const GRANTABLE_ROW = 'released-tag';
// #446: the route that cuts a FINAL on every green trunk head — no candidate, no test period — and
// deploys it in the same run. It exists only on deploy: tag, only with the operator's recorded grant
// (the #441 reader, unchanged), and only where the repo declares a health-gated deploy that rolls
// itself back: those two declarations stand in for the test period it does not have. Its own keys —
// `health-url`, `rollback`, `final-spacing` — fit this route alone.
const FAST_ROUTE = 'deploy-tag-fast';
const GRANTABLE_ROUTES = Object.freeze([GRANTABLE_ROUTE, FAST_ROUTE]);
const FAST_KEYS = Object.freeze(['health-url', 'rollback', 'final-spacing']);
// #452: `health-url` is the one verify key every deploy shares — #446's health gate and the container
// deploy template's verify step (templates/deploy-container.yml) read the same line. It is legal on
// both deploying-tag routes and required only on the fast one; `rollback` and `final-spacing` stay
// the fast route's alone.
const FAST_ONLY_KEYS = Object.freeze(['rollback', 'final-spacing']);
const HEALTH_URL_ROUTES = Object.freeze([GRANTABLE_ROUTE, FAST_ROUTE]);
const ROLLBACK = Object.freeze(['auto']);
// The minimum spacing between two finals on deploy-tag-fast: both the default and the floor. A burst
// of merges then deploys at most once an hour; a repo may lengthen it, never shorten it.
const FINAL_SPACING_HOURS = 1;
// #433: the npm opt-in. `npm` names the package directory release-auto.yml publishes (`.` for the
// root); `npm-gate` the command that proves the tarball holds only what was meant to ship. They are
// a pair — a publish with no gate is the stray-local-file leak the gate exists to stop — and they
// fit only the public-tool route: an app's tag deploys, and a private repo never publishes to
// public npm (#432; the workflow refuses that case itself, since visibility is not in this file).
const NPM_KEYS = Object.freeze(['npm', 'npm-gate']);
const NPM_ROUTES = Object.freeze(['public-tool']);
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
 *   candidatesPerDay  number | null    — the cap on automatic candidates per day (null = uncapped).
 *                                        Null on every route since #443: the newest candidate always
 *                                        names trunk's head, so a cap is only ever a repo's own narrowing
 *   testPeriodDays    number | null    — a candidate's test period (null = the route has none)
 *   final             'auto' | 'human' — is the final vX.Y.Z automatic?
 *   finalize          how a final is reached: 'none' (no tags), 'after-test-period' (each clean
 *                     candidate on its own clock), 'newest-clean' (the newest candidate clean for
 *                     the period; a newer candidate does not restart an older one's clock),
 *                     'on-tag' (the tag itself triggers the publish; no candidate), 'human-click',
 *                     'on-green-head' (#446: `release cut --auto` tags the final itself; no candidate).
 */
const ROUTE_POLICY = Object.freeze({
  'none': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'none', why: 'nothing consumes a tag here, so no tags are cut' }),
  'rapid-app': Object.freeze({ candidates: 'auto', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'auto', finalize: 'newest-clean', why: 'a fast-moving app with few installers: every green trunk head gets a candidate, and the newest clean candidate finalizes automatically' }),
  'public-tool': Object.freeze({ candidates: 'auto', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'auto', finalize: 'after-test-period', why: 'adopters install it and nothing deploys: every green trunk head gets a candidate, and the final tag is automatic after a clean test period' }),
  'library-fast': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: null, final: 'auto', finalize: 'on-tag', why: 'a library released per merge and pinned by its consumers: no candidates, the tag triggers the publish and the route\'s checks still apply' }),
  'deploy-tag': Object.freeze({ candidates: 'auto', candidatesPerDay: null, testPeriodDays: TEST_PERIOD_DAYS, final: 'human', finalize: 'human-click', why: 'the tag deploys production, so the final tag is a human act' }),
  'deploy-tag-fast': Object.freeze({ candidates: 'off', candidatesPerDay: null, testPeriodDays: null, final: 'auto', finalize: 'on-green-head', why: 'the operator granted a final on every green trunk head, deployed in the same run behind a health-gated deploy that rolls itself back' }),
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
  'released-tag': Object.freeze(['deploy-tag', 'deploy-tag-fast', 'none']),
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
  return p ? { route, candidates: p.candidates, candidatesPerDay: p.candidatesPerDay, testPeriodDays: p.testPeriodDays, final: p.final, finalize: p.finalize, npm: null, versionSource: 'manifest', finalGrant: null, healthGate: null, healthUrl: null, finalSpacingHours: null } : null;
}

/** `6h` -> 6, `2d` -> 48; anything else (including `30m`, `0h`) -> null. */
function parseSpacing(v) {
  const m = typeof v === 'string' ? /^([0-9]+)([hd])$/.exec(v.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 10) * (m[2] === 'd' ? 24 : 1);
  return n > 0 ? n : null;
}

/** A health URL is an absolute https:// URL with a host. */
function validHealthUrl(v) {
  if (typeof v !== 'string' || !/^https:\/\/[^\s/]+/.test(v.trim())) return false;
  try { return new URL(v.trim()).protocol === 'https:'; } catch { return false; }
}

/**
 * #446: what a declared `deploy-tag-fast` still lacks — the operator's grant, the health URL, the
 * rollback declaration. Empty array = all three present (shape only; the grant's tracker state is
 * finalGrantVerdict's).
 */
function fastRoutePrerequisites(raw) {
  const r = raw || {};
  const missing = [];
  if (parseGrantIssue(r['final-grant']) === null) missing.push("release.final-grant: <N> — the operator's recorded decision (colab decision <N> --record --ruled-by <human>)");
  if (!validHealthUrl(r['health-url'])) missing.push('release.health-url: https://… — the public endpoint that reports the running version');
  if (!ROLLBACK.includes(r.rollback)) missing.push('release.rollback: auto — the deploy rolls itself back when the health check fails');
  return missing;
}

function parseTestPeriod(v) {
  const m = typeof v === 'string' ? /^([0-9]+)d$/.exec(v.trim()) : null;
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Validate the declared `release:` block against the derived default.
 * Returns { declared, derived, effective, findings } — `declared` is the raw block (null when
 * absent), `effective` is what a tool acts on: { route, candidates, candidatesPerDay,
 * testPeriodDays, final, finalize, npm } — the declared route when its row permits it, else the
 * derived one, narrowed by every VALID declared key. An invalid or widening key never reaches
 * `effective`; it is a finding instead. `findings` are { level: 'fail', text } — every problem
 * here is a failure: a block that could widen silently would make the routes a suggestion.
 * `effective.npm` is `{ dir, gate }` only when the npm pair is declared, valid, and on a route that
 * may publish (#433) — anything short of that is null, so the workflow publishes nothing.
 */
function evaluateRelease(cfg) {
  const c = cfg || {};
  const derived = deriveDefault(c);
  const fromDerived = () => ({
    route: derived.route, candidates: derived.candidates, candidatesPerDay: derived.candidatesPerDay,
    testPeriodDays: derived.testPeriodDays, final: derived.final, finalize: derived.finalize, npm: null,
    versionSource: 'manifest', finalGrant: null, healthGate: null, healthUrl: null, finalSpacingHours: null,
  });
  let effective = fromDerived();
  const findings = [];
  const fail = (text) => findings.push({ level: 'fail', text });
  const raw = Object.prototype.hasOwnProperty.call(c, 'release') ? c.release : undefined;

  // Absent, or an empty `release:` with nothing under it — both mean the default.
  if (raw === undefined || raw === null) return { declared: null, derived, effective, findings };

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`release is ${JSON.stringify(raw)}, expected a block of ${KEYS.join(' / ')} (omit it for the default ${derived.axis} derives)`);
    return { declared: raw, derived, effective, findings };
  }

  const routes = 'CONVENTIONS.md §6, Release routes';
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) fail(`release.${key} is not a release: key — expected one of: ${KEYS.join(', ')}`);
  }

  for (const key of INPUT_KEYS) {
    if (key in raw && (typeof raw[key] !== 'string' || !raw[key].trim())) fail(`release.${key} is ${JSON.stringify(raw[key])}, expected a non-empty string`);
  }
  for (const key of NPM_KEYS) {
    if (key in raw && (typeof raw[key] !== 'string' || !raw[key].trim())) fail(`release.${key} is ${JSON.stringify(raw[key])}, expected a non-empty string`);
  }
  if (typeof raw.npm === 'string' && raw.npm.trim()) {
    const dir = raw.npm.trim();
    if (dir.startsWith('/') || dir.split('/').includes('..')) fail(`release.npm is ${JSON.stringify(raw.npm)}, expected a directory inside the repo (\`.\` for the root)`);
  }
  if (('npm' in raw) !== ('npm-gate' in raw)) {
    fail('npm' in raw
      ? 'release.npm is declared without release.npm-gate — every npm publish runs a pack-allowlist gate first, so declare the command that proves the tarball holds only what was meant to ship'
      : 'release.npm-gate is declared without release.npm — there is no package to gate; declare the package directory or remove the key');
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
    } else if (v === FAST_ROUTE && fastRoutePrerequisites(raw).length) {
      // Fail closed: without its grant and its health gate the fast route would be an automatic,
      // untested deploy nobody chose. The derived route (deploy-tag, human final) stays in effect.
      fail(`release.route: ${FAST_ROUTE} needs the operator's grant and a declared health-gated deploy before it may stand — missing: ` +
        `${fastRoutePrerequisites(raw).join('; ')} (${routes}). Until then the final stays a human act on route ${derived.route}`);
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

  // #441: the operator's grant. Read before `final`, because only a valid grant lets `final: auto`
  // stand on deploy-tag. Its VALIDITY here is shape and place only — that the decision it names is
  // recorded, by a human, and not reopened is a tracker fact: the audit and `colab release finalize`
  // resolve it (finalGrantVerdict), never this pure reading.
  let grant = null;
  if ('final-grant' in raw) {
    const n = parseGrantIssue(raw['final-grant']);
    if (n === null) fail(`release.final-grant is ${JSON.stringify(raw['final-grant'])}, expected the number of the decision issue that records the operator's ruling (e.g. 123 or "#123")`);
    else if (effective.route === FAST_ROUTE) {
      // #446: the route itself is the automatic final, so the grant takes effect from this line alone.
      grant = { issue: n };
      effective.finalGrant = grant;
    } else if (raw.route === FAST_ROUTE) {
      // The route was refused above; its grant line is not a second finding.
    } else if (effective.route !== GRANTABLE_ROUTE || derived.row !== GRANTABLE_ROW) {
      fail(`release.final-grant fits only route ${GRANTABLE_ROUTE} on deploy: tag (or ${FAST_ROUTE}) — ${route} on ${derived.axis} is not that (${routes}). ` +
        (derived.row === 'released-manual' ? 'On deploy: manual a person runs the deploy anyway, so its final stays human' : 'Its final is not a deploying human act, so there is nothing to grant'));
    } else grant = { issue: n };
  }

  if ('final' in raw) {
    const v = raw.final;
    if (!FINAL.includes(v)) fail(`release.final is ${JSON.stringify(v)}, expected "auto" or "human"`);
    else if (effective.route === FAST_ROUTE) {
      if (v === 'human') fail(`release.final: human on route ${FAST_ROUTE} — that route has no candidate for a human to finalize; use route deploy-tag for a human final`);
    } else if (v === 'auto' && effective.final === 'human' && grant) {
      // #441: an automatic final that deploys production — permitted only by the recorded grant.
      effective.final = 'auto';
      effective.finalize = 'after-test-period';
      effective.finalGrant = grant;
    } else if (v === 'auto' && effective.final === 'human') {
      widen('final', v, `${why}. Remove the key or set final: human` +
        (effective.route === GRANTABLE_ROUTE && derived.row === GRANTABLE_ROW
          ? ' — or, if the operator chose an automatic final for this repo, record it (colab decision <N> --record --ruled-by <human>) and name it in release.final-grant: <N>'
          : ''));
    } else {
      if (v === 'human' && effective.final === 'auto') effective.finalize = effective.finalize === 'on-tag' ? 'on-tag' : 'human-click';
      effective.final = v;
    }
  }

  if ('test-period' in raw) {
    const v = raw['test-period'];
    const days = parseTestPeriod(v);
    if (days === null) fail(`release.test-period is ${JSON.stringify(v)}, expected a whole number of days like "${TEST_PERIOD_DAYS}d"`);
    else if (effective.testPeriodDays === null) fail(`release.test-period: ${v} has no period to set — ${route} cuts no candidate, so there is no test period. Remove the key`);
    else if (days < effective.testPeriodDays) {
      widen('test-period', v, `the test period is ${effective.testPeriodDays}d, and a shorter one finalizes a candidate before the route's own window has passed. Set ${effective.testPeriodDays}d or longer`);
    } else effective.testPeriodDays = days;
  }

  // #438: where the tag's version comes from.
  if ('version-source' in raw) {
    const v = raw['version-source'];
    if (!VERSION_SOURCES.includes(v)) fail(`release.version-source is ${JSON.stringify(v)}, expected "tag" or "manifest"`);
    else effective.versionSource = v;
  }

  // #446: the fast route's own keys — only there, and the floor on spacing. #452: `health-url` is
  // shared with deploy-tag, where it is optional and only names the version a deploy waits for.
  const fastKeys = FAST_ONLY_KEYS.filter((k) => k in raw);
  if ('health-url' in raw && effective.route === GRANTABLE_ROUTE) {
    if (!validHealthUrl(raw['health-url'])) fail(`release.health-url is ${JSON.stringify(raw['health-url'])}, expected an absolute https:// URL that reports the running version`);
    else effective.healthUrl = raw['health-url'].trim();
  } else if ('health-url' in raw && effective.route !== FAST_ROUTE && raw.route !== FAST_ROUTE) {
    fail(`release.health-url fits only route ${HEALTH_URL_ROUTES.join(' or ')} — ${route} on ${derived.axis} is not that (${routes}). ` +
      'Nothing deploys from a tag here, so there is no running version to check. Remove the key');
  }
  if (effective.route === FAST_ROUTE) {
    effective.healthGate = { url: raw['health-url'].trim(), rollback: raw.rollback };
    effective.healthUrl = raw['health-url'].trim();
    effective.finalSpacingHours = FINAL_SPACING_HOURS;
    if ('final-spacing' in raw) {
      const h = parseSpacing(raw['final-spacing']);
      if (h === null) fail(`release.final-spacing is ${JSON.stringify(raw['final-spacing'])}, expected hours or days like "${FINAL_SPACING_HOURS}h" or "1d"`);
      else if (h < FINAL_SPACING_HOURS) widen('final-spacing', raw['final-spacing'], `finals are at least ${FINAL_SPACING_HOURS}h apart. Set ${FINAL_SPACING_HOURS}h or longer`);
      else effective.finalSpacingHours = h;
    }
  } else if (fastKeys.length && raw.route !== FAST_ROUTE) {
    fail(`release.${fastKeys.join(' / release.')} fits only route ${FAST_ROUTE} — ${route} on ${derived.axis} is not that (${routes}). Remove the key${fastKeys.length > 1 ? 's' : ''}`);
  }

  // 3. npm (#433) — only on a route where a tag publishes to adopters and deploys nothing.
  effective.npm = null;
  if ('npm' in raw || 'npm-gate' in raw) {
    if (!NPM_ROUTES.includes(effective.route)) {
      fail(`release.npm publishes to npm, which fits only route ${NPM_ROUTES.join(' / ')} — ${route} is not one (${routes}). ` +
        'A tag that deploys an app is not a package release; remove the npm keys');
    }
    if (!findings.some((f) => f.text.startsWith('release.npm'))) effective.npm = { dir: raw.npm.trim().replace(/\/+$/, '') || '.', gate: raw['npm-gate'].trim() };
  }

  return { declared: raw, derived, effective, findings };
}

/** `123`, `"123"` or `"#123"` -> 123; anything else -> null. */
function parseGrantIssue(v) {
  if (Number.isInteger(v) && v > 0) return v;
  const m = typeof v === 'string' ? /^#?([1-9][0-9]*)$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : null;
}

/**
 * #441: does the decision issue a `release.final-grant` names still carry the operator's ruling?
 * `record` is `gh issue view <N> --json state,labels,comments` (null = the read failed — never a
 * grant). Valid only when the issue carries the `decision-recorded` label (applying it needs write
 * permission) AND a live, trusted `⚖ Decision recorded` comment — one not superseded by a later
 * `↩ Decision reopened` (decision-record.js, the same reading every decision consumer uses). A
 * reopened decision revokes the grant at once. `trust` is trust-humans.js parseTrustHumans() of the
 * repo's project.yml, or absent. Returns { ok, ruledBy, detail }.
 */
function finalGrantVerdict(record, { issue, trust } = {}) {
  const decisionRecord = require('./decision-record.js');
  const ref = `release.final-grant #${issue}`;
  if (!record) return { ok: false, ruledBy: null, detail: `${ref} could not be read from the tracker — an unread grant is not a grant` };
  const labels = (record.labels || []).map((l) => (l && typeof l === 'object' ? l.name : l));
  const all = decisionRecord.liveDecisions(record.comments);
  const live = decisionRecord.trustedDecisions(record.comments, trust);
  const reopened = (record.comments || []).some((c) => decisionRecord.REOPEN_RE.test(String((c && c.body) || '').trim()));
  if (!live.length) {
    const why = reopened && !all.length ? 'its decision was reopened'
      : all.length ? 'its decision was not recorded by a trusted human'
        : 'it carries no recorded decision (colab decision --record)';
    return { ok: false, ruledBy: null, detail: `${ref} does not grant an automatic final: ${why}. The final tag stays a human act until a human records the ruling again` };
  }
  if (!labels.includes('decision-recorded')) {
    return { ok: false, ruledBy: null, detail: `${ref} has a decision comment but no \`decision-recorded\` label — an interrupted record is not a grant` };
  }
  const d = live[live.length - 1];
  return { ok: true, ruledBy: d.ruledBy, detail: `${ref}: decision recorded, ruled by ${d.ruledBy} (${d.at})` };
}

module.exports = {
  VERSION_SOURCES, GRANTABLE_ROUTE, GRANTABLE_ROW, GRANTABLE_ROUTES, FAST_ROUTE, FAST_KEYS, FAST_ONLY_KEYS, HEALTH_URL_ROUTES, ROLLBACK, FINAL_SPACING_HOURS,
  parseGrantIssue, finalGrantVerdict, parseSpacing, validHealthUrl, fastRoutePrerequisites,
  KEYS, INPUT_KEYS, NPM_KEYS, NPM_ROUTES, CANDIDATES, FINAL, TEST_PERIOD_DAYS, ROUTES, ROUTE_POLICY, ROW_ROUTES,
  deriveDefault, evaluateRelease, parseTestPeriod, routePolicy,
};
