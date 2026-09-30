'use strict';
/** Tests for tools/lib/gate.js — the optional `gate:` block (#410). */

const test = require('node:test');
const assert = require('node:assert');
const { parseGate, gateMode } = require('./gate.js');
const { parse } = require('./yaml.js');

test('absent → local, valid, not declared', () => {
  const g = parseGate({ trunk: 'main' });
  assert.deepStrictEqual([g.declared, g.valid, g.authoritative, g.smoke], [false, true, 'local', null]);
  assert.strictEqual(parseGate(null).valid, true);
  assert.strictEqual(parseGate({ gate: null }).declared, false);
});

test('block with smoke + authoritative ci → valid ci', () => {
  const g = parseGate(parse('gate:\n  smoke: npm run smoke\n  authoritative: ci\n'));
  assert.deepStrictEqual([g.declared, g.valid, g.smoke, g.authoritative], [true, true, 'npm run smoke', 'ci']);
});

test('authoritative omitted → local', () => {
  const g = parseGate(parse('gate:\n  smoke: make check\n'));
  assert.deepStrictEqual([g.valid, g.authoritative], [true, 'local']);
});

test('authoritative: nope → invalid, read as local', () => {
  const g = parseGate(parse('gate:\n  smoke: x\n  authoritative: nope\n'));
  assert.strictEqual(g.valid, false);
  assert.strictEqual(g.authoritative, 'local');
  assert.match(g.reason, /authoritative/);
});

test('missing smoke → invalid', () => {
  const g = parseGate(parse('gate:\n  authoritative: ci\n'));
  assert.strictEqual(g.valid, false);
  assert.match(g.reason, /smoke/);
});

test('inline flow map (parsed as a string) → invalid with the block hint', () => {
  const g = parseGate(parse('gate: { smoke: "npm run smoke", authoritative: ci }\n'));
  assert.strictEqual(g.valid, false);
  assert.match(g.reason, /block/);
});

test('scalar and unknown key → invalid', () => {
  assert.strictEqual(parseGate({ gate: 'npm test' }).valid, false);
  const g = parseGate(parse('gate:\n  smoke: x\n  hermetic: ci\n'));
  assert.strictEqual(g.valid, false);
  assert.match(g.reason, /hermetic/);
});

test('gateMode is ci only when declared ci AND branch CI fires', () => {
  const ci = parseGate({ gate: { smoke: 'x', authoritative: 'ci' } });
  assert.strictEqual(gateMode({ gate: ci, branchCiFires: true }), 'ci');
  assert.strictEqual(gateMode({ gate: ci, branchCiFires: false }), 'local');
  assert.strictEqual(gateMode({ gate: parseGate({}), branchCiFires: true }), 'local');
  assert.strictEqual(gateMode({ gate: parseGate({ gate: { smoke: 'x', authoritative: 'bad' } }), branchCiFires: true }), 'local');
  assert.strictEqual(gateMode({ branchCiFires: true }), 'local');
});
