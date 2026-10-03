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

test('the routes table: seven routes, the human final only where a tag deploys or nothing is tagged', () => {
  assert.deepEqual([...ROUTES], ['none', 'rapid-app', 'public-tool', 'library-fast', 'deploy-tag', 'deploy-tag-fast', 'live']);
  assert.deepEqual(eff({ route: 'rapid-app', ...ROUTE_POLICY['rapid-app'] }), { route: 'rapid-app', candidates: 'auto', testPeriodDays: 3, final: 'auto' });
  assert.equal(ROUTE_POLICY['rapid-app'].candidatesPerDay, null);
  assert.equal(ROUTE_POLICY['rapid-app'].finalize, 'newest-clean');
  assert.equal(ROUTE_POLICY['public-tool'].finalize, 'after-test-period');
  assert.deepEqual([ROUTE_POLICY['library-fast'].candidates, ROUTE_POLICY['library-fast'].testPeriodDays, ROUTE_POLICY['library-fast'].final], ['off', null, 'auto']);
  assert.deepEqual([ROUTE_POLICY['deploy-tag'].candidates, ROUTE_POLICY['deploy-tag'].final], ['auto', 'human']);
  for (const r of ['none', 'live']) assert.deepEqual([ROUTE_POLICY[r].candidates, ROUTE_POLICY[r].final], ['off', 'human']);
});

test('no route finalizes automatically where the tag deploys production — except deploy-tag-fast, which only an operator grant opens (#446)', () => {
  for (const deploy of ['tag', 'manual']) {
    for (const route of ROW_ROUTES[`released-${deploy}`]) {
      if (route === 'deploy-tag-fast') continue;
      assert.equal(ROUTE_POLICY[route].final, 'human', `${deploy}/${route}`);
    }
  }
  assert.ok(!ROW_ROUTES['released-manual'].includes('deploy-tag-fast'));
  // Declared bare, the fast route does not stand: the derived human final stays.
  const bare = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://app.example', release: { route: 'deploy-tag-fast' } });
  assert.equal(bare.effective.route, 'deploy-tag');
  assert.equal(bare.effective.final, 'human');
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
  assert.equal(rapid.effective.candidatesPerDay, null);
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

test('candidates-per-day is an opt-in cap — no route has one by default (#443), so any positive value narrows', () => {
  const base = { exposure: 'released', deploy: 'none', production: null };
  const texts = (release) => evaluateRelease({ ...base, release }).findings.map((f) => f.text).join('|');
  assert.equal(texts({ route: 'rapid-app', 'candidates-per-day': 2 }), '');
  assert.equal(texts({ route: 'rapid-app', 'candidates-per-day': 1 }), '');
  // #443 reverses #439's derived public-tool cap: 4 and 1 are both a repo's own narrowing now.
  assert.equal(texts({ 'candidates-per-day': 4 }), '');
  assert.equal(texts({ 'candidates-per-day': 1 }), '');
  assert.equal(evaluateRelease({ ...base, release: { 'candidates-per-day': 1 } }).effective.candidatesPerDay, 1);
  // uncapped route (deploy-tag): any positive cap narrows
  const r = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://x.example', release: { 'candidates-per-day': 4 } });
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

test('#422 bump inputs: guard-run / guard-result / exports are non-empty strings, one detector at most', () => {
  const base = { trunk: 'main', exposure: 'released', production: null, deploy: 'none' };
  const ok = evaluateRelease({ ...base, release: { 'guard-run': 'node scripts/guard.mjs', exports: 'api.txt' } });
  assert.deepStrictEqual(ok.findings, []);
  assert.strictEqual(ok.effective.candidates, 'auto', 'an input key never changes the route policy');
  const empty = evaluateRelease({ ...base, release: { exports: '' } });
  assert.match(empty.findings[0].text, /release\.exports is "", expected a non-empty string/);
  const both = evaluateRelease({ ...base, release: { 'guard-run': 'a', 'guard-result': 'b.json' } });
  assert.match(both.findings[0].text, /both declared/);
});

// --- npm (#433) ------------------------------------------------------------------------------

const PUBLIC_TOOL = { exposure: 'released', deploy: 'none', production: null };

test('npm: absent means no npm publish', () => {
  assert.equal(evaluateRelease(PUBLIC_TOOL).effective.npm, null);
  assert.equal(evaluateRelease({ ...PUBLIC_TOOL, release: { final: 'human' } }).effective.npm, null);
});

test('npm: the pair on a public-tool route is the package directory and its gate', () => {
  const r = evaluateRelease({ ...PUBLIC_TOOL, release: { npm: '.', 'npm-gate': 'node scripts/check-pack-allowlist.mjs' } });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.effective.npm, { dir: '.', gate: 'node scripts/check-pack-allowlist.mjs' });
  const sub = evaluateRelease({ ...PUBLIC_TOOL, release: { npm: 'packages/cli/', 'npm-gate': 'npm run pack-check' } });
  assert.deepEqual(sub.effective.npm, { dir: 'packages/cli', gate: 'npm run pack-check' });
});

test('npm: one key without the other is a failure, and nothing publishes', () => {
  const noGate = evaluateRelease({ ...PUBLIC_TOOL, release: { npm: '.' } });
  assert.equal(noGate.effective.npm, null);
  assert.match(noGate.findings[0].text, /release\.npm is declared without release\.npm-gate/);
  const noDir = evaluateRelease({ ...PUBLIC_TOOL, release: { 'npm-gate': 'x' } });
  assert.equal(noDir.effective.npm, null);
  assert.match(noDir.findings[0].text, /release\.npm-gate is declared without release\.npm/);
});

test('npm: a directory outside the repo, or an empty value, is a failure', () => {
  for (const npm of ['/abs', '../sibling', 'a/../../b', '', 7]) {
    const r = evaluateRelease({ ...PUBLIC_TOOL, release: { npm, 'npm-gate': 'x' } });
    assert.equal(r.effective.npm, null, JSON.stringify(npm));
    assert.ok(r.findings.some((f) => f.text.startsWith('release.npm is')), JSON.stringify(npm));
  }
});

test('npm: fits only public-tool — a deploying tag, rapid-app and library-fast refuse it', () => {
  const pair = { npm: '.', 'npm-gate': 'x' };
  const cases = [
    { exposure: 'released', deploy: 'tag', production: 'https://x.example', release: pair },
    { ...PUBLIC_TOOL, release: { route: 'rapid-app', ...pair } },
    { ...PUBLIC_TOOL, release: { route: 'library-fast', ...pair } },
    { ...PUBLIC_TOOL, release: { route: 'none', ...pair } },
    { exposure: 'none', deploy: 'none', production: null, release: pair },
  ];
  for (const cfg of cases) {
    const r = evaluateRelease(cfg);
    assert.equal(r.effective.npm, null);
    assert.ok(r.findings.some((f) => /fits only route public-tool/.test(f.text)), JSON.stringify(cfg));
  }
});

test('#443: no route derives a candidates-per-day cap — the newest candidate always names trunk head', () => {
  for (const route of Object.keys(ROUTE_POLICY)) assert.equal(ROUTE_POLICY[route].candidatesPerDay, null, route);
  const r = evaluateRelease({ exposure: 'released', deploy: 'none', production: null });
  assert.equal(r.effective.route, 'public-tool');
  assert.equal(r.effective.candidatesPerDay, null);
});

test('#438: version-source is tag | manifest, defaults to manifest, and widens nothing', () => {
  const base = { exposure: 'released', deploy: 'tag', production: 'https://x.example' };
  assert.equal(evaluateRelease(base).effective.versionSource, 'manifest');
  const tag = evaluateRelease({ ...base, release: { 'version-source': 'tag' } });
  assert.deepEqual(tag.findings, []);
  assert.equal(tag.effective.versionSource, 'tag');
  assert.equal(tag.effective.final, 'human');
  const bad = evaluateRelease({ ...base, release: { 'version-source': 'git' } });
  assert.match(bad.findings.map((f) => f.text).join('|'), /release\.version-source is "git", expected "tag" or "manifest"/);
  assert.equal(bad.effective.versionSource, 'manifest');
  // carried through a declared route too
  const routed = evaluateRelease({ exposure: 'released', deploy: 'none', production: null, release: { route: 'rapid-app', 'version-source': 'tag' } });
  assert.equal(routed.effective.versionSource, 'tag');
});

test('#441: final: auto on deploy-tag stands only with an operator grant', () => {
  const base = { exposure: 'released', deploy: 'tag', production: 'https://x.example' };
  // (a) no grant: still a widening, and the finding names the way to grant it
  const none = evaluateRelease({ ...base, release: { final: 'auto' } });
  assert.match(none.findings.map((f) => f.text).join('|'), /release\.final: auto widens the release route.*release\.final-grant/);
  assert.equal(none.effective.final, 'human');
  assert.equal(none.effective.finalGrant, null);
  // (b) a grant: automatic final, the grant carried for the tracker check
  for (const g of [123, '123', '#123']) {
    const ok = evaluateRelease({ ...base, release: { final: 'auto', 'final-grant': g } });
    assert.deepEqual(ok.findings, [], String(g));
    assert.equal(ok.effective.final, 'auto');
    assert.equal(ok.effective.finalize, 'after-test-period');
    assert.deepEqual(ok.effective.finalGrant, { issue: 123 });
  }
  // revocable: final: human, or no final key, leaves the grant inert
  for (const release of [{ final: 'human', 'final-grant': 123 }, { 'final-grant': 123 }]) {
    const r = evaluateRelease({ ...base, release });
    assert.deepEqual(r.findings, []);
    assert.equal(r.effective.final, 'human');
    assert.equal(r.effective.finalGrant, null);
  }
  // bad value
  assert.match(evaluateRelease({ ...base, release: { final: 'auto', 'final-grant': 'soon' } }).findings.map((f) => f.text).join('|'), /release\.final-grant is "soon"/);
  // deploy: manual stays human, grant or not
  const manual = evaluateRelease({ exposure: 'released', deploy: 'manual', production: 'https://x.example', runbook: 'r.md', release: { final: 'auto', 'final-grant': 5 } });
  const mt = manual.findings.map((f) => f.text).join('|');
  assert.match(mt, /release\.final-grant fits only route deploy-tag on deploy: tag.*a person runs the deploy anyway/);
  assert.match(mt, /release\.final: auto widens/);
  assert.equal(manual.effective.final, 'human');
  // a grant on a route that deploys nothing is meaningless
  assert.match(evaluateRelease({ exposure: 'released', deploy: 'none', production: null, release: { 'final-grant': 5 } }).findings.map((f) => f.text).join('|'), /release\.final-grant fits only route deploy-tag/);
  // route: none on a deploy-tag row — no grant there either
  assert.match(evaluateRelease({ ...base, release: { route: 'none', 'final-grant': 5 } }).findings.map((f) => f.text).join('|'), /release\.final-grant fits only route deploy-tag/);
});

test('#441: finalGrantVerdict — a live, trusted, labelled decision grants; a reopened one does not', () => {
  const { finalGrantVerdict } = require('./release-policy.js');
  const decision = { body: '⚖ Decision recorded — ruled-by `Boss` · answers `-` · host `box` · 2026-10-02T00:00:00Z', createdAt: '2026-10-02T00:00:00Z', authorAssociation: 'OWNER', author: { login: 'op' } };
  const reopen = { body: '↩ Decision reopened — ruled-by `Boss` · host `box` · 2026-10-03T00:00:00Z — every decision on this issue up to this point is superseded.', createdAt: '2026-10-03T00:00:00Z', authorAssociation: 'OWNER', author: { login: 'op' } };
  const labels = [{ name: 'decision-recorded' }];
  const ok = finalGrantVerdict({ state: 'CLOSED', labels, comments: [decision] }, { issue: 7 });
  assert.equal(ok.ok, true);
  assert.equal(ok.ruledBy, 'Boss');
  assert.equal(finalGrantVerdict(null, { issue: 7 }).ok, false);
  const re = finalGrantVerdict({ state: 'OPEN', labels, comments: [decision, reopen] }, { issue: 7 });
  assert.equal(re.ok, false);
  assert.match(re.detail, /its decision was reopened/);
  assert.match(finalGrantVerdict({ state: 'OPEN', labels: [], comments: [decision] }, { issue: 7 }).detail, /no `decision-recorded` label/);
  assert.match(finalGrantVerdict({ state: 'OPEN', labels, comments: [{ ...decision, authorAssociation: 'NONE' }] }, { issue: 7 }).detail, /not recorded by a trusted human/);
  assert.match(finalGrantVerdict({ state: 'OPEN', labels, comments: [] }, { issue: 7 }).detail, /carries no recorded decision/);
});

// ---- #446: deploy-tag-fast ----------------------------------------------------------------------
const FAST_BASE = { exposure: 'released', deploy: 'tag', production: 'https://app.example' };
const FAST = { route: 'deploy-tag-fast', 'final-grant': 7, 'health-url': 'https://app.example/health', rollback: 'auto' };
const texts = (r) => r.findings.map((f) => f.text).join('|');

test('#446 a granted, health-gated deploy-tag-fast stands: final on every green head, no candidate', () => {
  const r = evaluateRelease({ ...FAST_BASE, release: { ...FAST } });
  assert.deepEqual(r.findings, []);
  const e = r.effective;
  assert.deepEqual(
    { route: e.route, candidates: e.candidates, testPeriodDays: e.testPeriodDays, final: e.final, finalize: e.finalize, finalGrant: e.finalGrant, healthGate: e.healthGate, finalSpacingHours: e.finalSpacingHours },
    { route: 'deploy-tag-fast', candidates: 'off', testPeriodDays: null, final: 'auto', finalize: 'on-green-head', finalGrant: { issue: 7 }, healthGate: { url: 'https://app.example/health', rollback: 'auto' }, finalSpacingHours: 1 },
  );
  // final: auto restates the route and is harmless.
  assert.deepEqual(evaluateRelease({ ...FAST_BASE, release: { ...FAST, final: 'auto' } }).findings, []);
});

test('#446 without its grant the fast route fails closed to deploy-tag with a human final', () => {
  const { 'final-grant': _g, ...noGrant } = FAST;
  const r = evaluateRelease({ ...FAST_BASE, release: noGrant });
  assert.match(texts(r), /deploy-tag-fast needs the operator's grant.*release\.final-grant/);
  assert.equal(r.effective.route, 'deploy-tag');
  assert.equal(r.effective.final, 'human');
  assert.equal(r.effective.finalGrant, null);
  assert.equal(r.effective.healthGate, null);
});

test('#446 the health gate is required: health-url (https only) and rollback: auto', () => {
  for (const [label, release] of [
    ['no health-url', { ...FAST, 'health-url': undefined }],
    ['http url', { ...FAST, 'health-url': 'http://app.example/health' }],
    ['not a url', { ...FAST, 'health-url': 'app.example/health' }],
    ['no rollback', { ...FAST, rollback: undefined }],
    ['rollback manual', { ...FAST, rollback: 'manual' }],
  ]) {
    const clean = Object.fromEntries(Object.entries(release).filter(([, v]) => v !== undefined));
    const r = evaluateRelease({ ...FAST_BASE, release: clean });
    assert.match(texts(r), /deploy-tag-fast needs/, label);
    assert.equal(r.effective.route, 'deploy-tag', label);
    assert.equal(r.effective.final, 'human', label);
  }
});

test('#446 the fast route fits deploy: tag only — not deploy: manual, not a no-production repo', () => {
  const manual = evaluateRelease({ exposure: 'released', deploy: 'manual', production: 'https://app.example', runbook: 'r.md', release: { ...FAST } });
  assert.match(texts(manual), /release\.route: deploy-tag-fast does not fit/);
  assert.equal(manual.effective.final, 'human');
  const lib = evaluateRelease({ exposure: 'released', deploy: 'none', production: null, release: { ...FAST } });
  assert.match(texts(lib), /release\.route: deploy-tag-fast does not fit/);
  // library-fast keeps its meaning: still not offered where the tag deploys.
  assert.ok(!ROW_ROUTES['released-tag'].includes('library-fast'));
  assert.equal(deriveDefault(FAST_BASE).route, 'deploy-tag');
});

test('#446 final-spacing: hours or days, never below 1h', () => {
  const at = (v) => evaluateRelease({ ...FAST_BASE, release: { ...FAST, 'final-spacing': v } });
  assert.equal(at('6h').effective.finalSpacingHours, 6);
  assert.equal(at('2d').effective.finalSpacingHours, 48);
  assert.equal(at('1h').effective.finalSpacingHours, 1);
  for (const bad of ['30m', '0h', 'abc', 3]) {
    const r = at(bad);
    assert.match(texts(r), /release\.final-spacing/, String(bad));
    assert.equal(r.effective.finalSpacingHours, 1, String(bad));
  }
});

test('#446 the fast keys fit only the fast route', () => {
  const r = evaluateRelease({ ...FAST_BASE, release: { 'health-url': 'https://app.example/health', rollback: 'auto', 'final-spacing': '2h' } });
  assert.match(texts(r), /release\.health-url \/ release\.rollback \/ release\.final-spacing fits only route deploy-tag-fast/);
  assert.equal(r.effective.healthGate, null);
});

test('#446 a candidate key, a test period or a human final on the fast route fail', () => {
  for (const [k, v, re] of [
    ['test-period', '3d', /release\.test-period: 3d has no period/],
    ['candidates', 'auto', /release\.candidates: auto widens/],
    ['candidates-per-day', 2, /release\.candidates-per-day: 2 has nothing to cap/],
    ['final', 'human', /release\.final: human on route deploy-tag-fast/],
  ]) {
    const r = evaluateRelease({ ...FAST_BASE, release: { ...FAST, [k]: v } });
    assert.match(texts(r), re, k);
    assert.equal(r.effective.final, 'auto', k);
  }
});
