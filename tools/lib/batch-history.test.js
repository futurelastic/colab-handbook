'use strict';
/**
 * tools/lib/batch-history.js (#556) — the audit's reading of `colab batch-stats --json`, on
 * hand-built reports. The ruling under test: no number is the handbook's — nothing declared ⇒ the
 * picture is shown and nothing is flagged; a declared batch-* threshold is the only thing that flags.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const bh = require('./batch-history.js');

/** A batch-stats report shaped like derive()'s return, with only the fields batch-history reads. */
function rep({ n = 1, serial = 10, cyclesRead = 10, overlapped = 0, builds = 0, pending = 0, firstGreen = 0, rate = null, attempted = 0, dropped = 0, fill = {} } = {}) {
  return {
    since: '2026-09-07T00:00:00Z', until: '2026-10-07T00:00:00Z', config: { n },
    landings: { total: serial + Object.values(fill).reduce((a, b) => a + b, 0), batch: Object.values(fill).reduce((a, b) => a + b, 0), serial },
    batches: { landed: Object.values(fill).reduce((a, b) => a + b, 0), fill, builds, pending, firstAttemptGreen: firstGreen, firstAttemptGreenRate: rate },
    dropped: { count: dropped, attempted, rate: attempted ? dropped / attempted : null },
    serial: { landings: serial, cyclesRead, overlapped, withMissedPartner: overlapped, withNearMiss: 0 },
    notes: [],
  };
}

const th = (map) => ({ thresholds: map });

test('#556: nothing declared ⇒ every rate measured, no advisory at all', () => {
  const r = rep({ n: 3, serial: 4, cyclesRead: 4, overlapped: 4, builds: 10, firstGreen: 1, rate: 0.1, attempted: 20, dropped: 15, fill: { 2: 3, 3: 4 } });
  const m = bh.measure(r);
  assert.deepStrictEqual([m.overlap.pct, m.firstGreen.pct, m.eviction.pct], [100, 10, 75]);
  const v = bh.judge(r, { 'ship-batch': '3' });
  assert.deepStrictEqual(v, { advisories: [], judged: [], unjudged: [] });
  const pic = bh.picture(r, m).join('\n');
  assert.match(pic, /overlap 100% of 4 serial/);
  assert.match(pic, /fill 3×2 · 4×3/);
  assert.match(pic, /first-attempt green 10% of 10/);
  assert.match(pic, /eviction 75% of 20/);
  assert.deepStrictEqual(bh.declaredBatchKeys({}), []);
});

test('#556: batch-overlap-pct suggests opting in, only for a serial repo at or above the declared level', () => {
  const r = rep({ serial: 20, cyclesRead: 20, overlapped: 6 }); // 30%
  assert.strictEqual(bh.judge(r, th({ 'batch-overlap-pct': '30' })).advisories.length, 1);
  assert.match(bh.judge(r, th({ 'batch-overlap-pct': '30' })).advisories[0], /30% of 20 serial landings .* consider opting in to ship-batch/);
  assert.strictEqual(bh.judge(r, th({ 'batch-overlap-pct': '31' })).advisories.length, 0);
  const opted = bh.judge(r, { 'ship-batch': '2', thresholds: { 'batch-overlap-pct': '10' } });
  assert.deepStrictEqual(opted.advisories, []);
  assert.match(opted.unjudged[0].why, /already opted in/);
});

test('#556: the overlap denominator is landings whose trunk-CI cycle was read — none read is unmeasured, not 0%', () => {
  const r = rep({ serial: 50, cyclesRead: 0, overlapped: 0 });
  assert.strictEqual(bh.measure(r).overlap.pct, null);
  const v = bh.judge(r, th({ 'batch-overlap-pct': '0' }));
  assert.deepStrictEqual(v.advisories, []);
  assert.deepStrictEqual(v.unjudged.map((u) => u.key), ['batch-overlap-pct']);
  assert.match(bh.picture(r).join('\n'), /overlap — of 0/);
});

test('#556: batch-first-green-pct-min suggests lowering ship-batch below the declared rate', () => {
  const r = rep({ n: 3, builds: 10, pending: 2, firstGreen: 4, rate: 0.5 }); // 4 of 8 finished
  const v = bh.judge(r, { 'ship-batch': '3', thresholds: { 'batch-first-green-pct-min': '60' } });
  assert.strictEqual(v.advisories.length, 1);
  assert.match(v.advisories[0], /50% of 8 combined runs .* consider lowering ship-batch below 3/);
  assert.deepStrictEqual(bh.judge(r, { 'ship-batch': '3', thresholds: { 'batch-first-green-pct-min': '50' } }).advisories, []);
});

test('#556: batch-eviction-pct-max flags only above the declared rate', () => {
  const r = rep({ n: 2, attempted: 10, dropped: 3 });
  assert.strictEqual(bh.judge(r, { 'ship-batch': '2', thresholds: { 'batch-eviction-pct-max': '20' } }).advisories.length, 1);
  assert.deepStrictEqual(bh.judge(r, { 'ship-batch': '2', thresholds: { 'batch-eviction-pct-max': '30' } }).advisories, []);
});

test('#556: batch-min-samples — a declared rate under it is reported as not judged, never as fine', () => {
  const r = rep({ n: 2, builds: 3, firstGreen: 0, rate: 0 });
  const v = bh.judge(r, { 'ship-batch': '2', thresholds: { 'batch-first-green-pct-min': '50', 'batch-min-samples': '5' } });
  assert.deepStrictEqual(v.advisories, []);
  assert.deepStrictEqual(v.unjudged, [{ key: 'batch-first-green-pct-min', why: '3 sample(s), batch-min-samples is 5' }]);
  // undeclared min-samples: one sample is enough
  assert.strictEqual(bh.judge(r, { 'ship-batch': '2', thresholds: { 'batch-first-green-pct-min': '50' } }).advisories.length, 1);
});

test('#556: a serial repo with no combined runs does not judge batch-only rates', () => {
  const v = bh.judge(rep(), th({ 'batch-first-green-pct-min': '90', 'batch-eviction-pct-max': '0' }));
  assert.deepStrictEqual(v.advisories, []);
  assert.deepStrictEqual(v.unjudged.map((u) => u.why), ['not batching (ship-batch absent or 1)', 'not batching (ship-batch absent or 1)']);
});

test('#556: a malformed batch-* value is not judged (it reads as undeclared)', () => {
  const r = rep({ serial: 10, cyclesRead: 10, overlapped: 10 });
  assert.deepStrictEqual(bh.judge(r, th({ 'batch-overlap-pct': '150' })).advisories, []);
  assert.deepStrictEqual(bh.declaredBatchKeys(th({ 'batch-overlap-pct': '150', 'batch-min-samples': '2' })), ['batch-min-samples']);
});
