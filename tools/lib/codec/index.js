'use strict';
/**
 * The tracker codec (#497, epic #496): everything this toolkit writes to an issue tracker with a
 * meaning, as pure, synchronous encode/decode pairs — no I/O, no clock, no requires outside this
 * directory — so a consumer can share it as code instead of keeping a hand copy.
 *
 *   labels  — the convention label vocabulary, plus `encodeLabel` / `decodeLabel`
 *   claim    — the `🔒 Claimed` / `✅ Released` comment format, plus `encodeClaim` / `decodeClaim`
 *              and `encodeRelease` / `decodeRelease`
 *   grants   — migration grants (human and reviewer) and red-trunk CI grants, with their revokes (#498)
 *   decision — `⚖ Decision recorded` / `↩ Decision reopened`, the options block, `Mockup:` lines (#498)
 *   hold     — the `Hold:` / `Because:` lines and the closed `wake:` vocabulary's parsers (#498)
 *   release  — the release rung's tracking marker, event markers and "released in" comment (#498)
 *   markers  — parent and close-reason markers for trackers with no native field for either (#499)
 *
 * `samples.json` beside this file is the language-neutral spec: real, scrubbed tracker strings that
 * every encode(decode(s)) must reproduce byte for byte. Typed consumers: `index.d.ts`.
 */
const labels = require('./labels');
const claim = require('./claim');
const grants = require('./grants');
const decision = require('./decision');
const hold = require('./hold');
const release = require('./release');
const markers = require('./markers');

// Flat names too. No two halves export the same name (codec.test.js pins it), so the spread below
// never silently shadows one half's export with another's.
module.exports = {
  labels, claim, grants, decision, hold, release, markers,
  ...labels, ...claim, ...grants, ...decision, ...hold, ...release, ...markers,
};
