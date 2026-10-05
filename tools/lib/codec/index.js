'use strict';
/**
 * The tracker codec (#497, epic #496): everything this toolkit writes to an issue tracker with a
 * meaning, as pure, synchronous encode/decode pairs — no I/O, no clock, no requires outside this
 * directory — so a consumer can share it as code instead of keeping a hand copy.
 *
 *   labels  — the convention label vocabulary, plus `encodeLabel` / `decodeLabel`
 *   claim   — the `🔒 Claimed` / `✅ Released` comment format, plus `encodeClaim` / `decodeClaim`
 *             and `encodeRelease` / `decodeRelease`
 *
 * `samples.json` beside this file is the language-neutral spec: real, scrubbed tracker strings that
 * every encode(decode(s)) must reproduce byte for byte. Typed consumers: `index.d.ts`.
 */
const labels = require('./labels');
const claim = require('./claim');

module.exports = { labels, claim, ...labels, ...claim };
