'use strict';
/** tools/lib/gate-drift.js (#721): a copied gate and an inert gate are drift, read from content and run history. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('./gate-drift');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GUARD = g.GUARD_NAME;

test('every light template and the self-test are callers; this repo\'s own ci.yml carries a gate copy', () => {
  for (const f of ['.github/workflows/ci.yml']) {
    assert.ok(g.hasCopiedGate(read(f)), `${f} should read as a copied gate`);
    assert.ok(!g.isCiLightCaller(read(f)), `${f} is not a caller`);
  }
  // #724: the light templates call the reusable workflow — a fresh copy of one is never drift.
  for (const f of ['templates/ci-node.yml', 'templates/ci-python.yml', 'templates/ci-laravel.yml', 'templates/ci-call.yml', '.github/workflows/ci-light-selftest.yml']) {
    assert.ok(g.isCiLightCaller(read(f)), `${f} should read as a caller`);
    assert.ok(!g.hasCopiedGate(read(f)), `${f} carries no copy`);
  }
  // The reusable workflow itself carries the gate — it is the source, never a "copy" anywhere but here.
  assert.ok(g.hasCopiedGate(read('.github/workflows/ci-light.yml')));
  // The heavy lane has a different gate (its `plan` job) — not this finding.
  assert.ok(!g.hasCopiedGate(read('templates/ci-node-heavy.yml')));
});

test('isCiLightCaller: local and remote spellings, pinned or not; prose and other workflows are not calls', () => {
  assert.ok(g.isCiLightCaller('    uses: futurelastic/colab-handbook/.github/workflows/ci-light.yml@v1.9.0\n'));
  assert.ok(g.isCiLightCaller("    uses: 'other-org/handbook/.github/workflows/ci-light.yml@main' # pinned\n"));
  assert.ok(g.isCiLightCaller('    uses: ./.github/workflows/ci-light.yml\n'));
  assert.ok(!g.isCiLightCaller('# uses: ./.github/workflows/ci-light.yml\n'));
  assert.ok(!g.isCiLightCaller('    uses: futurelastic/colab-handbook/.github/workflows/instruction-files.yml@main\n'));
  assert.ok(!g.isCiLightCaller('    uses: actions/checkout@v6\n'));
});

test('copiedGates sorts callers from copies; content decides, not the filename', () => {
  const files = {
    '.github/workflows/ci.yml': '      - name: Look for a green run of this workflow at this sha or tree\n',
    '.github/workflows/old.yml': '      - name: Look for a green run of this workflow at this sha\n', // pre-#493 spelling
    '.github/workflows/call.yml': '    uses: ./.github/workflows/ci-light.yml\n',
    '.github/workflows/env-only.yml': '          GUARD_NAME: Already tested? # renamed guard\n',
    '.github/workflows/ci-light.yml': 'name: unrelated, despite the name\n',
    '.github/workflows/deploy.yml': 'jobs: {}\n',
  };
  const r = g.copiedGates({ readFile: (p) => files[p] ?? null, workflows: Object.keys(files).map((p) => path.basename(p)) });
  assert.deepStrictEqual(r, { callers: ['call.yml'], copies: ['ci.yml', 'old.yml', 'env-only.yml'] });
});

test('runSkipped: guard success + another job skipped, by plain or called name; unreadable stays null', () => {
  assert.strictEqual(g.runSkipped([{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'skipped' }]), true);
  assert.strictEqual(g.runSkipped([{ name: `ci / ${GUARD}`, conclusion: 'success' }, { name: 'ci / Full (test, build)', conclusion: 'skipped' }]), true);
  assert.strictEqual(g.runSkipped([{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'success' }]), false);
  assert.strictEqual(g.runSkipped([{ name: 'Build', conclusion: 'skipped' }]), false); // no guard ran
  assert.strictEqual(g.runSkipped(null), null);
});

const at = (m) => `2026-11-10T10:${String(m).padStart(2, '0')}:00Z`;
const ran = [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'success' }];
const skip = [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'skipped' }];

test('gateNeverSkips: drift only when a reusable tree existed and no run in the window skipped', () => {
  const green = [{ id: 7, branch: 'feat/x-1', tree: 'T1', created: at(1) }];
  // Trunk landed T1 after the branch passed it, and ran the suite anyway: drift, naming the pair.
  let r = g.gateNeverSkips({ trunk: 'main', trunkRuns: [{ id: 9, tree: 'T1', created: at(5), jobs: ran }], greenRuns: green });
  assert.strictEqual(r.verdict, 'drift');
  assert.deepStrictEqual(r.matched, [{ trunk: 9, cited: 7, branch: 'feat/x-1' }]);
  assert.match(g.inertGateText('ci.yml', r), /^drift: the dedupe gate in \.github\/workflows\/ci\.yml never skipped — .*trunk run 9 could have cited run 7 on feat\/x-1/);
  // One skip anywhere in the window: the gate works.
  r = g.gateNeverSkips({ trunk: 'main', trunkRuns: [{ id: 9, tree: 'T1', created: at(5), jobs: ran }, { id: 8, tree: 'T0', created: at(4), jobs: skip }], greenRuns: green });
  assert.strictEqual(r.verdict, 'ok');
  // Nothing to reuse — the branch passed later, on another tree, or it was trunk's own run: ok, never drift.
  for (const greenRuns of [[{ ...green[0], created: at(6) }], [{ ...green[0], tree: 'T2' }], [{ ...green[0], branch: 'main' }], []]) {
    assert.strictEqual(g.gateNeverSkips({ trunk: 'main', trunkRuns: [{ id: 9, tree: 'T1', created: at(5), jobs: ran }], greenRuns }).verdict, 'ok');
  }
  // Only the newest N count.
  const old = Array.from({ length: g.RECENT_TRUNK_RUNS }, (_, i) => ({ id: 100 + i, tree: 'Tx', created: at(9), jobs: ran }));
  r = g.gateNeverSkips({ trunk: 'main', trunkRuns: [...old, { id: 9, tree: 'T1', created: at(5), jobs: ran }], greenRuns: green });
  assert.strictEqual(r.verdict, 'ok');
  assert.strictEqual(r.considered, g.RECENT_TRUNK_RUNS);
});

test('gateNeverSkips: an unreadable history or job listing says nothing', () => {
  assert.strictEqual(g.gateNeverSkips({ trunk: 'main', trunkRuns: null, greenRuns: [] }).verdict, 'unknown');
  assert.strictEqual(g.gateNeverSkips({ trunk: 'main', trunkRuns: [], greenRuns: [] }).verdict, 'unknown');
  assert.strictEqual(g.gateNeverSkips({ trunk: 'main', trunkRuns: [{ id: 9, tree: 'T1', created: at(5), jobs: null }], greenRuns: [{ id: 7, branch: 'b', tree: 'T1', created: at(1) }] }).verdict, 'unknown');
});
