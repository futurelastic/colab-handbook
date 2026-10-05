// Types for tools/lib/codec (#497, #498, #499 — epic #496) — the tracker codec. Pure and synchronous:
// every function here is a string ↔ object transform with no I/O. The wire format's spec is
// samples.json beside this file; codec.test.js pins that every runtime export is declared.

export * from './labels';
export * from './claim';
export * from './grants';
export * from './decision';
export * from './hold';
export * from './release';
export * from './markers';
import * as labels from './labels';
import * as claim from './claim';
import * as grants from './grants';
import * as decision from './decision';
import * as hold from './hold';
import * as release from './release';
import * as markers from './markers';
/** Each half, also reachable by name: `codec.labels.decodeLabel`, `codec.grants.decodeCiGrant`, … */
export { labels, claim };
export { grants, decision, hold, release, markers };
