'use strict';
/**
 * Tests for tools/lib/writes-authority.js — the `writes` precedence ladder behind #208's
 * split (`serial-direct` / `serial-gated` / `isolated`, with `serial` as a legacy alias).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const { resolveWrites, isAcceptedWritesValue, WRITES_DECLARED, WRITES_LEGACY } = require('./writes-authority.js');

test('WRITES_DECLARED is exactly the three current methods', () => {
  assert.deepStrictEqual([...WRITES_DECLARED].sort(), ['isolated', 'serial-direct', 'serial-gated']);
});

test('WRITES_LEGACY maps the old spelling to serial-direct, and nothing else', () => {
  assert.deepStrictEqual(WRITES_LEGACY, { serial: 'serial-direct' });
});

test('resolveWrites: each current-vocabulary value reads as itself, source "declared"', () => {
  for (const v of WRITES_DECLARED) {
    assert.deepStrictEqual(resolveWrites(v), { value: v, source: 'declared' });
  }
});

test('resolveWrites: the legacy alias "serial" resolves to serial-direct, source "legacy"', () => {
  assert.deepStrictEqual(resolveWrites('serial'), { value: 'serial-direct', source: 'legacy' });
});

test('resolveWrites: omitted (null/undefined) resolves to isolated, source "default"', () => {
  assert.deepStrictEqual(resolveWrites(null), { value: 'isolated', source: 'default' });
  assert.deepStrictEqual(resolveWrites(undefined), { value: 'isolated', source: 'default' });
});

test('resolveWrites: an unrecognised string fails closed to isolated, source "unrecognised" — never toward a serial reading', () => {
  assert.deepStrictEqual(resolveWrites('parallel'), { value: 'isolated', source: 'unrecognised' });
  assert.deepStrictEqual(resolveWrites('SERIAL'), { value: 'isolated', source: 'unrecognised' }); // case-sensitive
});

test('isAcceptedWritesValue: current vocabulary, the legacy alias, and omission are all accepted', () => {
  for (const v of WRITES_DECLARED) assert.strictEqual(isAcceptedWritesValue(v), true);
  assert.strictEqual(isAcceptedWritesValue('serial'), true);
  assert.strictEqual(isAcceptedWritesValue(null), true);
  assert.strictEqual(isAcceptedWritesValue(undefined), true);
});

test('isAcceptedWritesValue: anything else is rejected', () => {
  assert.strictEqual(isAcceptedWritesValue('parallel'), false);
  assert.strictEqual(isAcceptedWritesValue('SERIAL'), false);
  assert.strictEqual(isAcceptedWritesValue('serial-gated '), false); // no trimming
});
