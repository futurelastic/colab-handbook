'use strict';
/**
 * #634: bindings/github.md may show only wire strings the codec's golden samples hold
 * (scripts/check-github-binding.mjs). Each finding class is shown firing on a fixture, and the
 * live binding is shown clean — a check nobody has seen fail is a comment.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-github-binding.mjs'));

const SAMPLES = {
  $comment: 'fixture',
  labels: [
    { wire: 'in-progress', decoded: { kind: 'convention', value: 'in-progress', known: true } },
    { wire: 'bug', decoded: { kind: 'other', value: 'bug', known: false } },
  ],
  holds: [{ wire: 'Hold: x — owner: a — wake: ruling\nBecause: y', decoded: { label: 'x' } }],
  notHolds: [{ wire: 'Hold: x, owner: a', decoded: null }],
  grants: { migration: [{ wire: '🛢 grant', decoded: { branch: 'b' } }] },
};
const fence = (info, body, n = 3) => '`'.repeat(n) + info + '\n' + body + '\n' + '`'.repeat(n);
const CLEAN = [
  fence('wire labels', 'in-progress'),
  'prose between blocks is ignored\n',
  fence('wire holds', 'Hold: x — owner: a — wake: ruling\nBecause: y'),
  fence('wire notHolds not', 'Hold: x, owner: a'),
  fence('wire grants', '🛢 grant', 4),
  fence('sh', 'echo not a wire block'),
].join('\n\n');

const rules = (fs_) => fs_.map((f) => f.rule).sort();

test('a binding showing exactly the samples is clean', async () => {
  const { check } = await load();
  assert.deepStrictEqual(check(CLEAN, SAMPLES), []);
});

test('parseBlocks: a longer fence holds a nested ``` block as one wire', async () => {
  const { parseBlocks } = await load();
  const md = fence('wire grants', 'head line\n\n```inner\nv: 1\n```', 4);
  const [b] = parseBlocks(md);
  assert.strictEqual(b.section, 'grants');
  assert.strictEqual(b.body, 'head line\n\n```inner\nv: 1\n```');
});

test('unknown-section: a block naming no samples section', async () => {
  const { check } = await load();
  assert.deepStrictEqual(rules(check(CLEAN + '\n\n' + fence('wire nosuch', 'x'), SAMPLES)), ['unknown-section']);
});

test('no-sample: one separator off is a disagreement', async () => {
  const { check } = await load();
  const drift = CLEAN.replace('Hold: x — owner: a — wake: ruling', 'Hold: x - owner: a - wake: ruling');
  assert.deepStrictEqual(rules(check(drift, SAMPLES)), ['no-sample']);
});

test('no-sample: polarity — a rejected shape shown as accepted, and the reverse', async () => {
  const { check } = await load();
  const asAccepted = CLEAN.replace('wire notHolds not', 'wire notHolds');
  assert.deepStrictEqual(rules(check(asAccepted, SAMPLES)), ['no-sample']);
  const asRejected = CLEAN.replace('```wire holds', '```wire holds not');
  assert.deepStrictEqual(rules(check(asRejected, SAMPLES)), ['no-sample']);
});

test('unknown-label: a known:false label shown as a convention label', async () => {
  const { check } = await load();
  const md = CLEAN.replace(fence('wire labels', 'in-progress'), fence('wire labels', 'in-progress\nbug'));
  assert.deepStrictEqual(rules(check(md, SAMPLES)), ['unknown-label']);
});

test('missing-section and missing-label: a sample the binding never shows', async () => {
  const { check } = await load();
  const md = CLEAN.replace(fence('wire labels', 'in-progress'), '').replace(fence('wire grants', '🛢 grant', 4), '');
  const found = check(md, SAMPLES);
  assert.deepStrictEqual(rules(found), ['missing-label', 'missing-section', 'missing-section']);
  assert.deepStrictEqual(found.filter((f) => f.rule === 'missing-section').map((f) => f.text).sort(), ['grants', 'labels']);
});

test('the live bindings/github.md agrees with the live codec samples', async () => {
  const { check } = await load();
  const md = fs.readFileSync(path.join(ROOT, 'bindings', 'github.md'), 'utf8');
  const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'lib', 'codec', 'samples.json'), 'utf8'));
  assert.deepStrictEqual(check(md, samples), []);
});
