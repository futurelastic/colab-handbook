// Types for tools/lib/codec (#497, epic #496) — the tracker codec. Pure and synchronous: every
// function here is a string ↔ object transform with no I/O. The wire format's spec is
// samples.json beside this file; codec.test.js pins that every runtime export is declared.

export * from './labels';
export * from './claim';
import * as labels from './labels';
import * as claim from './claim';
/** The two halves, also reachable by name: `codec.labels.decodeLabel`, `codec.claim.encodeClaim`. */
export { labels, claim };
