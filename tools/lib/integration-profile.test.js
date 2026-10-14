'use strict';
/**
 * Unit tests for tools/lib/integration-profile.js (#610) — every exported rule, no I/O.
 * Run: `node --test tools/lib/integration-profile.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const ip = require('./integration-profile');

test('parseProfile: absent reads release-heavy, undeclared — #607 shape, nothing changes', () => {
  for (const doc of [{}, null, { 'integration-profile': null }, { 'integration-profile': '' }]) {
    const p = ip.parseProfile(doc);
    assert.strictEqual(p.profile, 'release-heavy');
    assert.strictEqual(p.declared, false);
    assert.strictEqual(p.valid, true);
  }
});

test('parseProfile: the four values are accepted as declared', () => {
  for (const v of ['gated', 'qualify', 'release-heavy', 'promote']) {
    assert.deepStrictEqual(ip.parseProfile({ 'integration-profile': v }), { profile: v, declared: true, valid: true, reason: `integration-profile: ${v}` });
  }
  assert.strictEqual(ip.parseProfile({ 'integration-profile': ' gated ' }).profile, 'gated');
});

test('parseProfile: a bad value fails closed to release-heavy and says why', () => {
  for (const v of ['Gated', 'strict', 3, true, ['gated']]) {
    const p = ip.parseProfile({ 'integration-profile': v });
    assert.strictEqual(p.profile, 'release-heavy');
    assert.strictEqual(p.declared, true);
    assert.strictEqual(p.valid, false);
    assert.match(p.reason, /expected one of gated \| qualify \| release-heavy \| promote/);
  }
});

test('parseHeavyWorkflow: default ci-heavy.yml; a file name is accepted; a path or name is not', () => {
  assert.deepStrictEqual(ip.parseHeavyWorkflow({}), { file: 'ci-heavy.yml', declared: false, valid: true, reason: 'heavy-workflow absent (ci-heavy.yml)' });
  assert.strictEqual(ip.parseHeavyWorkflow({ 'heavy-workflow': 'e2e.yaml' }).file, 'e2e.yaml');
  for (const bad of ['.github/workflows/e2e.yml', 'CI (heavy)', 'e2e', 7]) {
    const p = ip.parseHeavyWorkflow({ 'heavy-workflow': bad });
    assert.strictEqual(p.valid, false, String(bad));
    assert.strictEqual(p.file, 'ci-heavy.yml');
  }
});

test('heavyVerdict: unread, none, pending, green, red, and the newest dispatch speaks', () => {
  assert.strictEqual(ip.heavyVerdict(null).state, 'unread');
  assert.strictEqual(ip.heavyVerdict([]).state, 'none');
  assert.strictEqual(ip.heavyVerdict([{ status: 'in_progress' }]).state, 'pending');
  assert.strictEqual(ip.heavyVerdict([{ status: 'completed', conclusion: 'success' }]).state, 'green');
  assert.strictEqual(ip.heavyVerdict([{ status: 'completed', conclusion: 'failure' }]).state, 'red');
  assert.strictEqual(ip.heavyVerdict([{ status: 'completed', conclusion: 'cancelled' }]).state, 'none');
  const redThenGreen = [
    { status: 'completed', conclusion: 'failure', createdAt: '2026-10-14T01:00:00Z' },
    { status: 'completed', conclusion: 'success', createdAt: '2026-10-14T02:00:00Z' },
  ];
  assert.strictEqual(ip.heavyVerdict(redThenGreen).state, 'green');
  assert.strictEqual(ip.heavyVerdict(redThenGreen.slice().reverse()).state, 'green');
  const greenThenRed = [
    { status: 'completed', conclusion: 'success', createdAt: '2026-10-14T01:00:00Z' },
    { status: 'completed', conclusion: 'failure', createdAt: '2026-10-14T02:00:00Z' },
  ];
  assert.strictEqual(ip.heavyVerdict(greenThenRed).state, 'red');
});

test('liveRestriction: only exposure live without a tag deploy is restricted', () => {
  assert.strictEqual(ip.liveRestriction({ profile: 'qualify', declared: true, exposure: 'released', deploy: 'manual' }), null);
  assert.strictEqual(ip.liveRestriction({ profile: 'qualify', declared: true, exposure: 'live', deploy: 'tag' }), null);
  assert.strictEqual(ip.liveRestriction({ profile: 'gated', declared: true, exposure: 'live', deploy: 'push-main' }), null);
  assert.strictEqual(ip.liveRestriction({ profile: 'promote', declared: true, exposure: 'live', deploy: 'push-main' }), null);
  for (const profile of ['qualify', 'release-heavy']) {
    const r = ip.liveRestriction({ profile, declared: true, exposure: 'live', deploy: 'push-main' });
    assert.strictEqual(r.level, 'fail');
    assert.match(r.message, /Choose gated, or deploy from a qualified tag/);
  }
  // Never declared: a suggestion, never a fail — a repo that did not declare is not suddenly failing.
  assert.strictEqual(ip.liveRestriction({ profile: 'release-heavy', declared: false, exposure: 'live', deploy: 'push-main' }).level, 'suggest');
});

test('landingGate: only gated gates a landing, and docs-only is exempt', () => {
  const green = { state: 'green', why: 'ok' };
  for (const profile of ['qualify', 'release-heavy', 'promote']) {
    assert.strictEqual(ip.landingGate({ profile, heavyPresent: true, verdict: { state: 'red', why: 'x' }, file: 'ci-heavy.yml', at: 'b@1' }), null);
  }
  assert.strictEqual(ip.landingGate({ profile: 'gated', docsOnly: true, heavyPresent: false, verdict: null, file: 'ci-heavy.yml', at: 'b@1' }), null);
  assert.strictEqual(ip.landingGate({ profile: 'gated', heavyPresent: true, verdict: green, file: 'ci-heavy.yml', at: 'b@1' }).action, 'pass');
});

test('landingGate under gated: none dispatches, pending waits, red and no heavy lane refuse', () => {
  const g = (verdict, heavyPresent = true) => ip.landingGate({ profile: 'gated', heavyPresent, verdict, file: 'ci-heavy.yml', at: 'feat/x-1@abc1234' });
  assert.deepStrictEqual([g({ state: 'none', why: 'n' }).action, g({ state: 'none', why: 'n' }).ok], ['dispatch', false]);
  assert.strictEqual(g({ state: 'pending', why: 'p' }).action, 'wait');
  assert.strictEqual(g({ state: 'unread', why: 'u' }).action, 'wait');
  const red = g({ state: 'red', why: 'the heavy run finished failure', url: 'https://x/run/1' });
  assert.strictEqual(red.action, 'refuse');
  assert.match(red.detail, /https:\/\/x\/run\/1/);
  const absent = g(null, false);
  assert.strictEqual(absent.action, 'refuse');
  assert.match(absent.detail, /no \.github\/workflows\/ci-heavy\.yml at feat\/x-1@abc1234/);
});

test('waveVerdict: heavy joins a green light verdict; a heavy red turns the wave red for the split machinery', () => {
  const light = { state: 'green', attempt: 1, runIds: [1], why: '1 run(s): all success' };
  assert.strictEqual(ip.waveVerdict(light, null), light);
  assert.strictEqual(ip.waveVerdict({ ...light, state: 'pending' }, { state: 'red', why: 'x' }).state, 'pending');
  assert.strictEqual(ip.waveVerdict(light, { state: 'green', why: 'ok' }).state, 'green');
  const red = ip.waveVerdict(light, { state: 'red', why: 'the heavy run finished failure' });
  assert.deepStrictEqual([red.state, red.attempt, red.runIds], ['red', 1, [1]]);
  const none = ip.waveVerdict(light, { state: 'none', why: 'no heavy run at this sha' });
  assert.deepStrictEqual([none.state, none.heavyMissing], ['pending', true]);
  assert.strictEqual(ip.waveVerdict(light, { state: 'pending', why: 'p' }).heavyMissing, false);
});
