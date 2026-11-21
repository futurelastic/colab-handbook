'use strict';
/**
 * Unit tests for #762 — tools/lib/data-exemption.js, the one reading of `data:` and its
 * falsifiers. The CLI half (ship reads the TARGET, a branch cannot exempt itself, the lowering row)
 * is tools/lib/ship-data-exemption.test.js.
 * Run: `node --test tools/lib/data-exemption.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const d = require('./data-exemption');

const GREEN = { tier: 'B', trunk: 'main', production: null, deploy: 'none', stack: 'node', data: 'none' };
const NO_TAGS = { ok: true, tags: [] };

test('parseData: absent, none, real, malformed', () => {
  assert.deepStrictEqual(d.parseData({}).value, null);
  assert.strictEqual(d.parseData({}).declared, false);
  assert.strictEqual(d.parseData({ data: 'none' }).value, 'none');
  assert.strictEqual(d.parseData({ data: ' real ' }).value, 'real');
  const bad = d.parseData({ data: 'nothing' });
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.value, null, 'malformed reads as absent — the gate runs');
  assert.strictEqual(d.parseData({ data: null }).valid, false, 'a bare `data:` is not a declaration of none');
  assert.strictEqual(d.parseData(null).declared, false);
});

test('exemptionVerdict: data: none with no falsifier is exempt, and says why', () => {
  const v = d.exemptionVerdict(GREEN, NO_TAGS);
  assert.strictEqual(v.exempt, true);
  assert.strictEqual(v.declared, true);
  assert.match(v.reason, /^exempt — data: none \(no production, no deploy, no release\)$/);
});

test('exemptionVerdict: absent or data: real never exempts', () => {
  const { data, ...noData } = GREEN;
  assert.strictEqual(d.exemptionVerdict(noData, NO_TAGS).exempt, false);
  assert.strictEqual(d.exemptionVerdict(noData, NO_TAGS).declared, false);
  assert.strictEqual(d.exemptionVerdict({ ...GREEN, data: 'real' }, NO_TAGS).exempt, false);
  assert.strictEqual(d.exemptionVerdict({ ...GREEN, data: 'bogus' }, NO_TAGS).exempt, false);
});

test('each falsifier alone restores the gate and is named', () => {
  const cases = [
    [{ ...GREEN, production: 'https://app.example' }, 'production', /production is https:\/\/app\.example/],
    [{ ...GREEN, tier: 'C' }, 'axis', /tier C/],
    [{ ...GREEN, tier: 'A' }, 'axis', /tier A/],
    [{ ...GREEN, exposure: 'live' }, 'axis', /exposure live/],
    [{ ...GREEN, exposure: 'released' }, 'axis', /exposure released/],
    [{ ...GREEN, deploy: 'push-main' }, 'deploy', /deploy is push-main/],
    [{ ...GREEN, deploy: 'manual' }, 'deploy', /deploy is manual/],
  ];
  for (const [doc, kind, re] of cases) {
    const v = d.exemptionVerdict(doc, NO_TAGS);
    assert.strictEqual(v.exempt, false, JSON.stringify(doc));
    assert.deepStrictEqual(v.falsifiers.map((f) => f.kind), [kind]);
    assert.match(v.reason, /^data: none does not apply: /);
    assert.match(v.reason, re);
  }
});

test('a version tag on the target is a falsifier; a non-version tag is not', () => {
  assert.strictEqual(d.exemptionVerdict(GREEN, { ok: true, tags: ['v0.1.0'] }).exempt, false);
  assert.strictEqual(d.exemptionVerdict(GREEN, { ok: true, tags: ['1.0.0-rc.1'] }).exempt, false);
  assert.strictEqual(d.exemptionVerdict(GREEN, { ok: true, tags: ['scaffold', 'release-2024'] }).exempt, true);
  assert.match(d.exemptionVerdict(GREEN, { ok: true, tags: ['v0.1.0'] }).reason, /version tag v0\.1\.0 on the target/);
});

test('an unreadable tag list fails closed', () => {
  const v = d.exemptionVerdict(GREEN, { ok: false, tags: [], why: 'ls-remote failed' });
  assert.strictEqual(v.exempt, false);
  assert.match(v.reason, /could not be read \(ls-remote failed\)/);
});

test('tags: null skips the tag check (descriptor-only readers)', () => {
  assert.deepStrictEqual(d.falsifiers(GREEN, null), []);
  assert.deepStrictEqual(d.falsifiers({ ...GREEN, deploy: 'tag' }, null).map((f) => f.kind), ['deploy']);
});

test('nothing-ish production/deploy values are not falsifiers', () => {
  for (const v of [null, undefined, '', 'none', 'null', '~']) {
    assert.deepStrictEqual(d.falsifiers({ ...GREEN, production: v, deploy: v }, NO_TAGS), [], String(v));
  }
});

test('tier B and exposure none/self are not falsifiers', () => {
  assert.strictEqual(d.exemptionVerdict({ ...GREEN, tier: 'B', exposure: 'self' }, NO_TAGS).exempt, true);
  assert.strictEqual(d.exemptionVerdict({ ...GREEN, exposure: 'none' }, NO_TAGS).exempt, true);
});

test('loweringVerdict: only a branch that introduces data: none lowers', () => {
  const { data, ...target } = GREEN;
  assert.strictEqual(d.loweringVerdict(target, GREEN).lowers, true);
  assert.match(d.loweringVerdict(target, GREEN).reason, /none declared/);
  assert.strictEqual(d.loweringVerdict({ ...target, data: 'real' }, GREEN).lowers, true);
  assert.match(d.loweringVerdict({ ...target, data: 'real' }, GREEN).reason, /data: real/);
  assert.strictEqual(d.loweringVerdict(GREEN, GREEN).lowers, false, 'already declared on the target');
  assert.strictEqual(d.loweringVerdict(target, target).lowers, false);
  assert.strictEqual(d.loweringVerdict(GREEN, target).lowers, false, 'removing it raises protection');
  assert.strictEqual(d.loweringVerdict(target, { ...GREEN, data: 'real' }).lowers, false);
});

test('isVersionTag', () => {
  for (const t of ['v1.2.3', '1.2.3', 'v0.0.1-rc.2', 'v10.20.30+build.1']) assert.ok(d.isVersionTag(t), t);
  for (const t of ['v1.2', 'latest', 'v01.2.3', 'release-1.2.3', '']) assert.ok(!d.isVersionTag(t), t);
});
