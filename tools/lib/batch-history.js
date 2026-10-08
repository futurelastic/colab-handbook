'use strict';
/**
 * tools/lib/batch-history.js — the audit's reading of `colab batch-stats --json` (#556).
 *
 * Two halves, deliberately separate:
 *   measure  the repo's batch picture as four rates — overlap of serial landings with a partner
 *            inside their trunk-CI cycle, batch fill, first-attempt green rate of combined runs,
 *            eviction rate of members at build. Always shown; never a finding by itself.
 *   judge    an advisory ONLY against a threshold the repo declares in `thresholds:` (the four
 *            `batch-*` keys in tools/lib/thresholds.js, none of which has a default). The owner's
 *            ruling on #556 — "should not set any hard code number" — is why: nothing declared ⇒
 *            the numbers are shown and nothing is flagged. Replaces #506's proposed fixed
 *            "suggest ship-batch: 3".
 *
 * A rate with no samples is unmeasured (null), and an unmeasured rate is never judged — the same
 * rule as `batch-min-samples`, which a repo may declare to demand more than one sample.
 *
 * Pure: a batch-stats report + the parsed descriptor in, `{ measured, picture, advisories }` out.
 */

const thresholds = require('./thresholds');
const shipBatch = require('./ship-batch');

const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);
const pctRate = (r) => (r === null || r === undefined ? null : Math.round(r * 100));

/** The four rates and their sample counts, from a batch-stats report. */
function measure(rep) {
  const s = rep.serial || {};
  const b = rep.batches || {};
  const d = rep.dropped || {};
  const finished = (b.builds || 0) - (b.pending || 0);
  return {
    overlap: { pct: pctOf(s.overlapped || 0, s.cyclesRead || 0), samples: s.cyclesRead || 0, overlapped: s.overlapped || 0 },
    fill: { batches: b.landed || 0, byMembers: b.fill || {} },
    firstGreen: { pct: pctRate(b.firstAttemptGreenRate), samples: finished, green: b.firstAttemptGreen || 0 },
    eviction: { pct: pctRate(d.rate), samples: d.attempted || 0, dropped: d.count || 0 },
  };
}

/** One line per rate, for the human report. `—` is unmeasured, never zero. */
function picture(rep, m = measure(rep)) {
  const p = (x) => (x.pct === null ? '—' : `${x.pct}%`);
  const fill = Object.keys(m.fill.byMembers).sort().map((k) => `${m.fill.byMembers[k]}×${k}`).join(' · ') || '—';
  const head = `batch history ${String(rep.since || '').slice(0, 10)} … ${String(rep.until || '').slice(0, 10)}: ${(rep.landings || {}).total || 0} landing(s), ${(rep.landings || {}).batch || 0} batch · ${(rep.landings || {}).serial || 0} serial (ship-batch: ${(rep.config || {}).n || 1})`;
  return [
    head,
    `overlap ${p(m.overlap)} of ${m.overlap.samples} serial landing(s) had a partner green inside their trunk-CI cycle · fill ${fill} · first-attempt green ${p(m.firstGreen)} of ${m.firstGreen.samples} combined run(s) · eviction ${p(m.eviction)} of ${m.eviction.samples} member(s)`,
  ];
}

/**
 * Advisories for the rates that cross a DECLARED threshold. `doc` is the parsed descriptor.
 * Returns `{ advisories: [text], judged: [key], unjudged: [{ key, why }] }` — a declared key that
 * could not be judged (no samples, under batch-min-samples, not applicable) says why, so a quiet
 * report never reads as "checked and fine" when it was not checked.
 */
function judge(rep, doc, m = measure(rep)) {
  const t = thresholds.parseThresholds(doc).values;
  const n = shipBatch.parseShipBatch(doc || {}).n || 1;
  const minN = t['batch-min-samples'] === null ? 1 : t['batch-min-samples'];
  const advisories = [];
  const judged = [];
  const unjudged = [];
  const enough = (key, rate) => {
    if (rate.pct === null || rate.samples < minN) {
      unjudged.push({ key, why: `${rate.samples} sample(s)${minN > 1 ? `, batch-min-samples is ${minN}` : ''}` });
      return false;
    }
    judged.push(key);
    return true;
  };

  const ov = t['batch-overlap-pct'];
  if (ov !== null) {
    if (n > 1) unjudged.push({ key: 'batch-overlap-pct', why: `already opted in (ship-batch: ${n})` });
    else if (enough('batch-overlap-pct', m.overlap) && m.overlap.pct >= ov) {
      advisories.push(`batch history: ${m.overlap.pct}% of ${m.overlap.samples} serial landings overlapped a partner's green inside their trunk-CI cycle (thresholds.batch-overlap-pct: ${ov}) — consider opting in to ship-batch; colab batch-stats has the pairs`);
    }
  }
  const fg = t['batch-first-green-pct-min'];
  if (fg !== null) {
    if (n <= 1 && !m.firstGreen.samples) unjudged.push({ key: 'batch-first-green-pct-min', why: 'not batching (ship-batch absent or 1)' });
    else if (enough('batch-first-green-pct-min', m.firstGreen) && m.firstGreen.pct < fg) {
      advisories.push(`batch history: ${m.firstGreen.pct}% of ${m.firstGreen.samples} combined runs went green on the first attempt (thresholds.batch-first-green-pct-min: ${fg}) — consider lowering ship-batch${n > 1 ? ` below ${n}` : ''}`);
    }
  }
  const ev = t['batch-eviction-pct-max'];
  if (ev !== null) {
    if (n <= 1 && !m.eviction.samples) unjudged.push({ key: 'batch-eviction-pct-max', why: 'not batching (ship-batch absent or 1)' });
    else if (enough('batch-eviction-pct-max', m.eviction) && m.eviction.pct > ev) {
      advisories.push(`batch history: ${m.eviction.pct}% of ${m.eviction.samples} batch members were dropped at build (thresholds.batch-eviction-pct-max: ${ev}) — colab batch-stats lists them by class`);
    }
  }
  return { advisories, judged, unjudged };
}

/** The batch-* threshold names a descriptor declares — what makes a no-flag audit run worth a note. */
function declaredBatchKeys(doc) {
  const d = thresholds.parseThresholds(doc).declared;
  return Object.keys(d).filter((k) => k.startsWith('batch-'));
}

module.exports = { measure, picture, judge, declaredBatchKeys };
