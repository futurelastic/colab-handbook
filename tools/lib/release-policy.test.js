'use strict';
/**
 * Tests for tools/lib/release-policy.js — the `release:` block (#337) and release routes (#421).
 *
 * Run: `node --test tools/lib/*.test.js`.
 *
 * Pinned here: the derivation table matches CONVENTIONS.md §6's release routes row for row — every
 * row derives a route — it fails closed on anything the table does not name, a declared route must
 * be one its row permits, and the narrowing keys narrow the route and never widen it. The audit-level fixtures (a real descriptor through audit.mjs) live in
 * audit-release-block.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveDefault, evaluateRelease, ROUTES, ROW_ROUTES, ROUTE_POLICY } = require('./release-policy.js');

const pick = (d) => ({ row: d.row, route: d.route, candidates: d.candidates, final: d.final, testPeriodDays: d.testPeriodDays });
const eff = (e) => ({ route: e.route, candidates: e.candidates, testPeriodDays: e.testPeriodDays, final: e.final });

// --- the derivation table, row for row --------------------------------------------------------

test('exposure: none and self cut no tags', () => {
  for (const exposure of ['none', 'self']) {
    assert.deepEqual(pick(deriveDefault({ exposure, deploy: 'none', production: null })),
      { row: 'no-tags', route: 'none', candidates: 'off', final: 'human', testPeriodDays: 3 });
  }
});

test('exposure: released, production null, deploy none — automatic candidates and final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'none', production: null })),
    { row: 'released-no-production', route: 'public-tool', candidates: 'auto', final: 'auto', testPeriodDays: 3 });
});

test('exposure: released, deploy: tag — automatic candidates, human final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'tag', production: 'https://x.example' })),
    { row: 'released-tag', route: 'deploy-tag', candidates: 'auto', final: 'human', testPeriodDays: 3 });
});

test('exposure: released, deploy: manual — automatic candidates, human final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'manual', production: 'https://x.example' })),
    { row: 'released-manual', route: 'deploy-tag', candidates: 'auto', final: 'human', testPeriodDays: 3 });
});

test('exposure: live — no automatic tags', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'live', deploy: 'push-main', production: 'https://x.example' })),
    { row: 'live', route: 'live', candidates: 'off', final: 'human', testPeriodDays: 3 });
});

test('legacy tier: A reads as released and takes the row its deploy names', () => {
  const d = deriveDefault({ tier: 'A', deploy: 'tag', production: 'https://x.example' });
  assert.equal(d.row, 'released-tag');
  assert.match(d.axis, /tier: A \(read as exposure: released\)/);
});

test('fails closed: bare tier: B, undeclared exposure, unknown exposure, released with no matching row', () => {
  const cases = [
    { tier: 'B', deploy: 'none', production: null },
    { deploy: 'none', production: null },
    { exposure: 'bogus', deploy: 'none', production: null },
    { exposure: 'released', deploy: 'push-main', production: 'https://x.example' },
    { exposure: 'released', deploy: 'none', production: 'https://x.example' },
  ];
  for (const cfg of cases) {
    assert.deepEqual(pick(deriveDefault(cfg)), { row: 'unmatched', route: null, candidates: 'off', final: 'human', testPeriodDays: 3 }, JSON.stringify(cfg));
  }
});

// --- absent block = the default ---------------------------------------------------------------

test('no release key: effective policy is the derived default, no findings', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'none', production: null });
  assert.equal(r.declared, null);
  assert.deepEqual(eff(r.effective), { route: 'public-tool', candidates: 'auto', testPeriodDays: 3, final: 'auto' });
  assert.deepEqual(r.findings, []);
});

test('an empty release: (null) reads as absent', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://x.example', release: null });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(eff(r.effective), { route: 'deploy-tag', candidates: 'auto', testPeriodDays: 3, final: 'human' });
});

// --- narrowing is allowed ---------------------------------------------------------------------

test('narrowing on a no-production released repo: final: human, candidates: off, a longer test period', () => {
  const r = evaluateRelease({
    exposure: 'released', deploy: 'none', production: null,
    release: { candidates: 'off', 'test-period': '7d', final: 'human' },
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(eff(r.effective), { route: 'public-tool', candidates: 'off', testPeriodDays: 7, final: 'human' });
});

test('restating the default is clean', () => {
  const r = evaluateRelease({
    exposure: 'released', deploy: 'none', production: null,
    release: { candidates: 'auto', 'test-period': '3d', final: 'auto' },
  });
  assert.deepEqual(r.findings, []);
});

// --- widening fails ---------------------------------------------------------------------------

test('final: auto on deploy: tag is a failure, and the effective final stays human', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://x.example', release: { final: 'auto' } });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].level, 'fail');
  assert.match(r.findings[0].text, /release\.final: auto widens the release route.*deploy|tag deploys production/);
  assert.equal(r.effective.final, 'human');
});

test('final: auto on deploy: manual is a failure', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'manual', production: 'https://x.example', release: { final: 'auto' } });
  assert.match(r.findings.map((f) => f.text).join('|'), /release\.final: auto widens/);
});

test('candidates: auto on exposure: self / none is a failure', () => {
  for (const exposure of ['self', 'none']) {
    const r = evaluateRelease({ exposure, deploy: 'none', production: null, release: { candidates: 'auto' } });
    assert.match(r.findings.map((f) => f.text).join('|'), new RegExp(`release\\.candidates: auto widens the release route — on exposure: ${exposure}`));
    assert.equal(r.effective.candidates, 'off');
  }
});

test('candidates: auto on exposure: live and on an unmatched descriptor is a failure', () => {
  for (const cfg of [
    { exposure: 'live', deploy: 'push-main', production: 'https://x.example' },
    { tier: 'B', deploy: 'none', production: null },
  ]) {
    const r = evaluateRelease({ ...cfg, release: { candidates: 'auto' } });
    assert.match(r.findings.map((f) => f.text).join('|'), /release\.candidates: auto widens/, JSON.stringify(cfg));
  }
});

test('a test period shorter than 3d is a failure', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'none', production: null, release: { 'test-period': '1d' } });
  assert.match(r.findings.map((f) => f.text).join('|'), /release\.test-period: 1d widens the release route/);
  assert.equal(r.effective.testPeriodDays, 3);
});

// --- shape ------------------------------------------------------------------------------------

test('a scalar release value, unknown sub-keys and bad values are failures', () => {
  const base = { exposure: 'released', deploy: 'none', production: null };
  const texts = (release) => evaluateRelease({ ...base, release }).findings.map((f) => f.text).join('|');
  assert.match(texts('auto'), /release is "auto", expected a block/);
  assert.match(texts({ major: 'auto' }), /release\.major is not a release: key/);
  assert.match(texts({ candidates: 'yes' }), /release\.candidates is "yes", expected "auto" or "off"/);
  assert.match(texts({ final: true }), /release\.final is true, expected "auto" or "human"/);
  assert.match(texts({ 'test-period': '72h' }), /release\.test-period is "72h", expected a whole number of days/);
  assert.match(texts({ 'test-period': 3 }), /release\.test-period is 3, expected a whole number of days/);
});

// --- routes (#421) ----------------------------------------------------------------------------

test('every descriptor row derives a route its row permits, and the route\'s own policy', () => {
  const rows = [
    [{ exposure: 'none', deploy: 'none', production: null }, 'none'],
    [{ exposure: 'self', deploy: 'none', production: null }, 'none'],
    [{ exposure: 'released', deploy: 'none', production: null }, 'public-tool'],
    [{ exposure: 'released', deploy: 'tag', production: 'https://x.example' }, 'deploy-tag'],
    [{ exposure: 'released', deploy: 'manual', production: 'https://x.example' }, 'deploy-tag'],
    [{ exposure: 'live', deploy: 'push-main', production: 'https://x.example' }, 'live'],
    [{ tier: 'A', deploy: 'tag', production: 'https://x.example' }, 'deploy-tag'],
    [{ tier: 'C', deploy: 'push-main', production: 'https://x.example' }, 'live'],
  ];
  for (const [cfg, route] of rows) {
    const d = deriveDefault(cfg);
    assert.equal(d.route, route, JSON.stringify(cfg));
    assert.ok(ROW_ROUTES[d.row].includes(route), `${d.row} permits ${route}`);
    for (const k of ['candidates', 'candidatesPerDay', 'testPeriodDays', 'final', 'finalize']) {
      assert.equal(d[k], ROUTE_POLICY[route][k], `${route}.${k}`);
    }
  }
});

test('the routes table: six routes, the human final only where a tag deploys or nothing is tagged', () => {
  assert.deepEqual([...ROUTES], ['none', 'rapid-app', 'public-tool', 'library-fast', 'deploy-tag', 'live']);
  assert.deepEqual(eff({ route: 'rapid-app', ...ROUTE_POLICY['rapid-app'] }), { route: 'rapid-app', candidates: 'auto', testPeriodDays: 3, final: 'auto' });
  assert.equal(ROUTE_POLICY['rapid-app'].candidatesPerDay, 1);
  assert.equal(ROUTE_POLICY['rapid-app'].finalize, 'newest-clean');
  assert.equal(ROUTE_POLICY['public-tool'].finalize, 'after-test-period');
  assert.deepEqual([ROUTE_POLICY['library-fast'].candidates, ROUTE_POLICY['library-fast'].testPeriodDays, ROUTE_POLICY['library-fast'].final], ['off', null, 'auto']);
  assert.deepEqual([ROUTE_POLICY['deploy-tag'].candidates, ROUTE_POLICY['deploy-tag'].final], ['auto', 'human']);
  for (const r of ['none', 'live']) assert.deepEqual([ROUTE_POLICY[r].candidates, ROUTE_POLICY[r].final], ['off', 'human']);
});

test('no route ever finalizes automatically where the tag deploys production', () => {
  for (const deploy of ['tag', 'manual']) {
    for (const route of ROW_ROUTES[`released-${deploy}`]) assert.equal(ROUTE_POLICY[route].final, 'human', `${deploy}/${route}`);
  }
});

test('unmatched descriptors derive no route and permit only none', () => {
  const cfg = { tier: 'B', deploy: 'none', production: null };
  assert.equal(deriveDefault(cfg).route, null);
  for (const route of ROUTES.filter((r) => r !== 'none')) {
    const r = evaluateRelease({ ...cfg, release: { route } });
    assert.match(r.findings.map((f) => f.text).join('|'), new RegExp(`release\\.route: ${route} does not fit`), route);
    assert.equal(r.effective.route, null);
    assert.equal(r.effective.candidates, 'off');
  }
  assert.deepEqual(evaluateRelease({ ...cfg, release: { route: 'none' } }).findings, []);
});

test('a no-production released repo may choose rapid-app or library-fast', () => {
  const base = { exposure: 'released', deploy: 'none', production: null };
  const rapid = evaluateRelease({ ...base, release: { route: 'rapid-app' } });
  assert.deepEqual(rapid.findings, []);
  assert.equal(rapid.effective.route, 'rapid-app');
  assert.equal(rapid.effective.candidatesPerDay, 1);
  assert.equal(rapid.effective.finalize, 'newest-clean');
  const lib = evaluateRelease({ ...base, release: { route: 'library-fast' } });
  assert.deepEqual(lib.findings, []);
  assert.deepEqual(eff(lib.effective), { route: 'library-fast', candidates: 'off', testPeriodDays: null, final: 'auto' });
  assert.equal(lib.effective.finalize, 'on-tag');
});

test('a route its row does not permit is a failure, and the derived route stays in effect', () => {
  const cases = [
    [{ exposure: 'released', deploy: 'tag', production: 'https://x.example' }, 'public-tool'],
    [{ exposure: 'released', deploy: 'manual', production: 'https://x.example' }, 'rapid-app'],
    [{ exposure: 'released', deploy: 'tag', production: 'https://x.example' }, 'library-fast'],
    [{ exposure: 'released', deploy: 'none', production: null }, 'deploy-tag'],
    [{ exposure: 'self', deploy: 'none', production: null }, 'public-tool'],
    [{ exposure: 'live', deploy: 'push-main', production: 'https://x.example' }, 'rapid-app'],
  ];
  for (const [cfg, route] of cases) {
    const r = evaluateRelease({ ...cfg, release: { route } });
    assert.match(r.findings.map((f) => f.text).join('|'), new RegExp(`release\\.route: ${route} does not fit`), JSON.stringify(cfg));
    assert.equal(r.effective.route, deriveDefault(cfg).route);
    assert.equal(r.effective.final, deriveDefault(cfg).final);
  }
});

test('route: none narrows any row to no tags', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://x.example', release: { route: 'none' } });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(eff(r.effective), { route: 'none', candidates: 'off', testPeriodDays: 3, final: 'human' });
});

test('narrowing keys apply to the chosen route, not the derived one', () => {
  const base = { exposure: 'released', deploy: 'none', production: null };
  // library-fast has no candidates and no test period — so neither key has anything to set.
  const lib = evaluateRelease({ ...base, release: { route: 'library-fast', candidates: 'auto' } });
  assert.match(lib.findings.map((f) => f.text).join('|'), /release\.candidates: auto widens the release route — on exposure: released, route library-fast/);
  const libPeriod = evaluateRelease({ ...base, release: { route: 'library-fast', 'test-period': '7d' } });
  assert.match(libPeriod.findings.map((f) => f.text).join('|'), /release\.test-period: 7d has no period to set/);
  // final: human on library-fast narrows, and the publish stays tag-triggered.
  const libHuman = evaluateRelease({ ...base, release: { route: 'library-fast', final: 'human' } });
  assert.deepEqual(libHuman.findings, []);
  assert.equal(libHuman.effective.final, 'human');
});

test('candidates-per-day narrows a cap, never raises it', () => {
  const base = { exposure: 'released', deploy: 'none', production: null };
  const texts = (release) => evaluateRelease({ ...base, release }).findings.map((f) => f.text).join('|');
  assert.match(texts({ route: 'rapid-app', 'candidates-per-day': 2 }), /release\.candidates-per-day: 2 widens the release route.*at most 1 a day/);
  assert.equal(texts({ route: 'rapid-app', 'candidates-per-day': 1 }), '');
  // uncapped route: any positive cap narrows
  const r = evaluateRelease({ ...base, release: { 'candidates-per-day': 4 } });
  assert.deepEqual(r.findings, []);
  assert.equal(r.effective.candidatesPerDay, 4);
  assert.match(texts({ 'candidates-per-day': 0 }), /expected a positive whole number/);
  assert.match(texts({ 'candidates-per-day': '1' }), /expected a positive whole number/);
  assert.match(texts({ route: 'none', 'candidates-per-day': 1 }), /has nothing to cap — candidates are off/);
});

test('an unknown route value is a failure', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'none', production: null, release: { route: 'yolo' } });
  assert.match(r.findings.map((f) => f.text).join('|'), /release\.route is "yolo", expected one of: none, rapid-app/);
  assert.equal(r.effective.route, 'public-tool');
});
