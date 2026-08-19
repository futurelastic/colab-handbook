'use strict';
/**
 * Tests for tools/lib/util.js's `humanAge` (#238) — a hold's age rendered self-evidently, never a
 * raw ISO timestamp a reader has to subtract by hand. `colab places` and every refusal that names
 * a hold (tools/lib/place.js's `conflict()`, `holdAge()`) both build on this.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');

const { humanAge } = require('./util.js');

function isoMsAgo(ms) { return new Date(Date.now() - ms).toISOString(); }

test('humanAge: a moment ago reads "just now"', () => {
  assert.strictEqual(humanAge(isoMsAgo(5_000)), 'just now');
});

test('humanAge: under an hour reads in minutes', () => {
  assert.strictEqual(humanAge(isoMsAgo(4 * 60_000)), '4m ago');
  assert.strictEqual(humanAge(isoMsAgo(59 * 60_000)), '59m ago');
});

test('humanAge: under a day reads in hours, not minutes', () => {
  assert.strictEqual(humanAge(isoMsAgo(60 * 60_000)), '1h ago');
  assert.strictEqual(humanAge(isoMsAgo(3 * 3_600_000)), '3h ago');
  assert.strictEqual(humanAge(isoMsAgo(23 * 3_600_000)), '23h ago');
});

test('humanAge: a day or beyond reads in days, not hours — the #238 "records days old" case', () => {
  assert.strictEqual(humanAge(isoMsAgo(24 * 3_600_000)), '1d ago');
  assert.strictEqual(humanAge(isoMsAgo(4 * 24 * 3_600_000)), '4d ago');
});

test('humanAge: a fresh hold and a days-old hold render visibly differently (the #238 complaint, directly)', () => {
  const fresh = humanAge(isoMsAgo(4 * 60_000));
  const stale = humanAge(isoMsAgo(3 * 24 * 3_600_000));
  assert.notStrictEqual(fresh, stale);
});

test('humanAge: an unparseable timestamp degrades to a labelled "unknown", never throws', () => {
  assert.strictEqual(humanAge('not-a-date'), 'age unknown');
  assert.strictEqual(humanAge(undefined), 'age unknown');
});

test('humanAge: clock skew (a "since" in the future) never renders a negative age', () => {
  assert.strictEqual(humanAge(isoMsAgo(-60_000)), 'just now');
});
