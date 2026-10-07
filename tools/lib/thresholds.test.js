'use strict';
/** tools/lib/thresholds.js — repo-declared advisory thresholds (#560). */

const test = require('node:test');
const assert = require('node:assert');
const th = require('./thresholds.js');
const yaml = require('./yaml.js');

test('#560: a repo that declares nothing gets today\'s values exactly', () => {
  for (const doc of [{}, null, undefined, { thresholds: null }, { thresholds: '' }]) {
    const r = th.parseThresholds(doc);
    assert.deepStrictEqual(r.values, th.DEFAULTS);
    assert.deepStrictEqual(r.problems, []);
  }
  // The defaults are the numbers the sites carried before #560 — pinned so none drifts silently.
  assert.deepStrictEqual(th.DEFAULTS, {
    'hot-file-count': 3, 'dependents-count': 3, 'hold-stale-days': 30, 'smoke-minutes': 3,
    'claude-md-kb': 40, 'claude-md-line-multiple': 6, 'claude-md-line-floor-bytes': 2048,
    'transitional-days': 180, 'doc-budget-slack': 100,
  });
});

test('#560: a declared value overrides its default, and only its own', () => {
  const doc = yaml.parse('trunk: main\nthresholds:\n  hot-file-count: 5\n  hold-stale-days: 45\n');
  const r = th.parseThresholds(doc);
  assert.strictEqual(r.values['hot-file-count'], 5);
  assert.strictEqual(r.values['hold-stale-days'], 45);
  assert.strictEqual(r.values['claude-md-kb'], 40);
  assert.deepStrictEqual(r.declared, { 'hot-file-count': true, 'hold-stale-days': true });
  assert.deepStrictEqual(r.problems, []);
});

test('#560: digit strings (the audit\'s reader) read the same as numbers (the CLI\'s)', () => {
  assert.strictEqual(th.thresholdValue({ thresholds: { 'smoke-minutes': '5' } }, 'smoke-minutes'), 5);
  assert.strictEqual(th.thresholdValue({ thresholds: { 'smoke-minutes': 5 } }, 'smoke-minutes'), 5);
});

test('#560: a malformed value falls back to the default and is reported', () => {
  const cases = [
    [{ 'hot-file-count': 1 }, 'hot-file-count', /≥ 2/],
    [{ 'hold-stale-days': 0 }, 'hold-stale-days', /≥ 1/],
    [{ 'smoke-minutes': 2.5 }, 'smoke-minutes', /whole number/],
    [{ 'claude-md-kb': '40KB' }, 'claude-md-kb', /whole number/],
    [{ 'transitional-days': -3 }, 'transitional-days', /whole number/],
    [{ 'doc-budget-slack': true }, 'doc-budget-slack', /whole number/],
  ];
  for (const [map, key, re] of cases) {
    const r = th.parseThresholds({ thresholds: map });
    assert.strictEqual(r.values[key], th.DEFAULTS[key], key);
    assert.strictEqual(r.problems.length, 1, key);
    assert.match(r.problems[0], re);
    assert.match(r.problems[0], new RegExp(`default ${th.DEFAULTS[key]}$`));
  }
});

test('#560: a typo\'d key is a problem, not a silently ignored extra', () => {
  const r = th.parseThresholds({ thresholds: { 'hot-files': 4 } });
  assert.deepStrictEqual(r.values, th.DEFAULTS);
  assert.match(r.problems[0], /thresholds\.hot-files is not a known threshold/);
});

test('#560: a non-map thresholds value is a problem', () => {
  for (const v of [5, 'high', [1, 2], true]) {
    const r = th.parseThresholds({ thresholds: v });
    assert.deepStrictEqual(r.values, th.DEFAULTS);
    assert.match(r.problems[0], /must be a map/);
  }
});

test('#560: a floor of 0 admits 0', () => {
  assert.strictEqual(th.thresholdValue({ thresholds: { 'doc-budget-slack': 0 } }, 'doc-budget-slack'), 0);
});
