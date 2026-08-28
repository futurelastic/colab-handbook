'use strict';
/**
 * Tests for tools/lib/writes-authority.js — the `writes` precedence ladder behind #208's
 * split (`serial-direct` / `serial-gated` / `isolated`, with `serial` as a legacy alias).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  resolveWrites, writesMode, isAcceptedWritesValue, trunkDirectVetoed, writesSyncAdvisory,
  WRITES_DECLARED, WRITES_LEGACY, WRITES_CURRENT, WRITES_LEGACY_FREE, WRITES_ACCEPTED_SET,
} = require('./writes-authority.js');

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

// --- #283: WRITES_CURRENT / WRITES_LEGACY_FREE / the widened accepted set --------------------

test('WRITES_CURRENT is exactly the three #283 spellings', () => {
  assert.deepStrictEqual([...WRITES_CURRENT].sort(), ['direct', 'free', 'isolated']);
});

test('WRITES_LEGACY_FREE is exactly the three pre-#283 spellings, all folding to free', () => {
  assert.deepStrictEqual([...WRITES_LEGACY_FREE].sort(), ['serial', 'serial-direct', 'serial-gated']);
});

test('WRITES_ACCEPTED_SET is the union of both vocabularies — six spellings', () => {
  assert.deepStrictEqual(
    [...WRITES_ACCEPTED_SET].sort(),
    ['direct', 'free', 'isolated', 'serial', 'serial-direct', 'serial-gated'],
  );
});

test('isAcceptedWritesValue: free and direct are accepted, alongside every legacy spelling', () => {
  assert.strictEqual(isAcceptedWritesValue('free'), true);
  assert.strictEqual(isAcceptedWritesValue('direct'), true);
  assert.strictEqual(isAcceptedWritesValue('serial'), true);
  assert.strictEqual(isAcceptedWritesValue('serial-direct'), true);
  assert.strictEqual(isAcceptedWritesValue('serial-gated'), true);
});

// --- writesMode (#283) — the TOTAL reading deriveConsequences uses instead of resolveWrites ---

test('writesMode: absence (null/undefined) resolves to free, source default', () => {
  assert.deepStrictEqual(writesMode(null), { mode: 'free', source: 'default' });
  assert.deepStrictEqual(writesMode(undefined), { mode: 'free', source: 'default' });
});

test('writesMode: every legacy spelling (including the "serial" alias) resolves to free, source legacy', () => {
  for (const v of WRITES_LEGACY_FREE) {
    assert.deepStrictEqual(writesMode(v), { mode: 'free', source: 'legacy' }, v);
  }
});

test('writesMode: each current spelling reads as itself, source declared', () => {
  for (const v of WRITES_CURRENT) {
    assert.deepStrictEqual(writesMode(v), { mode: v, source: 'declared' }, v);
  }
});

test('writesMode: an unrecognised string fails closed to free, source unrecognised — never toward isolated or direct', () => {
  assert.deepStrictEqual(writesMode('parallel'), { mode: 'free', source: 'unrecognised' });
  assert.deepStrictEqual(writesMode('DIRECT'), { mode: 'free', source: 'unrecognised' }); // case-sensitive
});

test('writesMode is total — every WRITES_ACCEPTED_SET member plus absence plus a typo all classify, none throw', () => {
  const inputs = [null, undefined, 'parallel', ...WRITES_ACCEPTED_SET];
  for (const raw of inputs) {
    const r = writesMode(raw);
    assert.ok(['free', 'direct', 'isolated'].includes(r.mode), `writesMode(${JSON.stringify(raw)}) = ${JSON.stringify(r)}`);
  }
});

// --- trunkDirectVetoed (#237 — the ⚖ Decision on #233) --------------------------------------
// The one two-state reading that decides anything now: `writes: isolated` vetoes trunk-direct
// for every session, human or not; absence and every other value mean coexistence.

test('trunkDirectVetoed: an explicit "isolated" vetoes', () => {
  assert.strictEqual(trunkDirectVetoed('isolated'), true);
});

test('trunkDirectVetoed: THE TRAP — absence must NOT veto, even though resolveWrites(undefined).value is "isolated"', () => {
  // resolveWrites(undefined) === { value: 'isolated', source: 'default' } — reading `.value`
  // alone would veto every repo with no `writes:` key at all, the exact opposite of the ruling
  // ("Absence — and every other value — means coexistence"). trunkDirectVetoed must read the
  // RAW declared value, never resolveWrites(...).value.
  assert.deepStrictEqual(resolveWrites(undefined).value, 'isolated'); // the trap, demonstrated
  assert.strictEqual(trunkDirectVetoed(undefined), false);
  assert.strictEqual(trunkDirectVetoed(null), false);
});

test('trunkDirectVetoed: an unrecognised value does NOT veto (coexists) — the audit enum check catches the typo, not this function', () => {
  assert.deepStrictEqual(resolveWrites('parallel').value, 'isolated'); // resolveWrites still fails closed on ITS OWN axis
  assert.strictEqual(trunkDirectVetoed('parallel'), false);            // but the veto reading does not follow it there
});

test('trunkDirectVetoed: every non-isolated declared value coexists, including both serial-* spellings and the legacy alias', () => {
  assert.strictEqual(trunkDirectVetoed('serial-direct'), false);
  assert.strictEqual(trunkDirectVetoed('serial-gated'), false);
  assert.strictEqual(trunkDirectVetoed('serial'), false); // the legacy alias itself, not its resolution
});

test('trunkDirectVetoed: case-sensitive — "ISOLATED" does not veto', () => {
  assert.strictEqual(trunkDirectVetoed('ISOLATED'), false);
});

// --- writesSyncAdvisory (#239) ---------------------------------------------------------------
// The four-way sync announcement for ⚖ #233, keyed on the RAW declared value — same trap as
// trunkDirectVetoed above, so covered the same way: undeclared must read as "coexistence",
// never as "isolated" (resolveWrites(...).value's own reading).

test('writesSyncAdvisory: null and undefined both get the coexistence-default message', () => {
  for (const raw of [null, undefined]) {
    const msg = writesSyncAdvisory(raw);
    assert.match(msg, /COEXISTENCE/);
    assert.match(msg, /declare writes: isolated/);
  }
});

test('writesSyncAdvisory: an unrecognised string gets the same coexistence-default message as undeclared', () => {
  assert.strictEqual(writesSyncAdvisory('parallel'), writesSyncAdvisory(undefined));
});

test('writesSyncAdvisory: "isolated" gets the meaning-changed/veto message, distinct from every other message', () => {
  const msg = writesSyncAdvisory('isolated');
  assert.match(msg, /changed meaning/);
  assert.match(msg, /VETOES/);
  assert.doesNotMatch(msg, /COEXISTENCE/);
  assert.doesNotMatch(msg, /inert/);
});

test('writesSyncAdvisory: "serial-direct" and the legacy "serial" alias both say inert + may be removed, spelled as declared', () => {
  assert.match(writesSyncAdvisory('serial-direct'), /writes: serial-direct is inert/);
  assert.match(writesSyncAdvisory('serial'), /writes: serial is inert/);
  assert.match(writesSyncAdvisory('serial-direct'), /may be removed/);
});

test('writesSyncAdvisory: "serial-gated" points at the gating axis instead, distinct from the plain-inert message', () => {
  const msg = writesSyncAdvisory('serial-gated');
  assert.match(msg, /is inert/);
  assert.match(msg, /axis that owns gating/);
  assert.doesNotMatch(msg, /may be removed/);
});

// --- #283: writesSyncAdvisory gains free/direct branches, added for totality (near-dead code —
// this call site is gated on a stamp predating ⚖ #237, and no repo can predate #237 while
// already declaring #283's vocabulary) --------------------------------------------------------

test('writesSyncAdvisory: "free" gets its own coexistence message, distinct from every other message', () => {
  const msg = writesSyncAdvisory('free');
  assert.match(msg, /coexistence/i);
  assert.notStrictEqual(msg, writesSyncAdvisory(undefined));
  assert.notStrictEqual(msg, writesSyncAdvisory('isolated'));
});

test('writesSyncAdvisory: "direct" names it as declared, not yet enforced, distinct from every other message', () => {
  const msg = writesSyncAdvisory('direct');
  assert.match(msg, /not yet enforced/);
  assert.doesNotMatch(msg, /VETOES/);
});
