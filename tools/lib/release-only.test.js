'use strict';
/**
 * #736: tools/lib/release-only.js — the declaration and the door's pure verdict. The CLI half
 * (ship --dry on a fixture repo, release cut unchanged) is ship-release-only.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');

const ro = require('./release-only');

const head = (workflowName, conclusion, databaseId, status = 'completed') => ({ workflowName, status, conclusion, databaseId });
const decl = (map) => ro.parseReleaseOnly({ 'release-only-checks': map });

test('#736 parse: absent → not declared, valid, no checks', () => {
  for (const doc of [{}, null, { 'release-only-checks': null }]) {
    const p = ro.parseReleaseOnly(doc);
    assert.strictEqual(p.declared, false);
    assert.strictEqual(p.valid, true);
    assert.deepStrictEqual(p.checks, []);
  }
});

test('#736 parse: a whole workflow and a quoted workflow / job, each with its paths', () => {
  const p = decl({ 'Install smoke': ['packaging/', 'scripts/install.sh'], '"CI / install (*)"': ['packaging/**'] });
  assert.strictEqual(p.valid, true, p.problems.join('; '));
  assert.deepStrictEqual(p.checks.map((c) => [c.key, c.workflow, c.job, c.paths]), [
    ['Install smoke', 'Install smoke', null, ['packaging/', 'scripts/install.sh']],
    ['CI / install (*)', 'CI', 'install (*)', ['packaging/**']],
  ]);
  assert.ok(p.checks[1].jobRe.test('install (macos-latest)'));
  assert.ok(!p.checks[1].jobRe.test('test (macos-latest)'));
});

test('#736 parse: every malformed shape invalidates the WHOLE key, so nothing is exempted', () => {
  const cases = [
    ['a list, not a map', ['Install smoke']],
    ['a scalar', 'Install smoke'],
    ['an empty map', {}],
    ['a check with no paths', { 'Install smoke': [] }],
    ['a check with a null value', { 'Install smoke': null }],
    ['a negated path', { 'Install smoke': ['!docs/'] }],
    ['a path with a range', { 'Install smoke': ['pkg/[ab]'] }],
    ['an empty job part', { 'CI / ': ['pkg/'] }],
    ['a non-string path', { 'Install smoke': [3] }],
  ];
  for (const [why, v] of cases) {
    const p = decl(v);
    assert.strictEqual(p.valid, false, why);
    assert.strictEqual(p.declared, true, why);
    assert.deepStrictEqual(p.checks, [], why);
    assert.ok(p.problems.length && p.problems[0].includes('release-only-checks'), why);
  }
  // One good entry beside a bad one is still invalid as a whole.
  assert.strictEqual(decl({ 'Install smoke': ['pkg/'], Sign: [] }).valid, false);
});

test('#736 parse: a single path string reads as a one-item list', () => {
  const p = decl({ 'Install smoke': 'packaging/' });
  assert.strictEqual(p.valid, true);
  assert.deepStrictEqual(p.checks[0].paths, ['packaging/']);
});

const CHECKS = decl({ 'Install smoke': ['packaging/', 'scripts/install.sh'], 'CI / install (*)': ['installer/**'] }).checks;

test('#736 verdict: red ONLY on a declared workflow, diff outside its paths → ok, naming the ignored run', () => {
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'success', 1), head('Install smoke', 'failure', 2)], changed: ['tools/colab', 'README.md'], checks: CHECKS });
  assert.strictEqual(v.applies, true);
  assert.strictEqual(v.ok, true, v.reason);
  assert.deepStrictEqual(v.ignored, [{ check: 'Install smoke', workflow: 'Install smoke', job: null, runId: 2, conclusion: 'failure' }]);
  assert.strictEqual(ro.ignoredList(v.ignored), 'Install smoke (run 2)');
});

test('#736 verdict: a branch touching a path the red check covers is held, naming path and check', () => {
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'success', 1), head('Install smoke', 'failure', 2)], changed: ['src/a.js', 'scripts/install.sh'], checks: CHECKS });
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.touched, [{ check: 'Install smoke', paths: ['scripts/install.sh'] }]);
  assert.match(v.reason, /scripts\/install\.sh — covered by "Install smoke"/);
  assert.match(v.reason, /cure rule or a ci-grant/);
  // CODEOWNERS semantics: a directory pattern covers everything under it.
  assert.strictEqual(ro.releaseOnlyVerdict({ heads: [head('CI', 'success', 1), head('Install smoke', 'failure', 2)], changed: ['packaging/deb/control'], checks: CHECKS }).ok, false);
});

test('#736 verdict: touching the paths of a GREEN release-only check does not matter', () => {
  const checks = decl({ 'Install smoke': ['packaging/'], Sign: ['signing/'] }).checks;
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'success', 1), head('Install smoke', 'failure', 2), head('Sign', 'success', 3)], changed: ['signing/key.cfg'], checks });
  assert.strictEqual(v.ok, true, v.reason);
});

test('#736 verdict: a red outside the declared set refuses', () => {
  const checks = decl({ 'Install smoke': ['packaging/'] }).checks;
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 1), head('Install smoke', 'failure', 2)], changed: [], checks });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /also red on CI \(run 1\), which is not a release-only check/);
});

test('#736 verdict: not applicable when nothing is declared or the red is not a finished run', () => {
  assert.strictEqual(ro.releaseOnlyVerdict({ heads: [head('Install smoke', 'failure', 2)], changed: [], checks: [] }).applies, false);
  // Only an in-flight / cancelled / skipped head: no finished red for the door to judge.
  assert.strictEqual(ro.releaseOnlyVerdict({ heads: [head('CI', null, 1, 'in_progress')], changed: [], checks: CHECKS }).applies, false);
  assert.strictEqual(ro.releaseOnlyVerdict({ heads: [head('CI', 'skipped', 1)], changed: [], checks: CHECKS }).applies, false);
});

test('#736 verdict: a run still in flight beside the red refuses (fail closed)', () => {
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', null, 1, 'in_progress'), head('Install smoke', 'failure', 2)], changed: [], checks: CHECKS });
  assert.strictEqual(v.applies, true);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /still in flight/);
});

test('#736 verdict: nothing but release-only checks verified the sha → refused', () => {
  const v = ro.releaseOnlyVerdict({ heads: [head('Install smoke', 'failure', 2)], changed: [], checks: CHECKS });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /nothing but release-only checks/);
});

test('#736 verdict: unread heads or diff refuse', () => {
  assert.strictEqual(ro.releaseOnlyVerdict({ heads: null, changed: [], checks: CHECKS }).ok, false);
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'success', 1), head('Install smoke', 'failure', 2)], changed: null, checks: CHECKS });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /could not read the branch diff/);
});

test('#736 verdict: job level — every red job of the run must be a declared job of that workflow', () => {
  const jobs = {
    1: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'install (macos-latest)', status: 'completed', conclusion: 'failure' }],
    3: [{ name: 'test', status: 'completed', conclusion: 'failure' }, { name: 'install (ubuntu)', status: 'completed', conclusion: 'failure' }],
  };
  const jobsOf = (id) => jobs[id] || null;
  const ok = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 1)], jobsOf, changed: ['src/x.js'], checks: CHECKS });
  assert.strictEqual(ok.ok, true, ok.reason); // `test` ran green in the same run: something else verified it
  assert.strictEqual(ro.ignoredList(ok.ignored), 'CI / install (macos-latest) (run 1)');
  const held = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 1)], jobsOf, changed: ['installer/mac/pkg.sh'], checks: CHECKS });
  assert.strictEqual(held.ok, false);
  assert.match(held.reason, /covered by "CI \/ install \(\*\)"/);
  const mixed = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 3)], jobsOf, changed: [], checks: CHECKS });
  assert.strictEqual(mixed.ok, false);
  assert.match(mixed.reason, /also red on CI \/ test \(run 3\)/);
  const unread = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 9)], jobsOf, changed: [], checks: CHECKS });
  assert.strictEqual(unread.ok, false);
  assert.match(unread.reason, /could not read the jobs/);
});

test('#736 verdict: job level — only release-only jobs in the run and no other green → refused', () => {
  const jobsOf = () => [{ name: 'install (macos)', status: 'completed', conclusion: 'failure' }];
  const v = ro.releaseOnlyVerdict({ heads: [head('CI', 'failure', 1)], jobsOf, changed: [], checks: CHECKS });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /nothing but release-only checks/);
});
