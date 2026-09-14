'use strict';
/**
 * Tests for tools/lib/release-policy.js — the `release:` block (#337).
 *
 * Run: `node --test tools/lib/*.test.js`.
 *
 * Pinned here: the derivation table matches CONVENTIONS.md §6's release rung row for row, it
 * fails closed on anything the rung does not name, and a declared block narrows the default and
 * never widens it. The audit-level fixtures (a real descriptor through audit.mjs) live in
 * audit-release-block.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveDefault, evaluateRelease } = require('./release-policy.js');

const pick = (d) => ({ row: d.row, candidates: d.candidates, final: d.final, testPeriodDays: d.testPeriodDays });

// --- the derivation table, row for row --------------------------------------------------------

test('exposure: none and self cut no tags', () => {
  for (const exposure of ['none', 'self']) {
    assert.deepEqual(pick(deriveDefault({ exposure, deploy: 'none', production: null })),
      { row: 'no-tags', candidates: 'off', final: 'human', testPeriodDays: 3 });
  }
});

test('exposure: released, production null, deploy none — automatic candidates and final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'none', production: null })),
    { row: 'released-no-production', candidates: 'auto', final: 'auto', testPeriodDays: 3 });
});

test('exposure: released, deploy: tag — automatic candidates, human final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'tag', production: 'https://x.example' })),
    { row: 'released-tag', candidates: 'auto', final: 'human', testPeriodDays: 3 });
});

test('exposure: released, deploy: manual — automatic candidates, human final', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'released', deploy: 'manual', production: 'https://x.example' })),
    { row: 'released-manual', candidates: 'auto', final: 'human', testPeriodDays: 3 });
});

test('exposure: live — no automatic tags', () => {
  assert.deepEqual(pick(deriveDefault({ exposure: 'live', deploy: 'push-main', production: 'https://x.example' })),
    { row: 'live', candidates: 'off', final: 'human', testPeriodDays: 3 });
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
    assert.deepEqual(pick(deriveDefault(cfg)), { row: 'unmatched', candidates: 'off', final: 'human', testPeriodDays: 3 }, JSON.stringify(cfg));
  }
});

// --- absent block = the default ---------------------------------------------------------------

test('no release key: effective policy is the derived default, no findings', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'none', production: null });
  assert.equal(r.declared, null);
  assert.deepEqual(r.effective, { candidates: 'auto', testPeriodDays: 3, final: 'auto' });
  assert.deepEqual(r.findings, []);
});

test('an empty release: (null) reads as absent', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'tag', production: 'https://x.example', release: null });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.effective, { candidates: 'auto', testPeriodDays: 3, final: 'human' });
});

// --- narrowing is allowed ---------------------------------------------------------------------

test('narrowing on a no-production released repo: final: human, candidates: off, a longer test period', () => {
  const r = evaluateRelease({
    exposure: 'released', deploy: 'none', production: null,
    release: { candidates: 'off', 'test-period': '7d', final: 'human' },
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.effective, { candidates: 'off', testPeriodDays: 7, final: 'human' });
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
  assert.match(r.findings[0].text, /release\.final: auto widens the release rung.*deploy|tag deploys production/);
  assert.equal(r.effective.final, 'human');
});

test('final: auto on deploy: manual is a failure', () => {
  const r = evaluateRelease({ exposure: 'released', deploy: 'manual', production: 'https://x.example', release: { final: 'auto' } });
  assert.match(r.findings.map((f) => f.text).join('|'), /release\.final: auto widens/);
});

test('candidates: auto on exposure: self / none is a failure', () => {
  for (const exposure of ['self', 'none']) {
    const r = evaluateRelease({ exposure, deploy: 'none', production: null, release: { candidates: 'auto' } });
    assert.match(r.findings.map((f) => f.text).join('|'), new RegExp(`release\\.candidates: auto widens the release rung — on exposure: ${exposure}`));
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
  assert.match(r.findings.map((f) => f.text).join('|'), /release\.test-period: 1d widens the release rung/);
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
